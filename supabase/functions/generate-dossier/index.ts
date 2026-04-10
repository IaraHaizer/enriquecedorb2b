import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ==================== RECEITA FEDERAL (BrasilAPI) ====================

async function fetchCnpjData(cnpj: string): Promise<Record<string, unknown> | null> {
  try {
    const cleanCnpj = cnpj.replace(/[^\d]/g, "");
    if (cleanCnpj.length !== 14) return null;
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
    if (!response.ok) { await response.text(); return null; }
    return await response.json();
  } catch (err) {
    console.warn("Error fetching CNPJ:", err);
    return null;
  }
}

function extractCnpj(input: string, inputType: string): string | null {
  if (inputType === "cnpj") return input;
  const match = input.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
  return match ? match[0] : null;
}

function formatCnpjContext(data: Record<string, unknown>): string {
  const socios = (data.qsa as Array<Record<string, string>>) || [];
  const sociosList = socios.map((s) => `  - ${s.nome_socio || s.nome} (${s.qualificacao_socio || s.qual || "N/I"})`).join("\n");
  const cnaePrincipal = data.cnae_fiscal_descricao || (data.cnae_fiscal ? `Código ${data.cnae_fiscal}` : "N/I");
  const cnaesSecundarios = (data.cnaes_secundarios as Array<Record<string, unknown>>) || [];
  const cnaesSecList = cnaesSecundarios.slice(0, 5).map((c) => `  - ${c.descricao}`).join("\n");

  return `
=== DADOS REAIS DA RECEITA FEDERAL (BrasilAPI) ===
Razão Social: ${data.razao_social || "N/I"}
Nome Fantasia: ${data.nome_fantasia || "N/I"}
CNPJ: ${data.cnpj || "N/I"}
Situação Cadastral: ${data.descricao_situacao_cadastral || "N/I"}
Data de Abertura: ${data.data_inicio_atividade || "N/I"}
Porte: ${data.porte || data.descricao_porte || "N/I"}
Capital Social: R$ ${data.capital_social ? Number(data.capital_social).toLocaleString("pt-BR") : "N/I"}
Natureza Jurídica: ${data.natureza_juridica || "N/I"}
Endereço: ${data.logradouro || ""} ${data.numero || ""}, ${data.bairro || ""} - ${data.municipio || ""}/${data.uf || ""} - CEP ${data.cep || ""}
Telefone: ${data.ddd_telefone_1 || "N/I"}
Email: ${data.email || "N/I"}
Atividade Principal: ${cnaePrincipal}
${cnaesSecList ? `Atividades Secundárias:\n${cnaesSecList}` : ""}
Quadro de Sócios (QSA):
${sociosList || "  Nenhum sócio encontrado"}
=== FIM DOS DADOS REAIS ===`;
}

// ==================== WHOIS / RDAP DOMAIN LOOKUP ====================

interface DominioInfo {
  dominio: string;
  status: string;
  data_criacao?: string;
  data_expiracao?: string;
  registrante?: string;
  cnpj_registrante?: string;
  nameservers?: string[];
}

async function fetchRdapDomain(domain: string): Promise<DominioInfo | null> {
  try {
    const response = await fetch(`https://rdap.registro.br/domain/${domain}`, {
      headers: { "Accept": "application/rdap+json" },
    });
    if (!response.ok) return null;
    const data = await response.json();

    const events = (data.events || []) as Array<{ eventAction: string; eventDate: string }>;
    const registration = events.find((e) => e.eventAction === "registration");
    const expiration = events.find((e) => e.eventAction === "expiration");
    const statusList = (data.status || []) as string[];

    // Extract registrant info from entities
    let registrante = "";
    let cnpjReg = "";
    const entities = (data.entities || []) as Array<Record<string, unknown>>;
    for (const entity of entities) {
      const roles = (entity.roles || []) as string[];
      if (roles.includes("registrant")) {
        const vcardArray = (entity.vcardArray || [])[1] as Array<unknown[]> | undefined;
        if (vcardArray) {
          for (const field of vcardArray) {
            if (field[0] === "fn") registrante = String(field[3] || "");
          }
        }
        // publicIds may contain CNPJ
        const publicIds = (entity.publicIds || []) as Array<{ identifier: string; type: string }>;
        for (const pid of publicIds) {
          if (pid.type === "cnpj" || pid.type === "cpf") cnpjReg = pid.identifier;
        }
      }
    }

    const nameservers = ((data.nameservers || []) as Array<{ ldhName?: string }>)
      .map((ns) => ns.ldhName || "")
      .filter(Boolean);

    return {
      dominio: data.ldhName || domain,
      status: statusList.join(", ") || "active",
      data_criacao: registration?.eventDate?.split("T")[0],
      data_expiracao: expiration?.eventDate?.split("T")[0],
      registrante: registrante || undefined,
      cnpj_registrante: cnpjReg || undefined,
      nameservers: nameservers.length > 0 ? nameservers : undefined,
    };
  } catch (err) {
    console.warn(`[RDAP] Error for ${domain}:`, err);
    return null;
  }
}

function generateCandidateDomains(empresaNome: string, cnpjData: Record<string, unknown> | null): string[] {
  const candidates: string[] = [];
  
  // From email in CNPJ data
  const email = cnpjData?.email as string | undefined;
  if (email && email.includes("@")) {
    const emailDomain = email.split("@")[1];
    if (emailDomain && !emailDomain.match(/gmail|hotmail|outlook|yahoo|uol|bol|terra|ig\.com/i)) {
      candidates.push(emailDomain);
    }
  }

  // From company name - generate .com.br and .com.br variants
  const nomeFantasia = (cnpjData?.nome_fantasia as string) || "";
  const razaoSocial = (cnpjData?.razao_social as string) || empresaNome;
  
  for (const nome of [nomeFantasia, razaoSocial]) {
    if (!nome) continue;
    const slug = nome
      .toLowerCase()
      .replace(/\s*(ltda|s\.?a\.?|eireli|me|epp|administradora|admin|de condomínios?|de imóveis|gestão|serviços?)\s*/gi, "")
      .replace(/[àáâãä]/g, "a").replace(/[èéêë]/g, "e").replace(/[ìíîï]/g, "i")
      .replace(/[òóôõö]/g, "o").replace(/[ùúûü]/g, "u").replace(/[ç]/g, "c")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 30);
    if (slug.length >= 3) {
      candidates.push(`${slug}.com.br`);
      candidates.push(`${slug}.com`);
    }
  }

  // Deduplicate
  return [...new Set(candidates)].slice(0, 6);
}

async function fetchDomainInfo(empresaNome: string, cnpj: string | null, cnpjData: Record<string, unknown> | null, skipCache = false): Promise<{ dominios: DominioInfo[]; firecrawlDomains: FirecrawlResult }> {
  const candidates = generateCandidateDomains(empresaNome, cnpjData);
  console.log(`[Domains] Candidate domains: ${candidates.join(", ")}`);

  // Query RDAP in parallel for candidate domains
  const rdapPromises = candidates.map((d) => fetchRdapDomain(d));
  
  // Also search via Firecrawl for domains registered to this CNPJ
  const cleanCnpj = cnpj?.replace(/[^\d]/g, "") || "";
  const firecrawlQuery = cleanCnpj 
    ? `"${cleanCnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}" domínio OR site OR whois registro.br`
    : `"${empresaNome}" domínio site oficial`;
  
  const cacheKey = buildCacheKey(empresaNome, cnpj, "dominios_whois");
  let firecrawlResult: FirecrawlResult;
  
  if (!skipCache) {
    const cached = await getCachedResult(cacheKey);
    if (cached) {
      firecrawlResult = cached;
    } else {
      firecrawlResult = await firecrawlSearch(firecrawlQuery, "dominios_whois", { limit: 5 });
      await setCachedResult(cacheKey, firecrawlResult);
    }
  } else {
    firecrawlResult = await firecrawlSearch(firecrawlQuery, "dominios_whois", { limit: 5 });
    await setCachedResult(cacheKey, firecrawlResult);
  }

  const rdapResults = (await Promise.all(rdapPromises)).filter(Boolean) as DominioInfo[];
  
  // Extract additional domains from Firecrawl results
  const domainRegex = /([a-z0-9-]+\.(?:com|net|org|com\.br|net\.br|org\.br|inf\.br|adm\.br|imb\.br))\b/gi;
  const extraDomains = new Set<string>();
  for (const r of firecrawlResult.results) {
    const text = `${r.title} ${r.description} ${r.markdown}`;
    let match;
    while ((match = domainRegex.exec(text)) !== null) {
      const d = match[1].toLowerCase();
      if (!d.match(/registro\.br|google|facebook|instagram|linkedin|twitter|youtube|whois/)) {
        extraDomains.add(d);
      }
    }
  }

  // RDAP lookup for extra domains found via Firecrawl
  const existingDomains = new Set(rdapResults.map(r => r.dominio.toLowerCase()));
  const newDomains = [...extraDomains].filter(d => !existingDomains.has(d) && !candidates.includes(d)).slice(0, 3);
  if (newDomains.length > 0) {
    const extraRdap = await Promise.all(newDomains.map(d => fetchRdapDomain(d)));
    for (const r of extraRdap) {
      if (r) rdapResults.push(r);
    }
  }

  console.log(`[Domains] Found ${rdapResults.length} domains via RDAP`);
  return { dominios: rdapResults, firecrawlDomains: firecrawlResult };
}

// ==================== FIRECRAWL SEARCH ====================

interface FirecrawlResult {
  source: string;
  query: string;
  results: Array<{ url: string; title: string; description?: string; markdown?: string }>;
  error?: string;
}

async function firecrawlSearch(query: string, sourceName: string, options?: { limit?: number; lang?: string; country?: string; tbs?: string }): Promise<FirecrawlResult> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    return { source: sourceName, query, results: [], error: "FIRECRAWL_API_KEY not configured" };
  }

  try {
    console.log(`[Firecrawl] Searching ${sourceName}: "${query}"`);
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: options?.limit || 5,
        lang: options?.lang || "pt-br",
        country: options?.country || "br",
        tbs: options?.tbs,
        scrapeOptions: { formats: ["markdown"] },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Firecrawl] ${sourceName} error ${response.status}: ${errText}`);
      return { source: sourceName, query, results: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const results = (data.data || []).map((r: Record<string, unknown>) => ({
      url: r.url || "",
      title: r.title || "",
      description: r.description || "",
      markdown: typeof r.markdown === "string" ? r.markdown.slice(0, 2000) : "",
    }));

    console.log(`[Firecrawl] ${sourceName}: found ${results.length} results`);
    return { source: sourceName, query, results };
  } catch (err) {
    console.warn(`[Firecrawl] ${sourceName} error:`, err);
    return { source: sourceName, query, results: [], error: String(err) };
  }
}

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

function buildCacheKey(empresaNome: string, cnpj: string | null | undefined, source: string): string {
  const normalized = (cnpj || empresaNome).replace(/[^\w]/g, "").toLowerCase();
  return `${normalized}:${source}`;
}

async function getCachedResult(cacheKey: string): Promise<FirecrawlResult | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("firecrawl_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (data) {
      console.log(`[Cache] HIT for ${cacheKey}`);
      return {
        source: data.source_name,
        query: data.query,
        results: data.results as FirecrawlResult["results"],
        error: data.error || undefined,
      };
    }
  } catch (err) {
    console.warn("[Cache] Read error:", err);
  }
  return null;
}

async function setCachedResult(cacheKey: string, result: FirecrawlResult): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("firecrawl_cache").upsert({
      cache_key: cacheKey,
      source_name: result.source,
      query: result.query,
      results: result.results,
      error: result.error || null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "cache_key" });
    console.log(`[Cache] SET for ${cacheKey}`);
  } catch (err) {
    console.warn("[Cache] Write error:", err);
  }
}

async function fetchExternalSources(empresaNome: string, cnpj?: string | null, skipCache = false): Promise<FirecrawlResult[]> {
  const searchName = empresaNome || cnpj || "";
  if (!searchName) return [];

  const sources = [
    { name: "reclame_aqui", query: `"${searchName}" site:reclameaqui.com.br`, opts: { limit: 3 } },
    { name: "jusbrasil_escavador", query: `"${searchName}" site:jusbrasil.com.br OR site:escavador.com`, opts: { limit: 3 } },
    { name: "linkedin", query: `"${searchName}" site:linkedin.com/company`, opts: { limit: 3 } },
    { name: "google_news", query: `"${searchName}" notícias empresa`, opts: { limit: 3, tbs: "qdr:y" } },
    // NEW: Risk/financial sources
    { name: "protestos_negativacoes", query: `"${searchName}" protesto negativação OR serasa OR "boa vista" OR SCPC`, opts: { limit: 3 } },
    // NEW: Growth signals - hiring/expansion
    { name: "vagas_crescimento", query: `"${searchName}" vagas OR contratando OR expansão OR "novo empreendimento"`, opts: { limit: 3, tbs: "qdr:m" } },
    // NEW: Tech stack detection
    { name: "tech_stack", query: `"${searchName}" ERP OR sistema OR software OR "super lógica" OR superlógica OR condomob OR MyCond OR "uau" OR "cidade inteligente"`, opts: { limit: 3 } },
  ];

  const results = await Promise.all(
    sources.map(async (s) => {
      const cacheKey = buildCacheKey(empresaNome, cnpj, s.name);
      if (!skipCache) {
        const cached = await getCachedResult(cacheKey);
        if (cached) return cached;
      }

      const fresh = await firecrawlSearch(s.query, s.name, s.opts);
      await setCachedResult(cacheKey, fresh);
      return fresh;
    })
  );

  return results;
}

function formatExternalContext(results: FirecrawlResult[]): string {
  if (results.length === 0) return "";

  const sections = results
    .filter((r) => r.results.length > 0)
    .map((r) => {
      const items = r.results
        .map((item) => {
          const content = item.markdown ? `\n    Conteúdo: ${item.markdown.slice(0, 800)}` : "";
          return `  - ${item.title || item.url}${content}`;
        })
        .join("\n");
      return `\n=== ${r.source.toUpperCase()} ===\n${items}`;
    });

  if (sections.length === 0) return "";
  return `\n\n=== DADOS DE FONTES EXTERNAS (Firecrawl) ===${sections.join("")}\n=== FIM DOS DADOS EXTERNOS ===`;
}

// ==================== SOURCE OF TRUTH: CATÁLOGO DE PRODUTOS ====================

const GROUP_SOFTWARE_CATALOG = `
=== CATÁLOGO OFICIAL GROUP SOFTWARE (Fonte: groupsoftware.com.br) ===
A Group Software é referência há mais de 27 anos no mercado, com +2 milhões de usuários, +100.000 condomínios, +1.000 imobiliárias e +165 shoppings.

SEGMENTO 1 — Gestão de Condomínios (Group Condomínios):
- Super App para comunicação com condôminos
- Gestão eficiente de inadimplência e cobrança
- Pasta de Prestação de Contas em um clique
- Atendimento online: Chatbot, WhatsApp, PABX
- Relatórios e dashboards completos
- Assembleia Digital
- Faturamento simplificado
- Conciliação bancária
- Contas a pagar e receber

SEGMENTO 2 — Gestão de Shopping Center (Group Shoppings):
- Faturamento de contratos em um clique
- Gestão de vendas simplificada para faturamento de aluguel
- Controle completo de inadimplência e acordos
- Gestão eletrônica de documentos
- Business Intelligence

SEGMENTO 3 — Gestão de Imobiliária (Group Imobiliárias):
- CRM Completo
- Gestão de locações e vendas
- Controle financeiro integrado com os principais bancos
- Blockchain e registro de contratos eletrônicos
- Integração com os maiores portais de divulgação do mercado

SEGMENTO 4 — Gestão para RH e DP (Group RH/DP):
- Automatização dos processos de folha de pagamento
- Envio de eSocial em um único monitor
- App para controle de ponto eletrônico (RHAPP)
- Controle de benefícios
- Integração com ERP Financeiro

Group Financeiro:
- Sistema 100% digital conectando bancos, síndicos, porteiros, condôminos e administradoras
- Dashboards e relatórios financeiros
- Pagamento de tarifa somente quando ocorre a baixa do boleto
- Faturamento simplificado
- Conciliação bancária
- Contas a pagar e receber

DIFERENCIAIS:
- Único ERP completo para gestão de propriedades (gestão de pessoas, financeira, contábil)
- Maior número de recursos e automações do mercado
- Pioneiros em IA para atendimento online e APP para comunicação
- Pasta de prestação de contas em um clique
- Geração automatizada de remessa, retorno e conciliação
- Processo de cobrança com envio de alertas automáticos
=== FIM DO CATÁLOGO GROUP SOFTWARE ===
`;

const PARTNERBANK_CATALOG = `
=== CATÁLOGO OFICIAL PARTNERBANK (Fonte: partnerbank.com.br) ===
O PartnerBank é uma instituição de pagamentos cadastrada no Banco Central. Transforma o sistema em um ERP Banking, automatizando a gestão de pagamentos e recebimentos. +11.000 clientes ativos, +MM boletos processados. Matriz SP/SP, Filial BH/MG.

PRODUTO 1 — Automação de Boletos:
- Integração do ERP direto com os bancos
- Geração, registro de remessas de boletos, baixa e conciliação automática direto no ERP
- Um clique e pronto

PRODUTO 2 — Condomínio Garantido:
- Empresas que recebem mensalidade obtêm 100% da arrecadação mensal de forma garantida
- Independente de clientes inadimplentes
- Compra de dívidas históricas

PRODUTO 3 — Controle de Inadimplência:
- Boletos podem ser parcelados no cartão de crédito em até 12x
- Mais opção de pagamento para os clientes
- Redução efetiva da inadimplência

PRODUTO 4 — Crédito Condominial:
- Empréstimo para iniciar/finalizar obra, melhoria de infraestrutura, pagar débitos, implantar energia solar
- Taxas de juros competitivas com o mercado
- Sem necessidade de fiadores ou bem como garantia
- Condições exclusivas, prazos flexíveis

PRODUTO 5 — Seguros:
- Envio dos dados da apólice atual
- Recebimento em até 24 horas de pelo menos 3 propostas
- Seguro condominial, residencial ou responsabilidade civil profissional
- Maiores seguradoras do país com melhores condições de mercado

FAQ:
- Decursos de prazo: 30 e 60 dias (padrão de mercado, flexível sob demanda)
- Contato: (31) 4040-4167 ou suporte@partnerbank.com.br
- Horário: segunda a sexta, 8h às 18h
=== FIM DO CATÁLOGO PARTNERBANK ===
`;

// ==================== SYSTEM PROMPT ====================

const SYSTEM_PROMPT = `Você é um Especialista em Inteligência Comercial B2B sênior, focado no mercado de ERPs e soluções financeiras para Administradoras de Condomínios, Imobiliárias e Shoppings. Sua missão é transformar dados brutos em um dossiê estratégico de alta conversão.

FONTE DE VERDADE (SOURCE OF TRUTH) — Use ESTRITAMENTE os catálogos abaixo. PROIBIDO mencionar serviços que não estejam listados aqui:
${GROUP_SOFTWARE_CATALOG}
${PARTNERBANK_CATALOG}

Diretriz de Escavação (Anti-Alucinação):
- Receba o input (pode ser apenas E-mail, apenas CNPJ ou apenas Nome de pessoa/sócio).
- Quando dados reais da Receita Federal forem fornecidos, USE-OS como base primária.
- Quando dados de fontes externas forem fornecidos, use-os para enriquecer o dossiê.
- Crucial: Se um dado não for encontrado, escreva "Não identificado". Nunca invente.

REGRAS DE RECOMENDAÇÃO (logica_group_software):
1. Cruze os dados do Lead (tempo de empresa, porte, atividade, perfil dos sócios, dores identificadas) com os módulos EXATOS listados nos catálogos acima.
2. Se o lead for uma administradora NOVA (< 3 anos): Foque em "automação inicial" — Group Condomínios + Automação de Boletos PartnerBank para profissionalizar a cobrança desde o início.
3. Se o lead tiver dores financeiras (inadimplência, fluxo de caixa, obras): Cite os benefícios do PartnerBank EXATAMENTE como descritos (Condomínio Garantido: "100% da arrecadação mensal de forma garantida, independente de clientes inadimplentes"; Crédito: "taxas competitivas, sem fiador, sem bem como garantia").
4. Se o lead for imobiliária: Foque em Group Imobiliárias (CRM, blockchain de contratos, integração com portais).
5. Se o lead for shopping: Foque em Group Shoppings (faturamento de contratos, BI, gestão de vendas).
6. Sócio advogado: Foque em Compliance, Assembleia Digital, segurança jurídica.
7. Muitos sócios: Foque em gestão de processos, produtividade da equipe, dashboards.

NOVAS SEÇÕES DO DOSSIÊ ENRIQUECIDO:

RISCO FINANCEIRO (risco_financeiro):
- Analise os dados de "protestos_negativacoes" fornecidos pelas fontes externas.
- Preencha: protestos (encontrado, resumo, quantidade_estimada), negativacoes (encontrado, resumo), regularidade_fiscal, nivel_risco ("Baixo"/"Médio"/"Alto"/"Crítico").
- Se não houver dados de protestos/negativações nas fontes, marque "encontrado: false" e nivel_risco "Baixo".

PEP (Pessoa Exposta Politicamente):
- Para cada sócio, identifique se pode ser PEP (político, servidor público de alto escalão, etc.) baseado nos dados disponíveis.
- Adicione "is_pep: true/false" e "pep_detalhes: string" em socio_principal e cada item de mapeamento_socios.
- Se não houver evidências, marque is_pep: false.

CONTATOS PARA ABORDAGEM (contatos_abordagem):
- Liste decisores identificados com nome, cargo, canal preferencial (email/telefone/linkedin), e contato.
- Use dados do LinkedIn, site da empresa, e Receita Federal.
- Se não encontrar contatos adicionais, retorne array vazio.

SINAIS DE CRESCIMENTO (sinais_crescimento):
- Analise os dados de "vagas_crescimento" das fontes externas.
- Liste sinais como: vagas abertas, expansão, novos empreendimentos, fusões, contratações.
- Cada sinal tem: tipo ("positivo"/"negativo"/"neutro"), descricao.
- Se não encontrar sinais, retorne array vazio.

TECNOLOGIA ATUAL (empresa.tecnologia_atual):
- Analise os dados de "tech_stack" das fontes externas.
- Identifique se a empresa já usa algum ERP/software (Superlógica, Condomob, MyCond, UAU, etc.).
- Se não identificar, escreva "Não identificado".

ESTRUTURA DO "logica_group_software" NO OUTPUT:
- "analise_fit": Um parágrafo explicando POR QUE o produto X da Group/PartnerBank resolve a dor Y do lead.
- "modulos_sugeridos": Lista com nomes EXATOS dos produtos conforme aparecem nos catálogos (ex: "Group Condomínios", "Automação de Boletos PartnerBank", "Condomínio Garantido PartnerBank").
- "gancho_venda": Uma frase curta usando a COPY do próprio site para facilitar a abordagem do pré-vendas.
- "recomendacao_principal": Resumo da recomendação principal.
- "produtos_sugeridos": Lista dos produtos (mantém retrocompatibilidade).
- "justificativa": Justificativa detalhada.

Estrutura do Output (JSON rigoroso):

{
  "empresa": {
    "nome": "string",
    "cnpj": "string",
    "situacao": "string",
    "abertura": "string (data + tempo de vida em anos)",
    "porte": "string",
    "capital_social": "string",
    "endereco": "string",
    "telefone": "string",
    "redes_sociais": "string",
    "reputacao": "string (inclua dados do Reclame Aqui se disponíveis)",
    "atividade_principal": "string",
    "tecnologia_atual": "string (ERP/software identificado ou 'Não identificado')"
  },
  "socio_principal": {
    "nome": "string",
    "cargo": "string",
    "formacao_academica": "string",
    "historico_profissional": "string",
    "linkedin": "string (URL real se encontrada)",
    "background_provavel": "string",
    "is_pep": false,
    "pep_detalhes": "string"
  },
  "mapeamento_socios": [
    { "nome": "string", "cargo": "string", "background_provavel": "string", "is_pep": false, "pep_detalhes": "string" }
  ],
  "fontes_externas": {
    "reclame_aqui": { "encontrado": true, "resumo": "string", "url": "string" },
    "processos_judiciais": { "encontrado": true, "resumo": "string", "url": "string" },
    "linkedin": { "encontrado": true, "resumo": "string", "url": "string" },
    "noticias": { "encontrado": true, "resumo": "string", "urls": ["string"] }
  },
  "risco_financeiro": {
    "protestos": { "encontrado": false, "resumo": "string", "quantidade_estimada": 0 },
    "negativacoes": { "encontrado": false, "resumo": "string" },
    "regularidade_fiscal": "string",
    "nivel_risco": "Baixo"
  },
  "contatos_abordagem": [
    { "nome": "string", "cargo": "string", "canal": "string", "contato": "string" }
  ],
  "sinais_crescimento": [
    { "tipo": "positivo", "descricao": "string" }
  ],
  "insights_estrategicos": {
    "janela_oportunidade": "string",
    "abordagem_personalizada": {
      "canal_ideal": "string",
      "tom_de_voz": "string",
      "argumento_central": "string"
    },
    "ressonancia_por_perfil": [
      { "socio": "string", "ponto_de_dor": "string" }
    ],
    "o_que_evitar": "string"
  },
  "logica_group_software": {
    "analise_fit": "string",
    "modulos_sugeridos": ["string"],
    "gancho_venda": "string",
    "recomendacao_principal": "string",
    "produtos_sugeridos": ["string"],
    "justificativa": "string"
  }
}

IMPORTANTE: Responda SOMENTE com o JSON válido, sem markdown, sem backticks, sem texto adicional.`;

// ==================== LEAD SCORE V2 ====================

interface LeadScoreBreakdown {
  categoria: string;
  pontos: number;
  max: number;
  detalhe: string;
}

interface LeadScore {
  total: number;
  max: number;
  percentual: number;
  classificacao: "Frio" | "Morno" | "Quente" | "Muito Quente";
  cor: string;
  breakdown: LeadScoreBreakdown[];
}

function calculateLeadScore(
  dossier: Record<string, unknown>,
  cnpjDataFound: boolean,
  externalResults: FirecrawlResult[]
): LeadScore {
  const breakdown: LeadScoreBreakdown[] = [];
  const empresa = (dossier.empresa || {}) as Record<string, string>;
  const socio = (dossier.socio_principal || {}) as Record<string, string>;
  const socios = (dossier.mapeamento_socios || []) as Array<Record<string, string>>;
  const fontes = (dossier.fontes_externas || {}) as Record<string, { encontrado?: boolean }>;
  const risco = (dossier.risco_financeiro || {}) as Record<string, unknown>;
  const sinais = (dossier.sinais_crescimento || []) as Array<Record<string, string>>;

  // 1. Dados cadastrais (0-20)
  let cadastral = 0;
  if (cnpjDataFound) cadastral += 10;
  if (empresa.situacao?.toLowerCase().includes("ativa")) cadastral += 5;
  if (empresa.telefone && empresa.telefone !== "Não identificado") cadastral += 3;
  if (empresa.endereco && empresa.endereco !== "Não identificado") cadastral += 2;
  breakdown.push({ categoria: "Dados Cadastrais", pontos: cadastral, max: 20, detalhe: cnpjDataFound ? "CNPJ verificado na Receita Federal" : "Sem dados oficiais" });

  // 2. Maturidade (0-15)
  let maturidade = 0;
  const aberturaMatch = empresa.abertura?.match(/(\d+)\s*ano/i);
  const anos = aberturaMatch ? parseInt(aberturaMatch[1]) : 0;
  if (anos >= 5) maturidade += 10;
  else if (anos >= 2) maturidade += 7;
  else if (anos >= 1) maturidade += 4;
  const capitalStr = empresa.capital_social?.replace(/[^\d,\.]/g, "") || "0";
  const capital = parseFloat(capitalStr.replace(/\./g, "").replace(",", ".")) || 0;
  if (capital >= 100000) maturidade += 5;
  else if (capital >= 10000) maturidade += 3;
  breakdown.push({ categoria: "Maturidade", pontos: maturidade, max: 15, detalhe: `${anos} anos, Capital: ${empresa.capital_social || "N/I"}` });

  // 3. Complexidade societária (0-10)
  let societaria = 0;
  if (socios.length >= 3) societaria += 10;
  else if (socios.length >= 2) societaria += 7;
  else if (socios.length >= 1) societaria += 4;
  breakdown.push({ categoria: "Estrutura Societária", pontos: societaria, max: 10, detalhe: `${socios.length} sócio(s) mapeado(s)` });

  // 4. Presença digital (0-15)
  let digital = 0;
  if (socio.linkedin && socio.linkedin !== "Não identificado") digital += 5;
  if (empresa.redes_sociais && empresa.redes_sociais !== "Não identificado") digital += 5;
  if (fontes.linkedin?.encontrado) digital += 5;
  breakdown.push({ categoria: "Presença Digital", pontos: digital, max: 15, detalhe: digital >= 10 ? "Boa presença online" : "Presença limitada" });

  // 5. Reputação e riscos (0-15)
  let reputacao = 8;
  if (fontes.reclame_aqui?.encontrado) reputacao += 4;
  if (fontes.processos_judiciais?.encontrado) reputacao -= 3;
  reputacao = Math.max(0, Math.min(15, reputacao));
  breakdown.push({ categoria: "Reputação / Riscos", pontos: reputacao, max: 15, detalhe: fontes.processos_judiciais?.encontrado ? "Processos judiciais encontrados" : "Sem alertas críticos" });

  // 6. Cobertura de dados (0-15)
  let cobertura = 0;
  const externalFound = externalResults.filter(r => r.results.length > 0).length;
  cobertura += Math.min(9, externalFound * 2);
  if (socio.formacao_academica && socio.formacao_academica !== "Não identificado") cobertura += 3;
  if (socio.historico_profissional && socio.historico_profissional !== "Não identificado") cobertura += 3;
  cobertura = Math.min(15, cobertura);
  breakdown.push({ categoria: "Cobertura de Dados", pontos: cobertura, max: 15, detalhe: `${externalFound}/7 fontes externas com dados` });

  // 7. NEW: Risco Financeiro (-10 a +10) → mapped to 0-10
  let riscoScore = 5; // neutral base
  const protestos = (risco.protestos || {}) as Record<string, unknown>;
  const negativacoes = (risco.negativacoes || {}) as Record<string, unknown>;
  const nivelRisco = (risco.nivel_risco as string) || "Baixo";
  if (nivelRisco === "Baixo") riscoScore = 10;
  else if (nivelRisco === "Médio") riscoScore = 6;
  else if (nivelRisco === "Alto") riscoScore = 3;
  else if (nivelRisco === "Crítico") riscoScore = 0;
  const riscoDetalhe = protestos.encontrado || negativacoes.encontrado
    ? `Nível: ${nivelRisco} — protestos/negativações detectados`
    : `Nível: ${nivelRisco} — sem alertas financeiros`;
  breakdown.push({ categoria: "Saúde Financeira", pontos: riscoScore, max: 10, detalhe: riscoDetalhe });

  // 8. NEW: Fit Tecnológico (0-10)
  let fitTech = 5;
  const techAtual = empresa.tecnologia_atual || "Não identificado";
  if (techAtual === "Não identificado") {
    fitTech = 7; // greenfield = opportunity
  } else if (/group|partnerbank/i.test(techAtual)) {
    fitTech = 2; // already a client
  } else {
    fitTech = 10; // uses competitor = migration opportunity
  }
  breakdown.push({ categoria: "Fit Tecnológico", pontos: fitTech, max: 10, detalhe: techAtual === "Não identificado" ? "Sem ERP identificado (greenfield)" : `Usa: ${techAtual}` });

  // 9. NEW: Sinais de Crescimento (0-10)
  let crescimento = 0;
  const sinaisPositivos = sinais.filter(s => s.tipo === "positivo").length;
  const sinaisNegativos = sinais.filter(s => s.tipo === "negativo").length;
  crescimento = Math.min(10, sinaisPositivos * 3) - Math.min(5, sinaisNegativos * 2);
  crescimento = Math.max(0, crescimento);
  const vagasResult = externalResults.find(r => r.source === "vagas_crescimento");
  if (vagasResult && vagasResult.results.length > 0) crescimento = Math.min(10, crescimento + 2);
  breakdown.push({ categoria: "Sinais de Crescimento", pontos: crescimento, max: 10, detalhe: sinaisPositivos > 0 ? `${sinaisPositivos} sinal(is) positivo(s)` : "Sem sinais identificados" });

  const total = breakdown.reduce((s, b) => s + b.pontos, 0);
  const max = 130;
  const percentual = Math.round((total / max) * 100);

  let classificacao: LeadScore["classificacao"];
  let cor: string;
  if (percentual >= 75) { classificacao = "Muito Quente"; cor = "#22c55e"; }
  else if (percentual >= 55) { classificacao = "Quente"; cor = "#f59e0b"; }
  else if (percentual >= 35) { classificacao = "Morno"; cor = "#f97316"; }
  else { classificacao = "Frio"; cor = "#6b7280"; }

  return { total, max, percentual, classificacao, cor, breakdown };
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      console.error("Failed to parse request body:", rawBody?.slice(0, 200));
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { input, input_type, skip_cache } = parsedBody;

    if (!input || !input_type) {
      return new Response(
        JSON.stringify({ error: "Input e tipo são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==================== CASCADE LOGIC ====================
    let cnpjContext = "";
    let cnpjDataFound = false;
    let empresaNome = "";
    let cascadeContext = "";
    let cnpj = extractCnpj(input as string, input_type as string);
    let cnpjDataRef: Record<string, unknown> | null = null;

    if (cnpj) {
      console.log(`Fetching CNPJ data for: ${cnpj}`);
      const cnpjData = await fetchCnpjData(cnpj);
      cnpjDataRef = cnpjData;
      if (cnpjData) {
        cnpjContext = formatCnpjContext(cnpjData);
        cnpjDataFound = true;
        empresaNome = (cnpjData.razao_social as string) || (cnpjData.nome_fantasia as string) || "";
        console.log("Successfully fetched CNPJ data from BrasilAPI");
      }
    } else if (input_type === "nome") {
      console.log(`[Cascade] Starting name-based cascade for: "${input}"`);
      
      const linkedinSearch = await firecrawlSearch(
        `"${input}" site:linkedin.com/in`, "cascade_linkedin", { limit: 3, lang: "pt-br", country: "br" }
      );
      
      let companyFromLinkedin = "";
      if (linkedinSearch.results.length > 0) {
        const linkedinContent = linkedinSearch.results
          .map(r => `${r.title || ""} ${r.description || ""} ${r.markdown?.slice(0, 500) || ""}`)
          .join(" ");
        cascadeContext += `\n=== LINKEDIN DO SÓCIO (Cascade) ===\n${linkedinContent.slice(0, 2000)}\n`;
        console.log(`[Cascade] LinkedIn found ${linkedinSearch.results.length} results`);

        const companyPatterns = [
          /(?:at|na|em|@)\s+([A-ZÀ-Ú][A-Za-zÀ-ú\s&.,-]+(?:Ltda|S\.?A\.?|EIRELI|ME|EPP|Administradora|Imobiliária|Imóveis|Gestão|Condomín)[\w.]*)/i,
          /(?:Gerente|Diretor|Sócio|CEO|Fundador|Proprietário|Administrador)(?:\s+\w+)?\s+(?:at|na|em|-|–|·)\s+([A-ZÀ-Ú][A-Za-zÀ-ú\s&.,-]+)/i,
        ];
        for (const pattern of companyPatterns) {
          const match = linkedinContent.match(pattern);
          if (match?.[1]) {
            companyFromLinkedin = match[1].trim();
            break;
          }
        }
        if (!companyFromLinkedin) {
          for (const r of linkedinSearch.results) {
            const titleParts = (r.title || "").split(/\s*[-–·|]\s*/);
            if (titleParts.length >= 2) {
              companyFromLinkedin = titleParts[titleParts.length - 1].replace(/\s*\|?\s*LinkedIn\s*$/i, "").trim();
              if (companyFromLinkedin.length > 3) break;
            }
          }
        }
      }

      if (companyFromLinkedin) {
        console.log(`[Cascade] Company extracted from LinkedIn: "${companyFromLinkedin}"`);
        empresaNome = companyFromLinkedin;

        const cnpjSearch = await firecrawlSearch(
          `"${companyFromLinkedin}" CNPJ site:cnpj.biz OR site:casadosdados.com.br OR site:cnpja.com`,
          "cascade_cnpj", { limit: 3 }
        );

        if (cnpjSearch.results.length > 0) {
          const cnpjContent = cnpjSearch.results.map(r => `${r.title} ${r.description} ${r.markdown?.slice(0, 300)}`).join(" ");
          const cnpjMatch = cnpjContent.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
          if (cnpjMatch) {
            cnpj = cnpjMatch[0];
            console.log(`[Cascade] CNPJ found: ${cnpj}`);
            const cnpjData = await fetchCnpjData(cnpj);
            cnpjDataRef = cnpjData;
            if (cnpjData) {
              cnpjContext = formatCnpjContext(cnpjData);
              cnpjDataFound = true;
              empresaNome = (cnpjData.razao_social as string) || (cnpjData.nome_fantasia as string) || empresaNome;
              console.log(`[Cascade] Full CNPJ data fetched for: ${empresaNome}`);
            }
          }
        }
        cascadeContext += `\nEmpresa identificada via LinkedIn: ${empresaNome}${cnpj ? ` (CNPJ: ${cnpj})` : ""}`;
      } else {
        console.log(`[Cascade] Could not extract company from LinkedIn, using name as-is`);
        empresaNome = input as string;
      }
    }

    if (!empresaNome && input_type === "email") {
      empresaNome = (input as string).split("@")[1]?.split(".")[0] || (input as string);
    }
    if (!empresaNome) {
      empresaNome = input as string;
    }

    // Fetch external sources and domain info in parallel
    console.log(`Fetching external sources and domains...${skip_cache ? " (cache ignorado)" : ""}`);
    const [externalResults, domainData] = await Promise.all([
      fetchExternalSources(empresaNome, cnpj, !!skip_cache),
      fetchDomainInfo(empresaNome, cnpj, cnpjDataRef, !!skip_cache),
    ]);
    const externalContext = formatExternalContext(externalResults);
    const externalSourcesFound = externalResults.filter((r) => r.results.length > 0).map((r) => r.source);
    console.log(`External sources found: ${externalSourcesFound.join(", ") || "none"}`);
    console.log(`Domains found: ${domainData.dominios.length}`);

    // Format domain context for AI
    const domainContext = domainData.dominios.length > 0
      ? `\n\n=== DOMÍNIOS ASSOCIADOS (WHOIS/RDAP registro.br) ===\n${domainData.dominios.map(d =>
        `- ${d.dominio} | Status: ${d.status} | Criado: ${d.data_criacao || "N/I"} | Expira: ${d.data_expiracao || "N/I"} | Registrante: ${d.registrante || "N/I"}${d.cnpj_registrante ? ` (CNPJ: ${d.cnpj_registrante})` : ""}${d.nameservers ? ` | NS: ${d.nameservers.join(", ")}` : ""}`
      ).join("\n")}\n=== FIM DOMÍNIOS ===`
      : "";

    // Call AI with all context
    const userMessage = `Gere o dossiê completo ENRIQUECIDO para o seguinte lead:
Tipo de input: ${input_type}
Dado fornecido: ${input}
${cascadeContext ? `\n=== DADOS DO EFEITO CASCATA (Nome → LinkedIn → Empresa → CNPJ) ===${cascadeContext}\n=== FIM CASCATA ===` : ""}
${cnpjContext ? `\n${cnpjContext}\n\nUse os dados reais acima como base principal para o dossiê.` : ""}
${externalContext ? `\n${externalContext}\n\nUse os dados das fontes externas para enriquecer o dossiê. As fontes "protestos_negativacoes", "vagas_crescimento" e "tech_stack" são NOVAS — use-as para preencher risco_financeiro, sinais_crescimento e tecnologia_atual.` : ""}
${domainContext ? `\n${domainContext}\n\nUse os dados de domínio/WHOIS para avaliar a presença digital da empresa. Domínios ativos com registrante correspondente ao CNPJ indicam boa presença online.` : ""}

LEMBRETE OBRIGATÓRIO:
1. Na seção "logica_group_software", use ESTRITAMENTE os produtos dos catálogos Group Software e PartnerBank.
2. Preencha TODAS as novas seções: risco_financeiro, contatos_abordagem, sinais_crescimento, tecnologia_atual, is_pep para sócios.
3. Inclua "analise_fit", "modulos_sugeridos" (nomes exatos dos sites), e "gancho_venda" (copy do site).

Analise profundamente e retorne o JSON estruturado conforme o formato especificado.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes. Adicione fundos em Settings > Workspace > Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Erro ao gerar dossiê" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiText = await response.text();
    let aiData;
    try {
      aiData = JSON.parse(aiText);
    } catch {
      console.error("Failed to parse AI response:", aiText?.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "Erro ao processar resposta da IA (parsing)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ error: "Resposta vazia da IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let dossier;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      dossier = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response as JSON:", content);
      return new Response(
        JSON.stringify({ error: "Erro ao processar resposta da IA", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate lead qualification score V2
    const lead_score = calculateLeadScore(dossier, cnpjDataFound, externalResults);

    // Build data_sources metadata
    const data_sources = {
      receita_federal: cnpjDataFound,
      campos_receita: cnpjDataFound
        ? ["nome", "cnpj", "situacao", "abertura", "porte", "capital_social", "endereco", "telefone", "atividade_principal", "mapeamento_socios"]
        : [],
      campos_ia: ["redes_sociais", "formacao_academica", "historico_profissional", "linkedin", "background_provavel", "insights_estrategicos", "logica_group_software", "risco_financeiro", "contatos_abordagem", "sinais_crescimento", "tecnologia_atual"],
      fontes_externas: externalSourcesFound,
      firecrawl_details: externalResults.map((r) => ({
        source: r.source,
        found: r.results.length > 0,
        count: r.results.length,
        error: r.error || null,
      })),
    };

    return new Response(
      JSON.stringify({ success: true, dossier, data_sources, lead_score }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating dossier:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
