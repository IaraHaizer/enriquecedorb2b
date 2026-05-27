import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ==================== HELPERS ====================

const GENERIC_DOMAINS = /gmail|hotmail|outlook|live|yahoo|icloud|uol|terra|ig\.com|bol\.com|globomail|me\.com|apple|google|microsoft|googlemail|protonmail|zohomail/i;

function isGenericDomain(dom: string): boolean {
  if (!dom) return false;
  // Limpar dominio de TLDs para checagem mais assertiva (ex: gmail.com -> gmail)
  const cleanDom = dom.split('.')[0].toLowerCase();
  return GENERIC_DOMAINS.test(cleanDom) || GENERIC_DOMAINS.test(dom.toLowerCase());
}

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
  email_registrante?: string;
  nameservers?: string[];
  is_validated?: boolean;
  score?: number;
}

async function fetchRdapDomain(domain: string): Promise<DominioInfo | null> {
  // Choose RDAP endpoint based on TLD
  const rdapUrl = domain.endsWith(".br")
    ? `https://rdap.registro.br/domain/${domain}`
    : `https://rdap.org/domain/${domain}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Use IPv4-only endpoint via DNS-over-HTTPS to avoid IPv6 broken pipe issues
    const response = await fetch(`https://rdap.registro.br/domain/${domain}`, {
      headers: { 
        "Accept": "application/rdap+json",
        "User-Agent": "Mozilla/5.0",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();

    const events = (data.events || []) as Array<{ eventAction: string; eventDate: string }>;
    const registration = events.find((e) => e.eventAction === "registration");
    const expiration = events.find((e) => e.eventAction === "expiration");
    const statusList = (data.status || []) as string[];

    let registrante = "";
    let cnpjReg = "";
    let emailReg = "";
    const entities = (data.entities || []) as Array<Record<string, unknown>>;
    for (const entity of entities) {
      const roles = (entity.roles || []) as string[];
      if (roles.includes("registrant")) {
        const vcardRaw = entity.vcardArray as unknown[] | undefined;
        const vcardArray = (vcardRaw && vcardRaw.length > 1 ? vcardRaw[1] : undefined) as Array<unknown[]> | undefined;
        if (vcardArray) {
          for (const field of vcardArray) {
            if (field[0] === "fn") registrante = String(field[3] || "");
            if (field[0] === "email") {
              const emailVal = field[3];
              emailReg = Array.isArray(emailVal) ? String(emailVal[0] || "") : String(emailVal || "");
            }
          }
        }
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
      email_registrante: emailReg || undefined,
      nameservers: nameservers.length > 0 ? nameservers : undefined,
    };
  } catch (err) {
    console.warn(`[RDAP] Error for ${domain}:`, err);
    // Fallback: check if domain is alive via HTTP HEAD
    try {
      const headResp = await fetch(`https://${domain}`, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
      if (headResp.ok || headResp.status === 301 || headResp.status === 302) {
        return { dominio: domain, status: "active (HTTP)" };
      }
    } catch { /* ignore */ }
    return null;
  }
}

// Fallback: use Firecrawl to scrape registro.br WHOIS for a domain
async function fetchWhoisViaScrape(domain: string): Promise<DominioInfo | null> {
  if (!domain.endsWith(".br")) return null;
  try {
    const result = await firecrawlSearch(
      `"${domain}" site:registro.br OR whois "${domain}"`,
      `whois_${domain}`,
      { limit: 2 }
    );
    if (result.results.length === 0) return null;
    
    const text = result.results.map(r => `${r.title} ${r.description} ${r.markdown || ""}`).join(" ");
    
    // Extract dates
    const criacaoMatch = text.match(/(?:created|criado|registro|created on)[:\s]*(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})/i);
    const expiracaoMatch = text.match(/(?:expires|expira|validade|expires on)[:\s]*(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})/i);
    const registranteMatch = text.match(/(?:owner|registrante|titular)[:\s]*([^\n]+)/i);
    const cnpjMatch = text.match(/(?:ownerid|cnpj|document)[:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
    const statusMatch = text.match(/(?:status|estado)[:\s]*([\w\s]+)/i);
    
    return {
      dominio: domain,
      status: statusMatch?.[1]?.trim() || "active",
      data_criacao: criacaoMatch?.[1],
      data_expiracao: expiracaoMatch?.[1],
      registrante: registranteMatch?.[1]?.trim(),
      cnpj_registrante: cnpjMatch?.[1],
    };
  } catch (err) {
    console.warn(`[WHOIS Scrape] Error for ${domain}:`, err);
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

  const nomeFantasia = (cnpjData?.nome_fantasia as string) || "";
  const razaoSocial = (cnpjData?.razao_social as string) || empresaNome;
  
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/[àáâãä]/g, "a").replace(/[èéêë]/g, "e").replace(/[ìíîï]/g, "i")
    .replace(/[òóôõö]/g, "o").replace(/[ùúûü]/g, "u").replace(/[ç]/g, "c");

  // Activity-related keywords to combine with the company name
  const activityKeywords = extractActivityKeywords(cnpjData);

  for (const nome of [nomeFantasia, razaoSocial]) {
    if (!nome) continue;
    const cleaned = normalize(nome)
      .replace(/\b(ltda|s[. ]*a|eireli|me|epp|limitada?)\b/gi, "")
      .trim();
    
    // Full slug without common words
    const cleanedNoCommon = cleaned
      .replace(/\b(administradora|admin|gestao|servicos?|comercio|industria|do brasil|brasileira?|de|do|da|dos|das|e)\b/gi, "")
      .trim();
    const fullSlug = cleanedNoCommon.replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (fullSlug.length >= 3) {
      candidates.push(`${fullSlug}.com.br`);
      candidates.push(`${fullSlug}.com`);
    }

    // Full slug WITH activity words (e.g. "pacocondominios")
    const fullSlugWithActivity = cleaned.replace(/\b(de|do|da|dos|das|e|ltda|limitada?|s[. ]*a|eireli|me|epp)\b/gi, "").replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (fullSlugWithActivity.length >= 3 && fullSlugWithActivity !== fullSlug) {
      candidates.push(`${fullSlugWithActivity}.com.br`);
      candidates.push(`${fullSlugWithActivity}.com`);
    }

    // First meaningful words
    const words = cleanedNoCommon.split(/[\s\-–]+/).filter(w => w.length >= 3 && w.replace(/[^a-z]/g, "").length >= 3);
    for (const word of words.slice(0, 3)) {
      const w = word.replace(/[^a-z0-9]/g, "");
      if (w.length >= 3 && w !== fullSlug) {
        candidates.push(`${w}.com.br`);
        candidates.push(`${w}.com`);
        // Combine first word with activity keywords (e.g., "pacco" + "condominios")
        for (const kw of activityKeywords) {
          const combo = `${w}${kw}`;
          if (combo !== fullSlug && combo !== fullSlugWithActivity) {
            candidates.push(`${combo}.com.br`);
            candidates.push(`${combo}.com`);
          }
        }
      }
    }
  }

  // Also try the empresaNome directly if different
  if (empresaNome && empresaNome !== razaoSocial && empresaNome !== nomeFantasia) {
    const slug = normalize(empresaNome).replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (slug.length >= 3) {
      candidates.push(`${slug}.com.br`);
    }
  }

  return [...new Set(candidates)]
    .filter(d => !isGenericDomain(d))
    .slice(0, 12);
}

function extractActivityKeywords(cnpjData: Record<string, unknown> | null): string[] {
  const keywords: string[] = [];
  const atividadePrincipal = cnpjData?.atividade_principal as Array<{text?: string}> | undefined;
  const razaoSocial = (cnpjData?.razao_social as string || "").toLowerCase();
  
  // Extract from activity description and razao social
  const activityMap: Record<string, string> = {
    "condomini": "condominios",
    "imobili": "imoveis",
    "imobiliaria": "imobiliaria",
    "contabil": "contabil",
    "contabilidade": "contabilidade",
    "engenharia": "engenharia",
    "construc": "construcao",
    "incorpora": "incorporadora",
    "segur": "seguros",
    "financ": "financeira",
    "tecnolog": "tech",
    "consult": "consultoria",
  };
  
  const textToSearch = [
    razaoSocial,
    ...(atividadePrincipal || []).map(a => (a.text || "").toLowerCase()),
  ].join(" ");
  
  for (const [prefix, keyword] of Object.entries(activityMap)) {
    if (textToSearch.includes(prefix)) {
      keywords.push(keyword);
    }
  }
  
  return [...new Set(keywords)].slice(0, 3);
}

function extractSocialLinksFromMarkdown(markdown: string): string[] {
  const links: string[] = [];
  // Procura por links comuns de redes sociais
  const socialRegex = /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|facebook\.com|linkedin\.com\/company|twitter\.com|x\.com|youtube\.com)\/[a-zA-Z0-9.\-_/]+/gi;
  
  let match;
  while ((match = socialRegex.exec(markdown)) !== null) {
    let url = match[0];
    if (!url.startsWith("http")) url = "https://" + url;
    links.push(url);
  }
  
  return [...new Set(links)].slice(0, 10);
}

async function fetchDomainInfo(empresaNome: string, cnpj: string | null, cnpjData: Record<string, unknown> | null, skipCache = false): Promise<{ dominios: DominioInfo[]; firecrawlDomains: FirecrawlResult }> {
  if (isGenericDomain(empresaNome)) {
    console.log(`[Domains] CRITICAL: Skipping domain fetch for generic/provider name: "${empresaNome}"`);
    return { dominios: [], firecrawlDomains: { source: "dominios_whois", query: "", results: [] } };
  }
  const candidates = generateCandidateDomains(empresaNome, cnpjData);
  console.log(`[Domains] Candidate domains: ${candidates.join(", ")}`);

  // Query RDAP in parallel for candidate domains
  const rdapPromises = candidates.map((d) => fetchRdapDomain(d));
  
  // Search 1: CNPJ-based WHOIS search
  const cleanCnpj = cnpj?.replace(/[^\d]/g, "") || "";
  const firecrawlQuery = cleanCnpj 
    ? `"${cleanCnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}" domínio OR site OR whois registro.br`
    : `"${empresaNome}" domínio site oficial`;
  
  // Search 2: Direct company website search (catches cases like pacocondominios.com)
  const nomeFantasia = (cnpjData?.nome_fantasia as string) || "";
  const searchName = nomeFantasia || empresaNome;
  const siteSearchQuery = `"${searchName}" site oficial OR website`;
  
  const cacheKey = buildCacheKey(empresaNome, cnpj, "dominios_whois");
  const cacheKeySite = buildCacheKey(empresaNome, cnpj, "site_oficial");
  let firecrawlResult: FirecrawlResult;
  let siteSearchResult: FirecrawlResult;
  
  if (!skipCache) {
    const [cached, cachedSite] = await Promise.all([
      getCachedResult(cacheKey),
      getCachedResult(cacheKeySite),
    ]);
    firecrawlResult = cached || await firecrawlSearch(firecrawlQuery, "dominios_whois", { limit: 5 });
    siteSearchResult = cachedSite || await firecrawlSearch(siteSearchQuery, "site_oficial", { limit: 5 });
    if (!cached) await setCachedResult(cacheKey, firecrawlResult);
    if (!cachedSite) await setCachedResult(cacheKeySite, siteSearchResult);
  } else {
    [firecrawlResult, siteSearchResult] = await Promise.all([
      firecrawlSearch(firecrawlQuery, "dominios_whois", { limit: 5 }),
      firecrawlSearch(siteSearchQuery, "site_oficial", { limit: 5 }),
    ]);
    await Promise.all([
      setCachedResult(cacheKey, firecrawlResult),
      setCachedResult(cacheKeySite, siteSearchResult),
    ]);
  }

  // Combine all Firecrawl results
  const allFirecrawlResults = [...firecrawlResult.results, ...siteSearchResult.results];

  let rdapResults = (await Promise.all(rdapPromises)).filter(Boolean) as DominioInfo[];
  
  // If RDAP failed (IPv6 issues), try scraping WHOIS for .br candidates
  if (rdapResults.length === 0) {
    const brCandidates = candidates.filter(d => d.endsWith(".br")).slice(0, 3);
    const scrapeResults = await Promise.all(brCandidates.map(d => fetchWhoisViaScrape(d)));
    rdapResults = scrapeResults.filter(Boolean) as DominioInfo[];
    console.log(`[Domains] RDAP failed, scrape fallback found ${rdapResults.length} domains`);
  }
  
  // Extract additional domains from Firecrawl results (both text and URLs)
  const domainRegex = /([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|com\.br|net\.br|org\.br|inf\.br|adm\.br|imb\.br))\b/gi;
  const extraDomains = new Set<string>();
  for (const r of allFirecrawlResults) {
    const text = `${r.url || ""} ${r.title || ""} ${r.description || ""} ${r.markdown || ""}`;
    let match;
    while ((match = domainRegex.exec(text)) !== null) {
      const d = match[1].toLowerCase();
      // FILTRO RIGOROSO: Nunca aceitar domínios de provedores ou redes sociais como domínios "associados" da empresa
      if (!isGenericDomain(d) && !d.match(/registro\.br|facebook|instagram|linkedin|twitter|youtube|whois|jusbrasil|reclame|linktr|news|gazeta|folha|estadao|globo|uol|terra|metropoles|noticias?|jornal|portal|wikipedia|\.gov\.|\.edu\.|tribunal|tjsp|tjmg|tjpr|trf/)) {
        extraDomains.add(d);
      }
    }
    // Also extract domain from URL directly
    if (r.url) {
      try {
        const urlDomain = new URL(r.url).hostname.replace(/^www\./, "");
        if (!isGenericDomain(urlDomain) && !urlDomain.match(/facebook|instagram|linkedin|twitter|youtube|whois|jusbrasil|reclame|registro\.br|linktr|news|gazeta|folha|estadao|globo|uol|terra|metropoles|noticias?|jornal|portal|wikipedia|\.gov\.|\.edu\.|tribunal|tjsp|tjmg|tjpr|trf/)) {
          extraDomains.add(urlDomain);
        }
      } catch { /* ignore */ }
    }
  }

  // RDAP lookup for extra domains found via Firecrawl
  const existingDomains = new Set(rdapResults.map(r => r.dominio.toLowerCase()));
  const newDomains = [...extraDomains].filter(d => !existingDomains.has(d) && !candidates.includes(d)).slice(0, 5);
  if (newDomains.length > 0) {
    console.log(`[Domains] Extra domains from Firecrawl: ${newDomains.join(", ")}`);
    const extraRdap = await Promise.all(newDomains.map(d => fetchRdapDomain(d)));
    for (const r of extraRdap) {
      if (r) rdapResults.push(r);
    }
    // Fallback scrape for .br extras
    const failedBr = newDomains.filter((d, i) => !extraRdap[i] && d.endsWith(".br"));
    if (failedBr.length > 0) {
      const scrapeExtra = await Promise.all(failedBr.map(d => fetchWhoisViaScrape(d)));
      for (const r of scrapeExtra) {
        if (r) rdapResults.push(r);
      }
    }
  }

  // Score and filter domains by relevance to the company
  // Common geographic/generic words that shouldn't match alone
  const genericWords = new Set(["rio", "sao", "preto", "nova", "belo", "sul", "norte", "grande", "campo", "porto"]);
  
  const companyWords = empresaNome.toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !["ltda", "limitada", "administradora", "gestao", "servicos", "empresa"].includes(w));
  
  const activityWords = extractActivityKeywords(cnpjData);
  const significantWords = companyWords.filter(w => !genericWords.has(w));
  const allRelevantWords = [...companyWords, ...activityWords];
  
  const scoreDomain = (d: DominioInfo): number => {
    const domName = d.dominio.replace(/\.(com|net|org|com\.br|net\.br)$/i, "").replace(/^www\./, "").toLowerCase();
    let score = 0;
    let significantMatches = 0;
    
    for (const w of allRelevantWords) {
      if (domName.includes(w)) {
        score += genericWords.has(w) ? 2 : 10;
        if (!genericWords.has(w)) significantMatches++;
      }
    }
    // Bonus for CNPJ match in registrant
    if (d.cnpj_registrante && cnpj && d.cnpj_registrante.replace(/\D/g, "") === cnpj.replace(/\D/g, "")) {
      score += 100; // Aumentado para garantir prioridade absoluta
      d.is_validated = true;
    }
    // Requirement check for Apollo: require at least one significant word match or CNPJ match
    if (significantMatches === 0 && !d.is_validated && score < 50) score = 0;
    // Bonus for .br
    if (d.dominio.endsWith(".br")) score += 2;
    return score;
  };
  
  const scoredDomains = rdapResults
    .map(d => ({ domain: d, score: scoreDomain(d) }))
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score);
  
  const filteredDomains = scoredDomains.map(d => d.domain);
  console.log(`[Domains] Found ${filteredDomains.length} relevant domains (filtered from ${rdapResults.length}): ${filteredDomains.map(d => `${d.dominio}(${scoredDomains.find(s => s.domain === d)?.score})`).join(", ")}`);

  return { dominios: filteredDomains, firecrawlDomains: firecrawlResult };
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

// Deep scrape de uma URL específica via Firecrawl (usado no LinkedIn Deep Scrape - Fase A)
async function firecrawlScrape(url: string, sourceName: string): Promise<string> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return "";
  try {
    console.log(`[Firecrawl Scrape] ${sourceName}: ${url}`);
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 15000 }),
    });
    if (!response.ok) {
      console.warn(`[Firecrawl Scrape] ${sourceName} HTTP ${response.status}`);
      return "";
    }
    const data = await response.json();
    const md = data?.data?.markdown || data?.markdown || "";
    console.log(`[Firecrawl Scrape] ${sourceName} OK — ${md.length} chars`);
    return md;
  } catch (err) {
    console.warn(`[Firecrawl Scrape] ${sourceName} error:`, err);
    return "";
  }
}

// ============= FASE D: PORTFOLIO INTEL (map + scrape + stack detection + IA) =============

// D1: Firecrawl /map para descobrir URLs relevantes do site institucional
async function firecrawlMap(url: string, search: string | undefined, limit: number): Promise<string[]> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return [];
  try {
    console.log(`[Firecrawl Map] ${url} search="${search || ""}" limit=${limit}`);
    const response = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, search, limit, ignoreSitemap: false }),
    });
    if (!response.ok) {
      console.warn(`[Firecrawl Map] HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();
    const links: string[] = Array.isArray(data?.links) ? data.links : (Array.isArray(data?.data?.links) ? data.data.links : []);
    return links.filter((l) => typeof l === "string");
  } catch (err) {
    console.warn(`[Firecrawl Map] error:`, err);
    return [];
  }
}

// D2: Regex de detecção de stack concorrente / maturidade digital
// Cada assinatura é uma evidência. Múltiplas evidências aumentam confiança.
interface StackDetection {
  sistema_gestao: { nome: string; evidencias: string[] } | null;
  outros_sistemas_gestao: string[]; // concorrentes secundários detectados
  crm_marketing: string[];
  analytics: string[];
  app_morador: string[];
  evidencias_raw: string[];
}

const STACK_SIGNATURES: Array<{ key: string; nome: string; categoria: "gestao" | "crm" | "analytics" | "app"; patterns: RegExp[] }> = [
  // === ERPs de condomínio (concorrentes diretos da Group Software) ===
  { key: "superlogica", nome: "Superlógica", categoria: "gestao", patterns: [/superl[óo]gica/i, /superlogica\.(com|net)/i, /portal\.superlogica/i] },
  { key: "townsq", nome: "TownSq", categoria: "app", patterns: [/townsq/i, /townsq\.com\.br/i] },
  { key: "group_software", nome: "Group Software", categoria: "gestao", patterns: [/group\s*software/i, /groupsoftware\.com/i, /\bgrupo group\b/i] },
  { key: "condofy", nome: "Condofy", categoria: "gestao", patterns: [/condofy/i] },
  { key: "ucondo", nome: "uCondo", categoria: "gestao", patterns: [/\bu[\s\-]?condo\b/i, /ucondo\.com/i] },
  { key: "condomob", nome: "Condomob", categoria: "app", patterns: [/condomob/i] },
  { key: "kennec", nome: "Kennec", categoria: "gestao", patterns: [/kennec/i] },
  { key: "mycond", nome: "MyCond", categoria: "gestao", patterns: [/mycond/i, /my[\s\-]?cond/i] },
  { key: "uau", nome: "UAU Sistemas", categoria: "gestao", patterns: [/\buau\s*sistemas?\b/i, /globaltec/i] },
  // === CRM / Marketing ===
  { key: "rdstation", nome: "RD Station", categoria: "crm", patterns: [/rdstation/i, /rd\.station/i, /d335\.com/i] },
  { key: "pipedrive", nome: "Pipedrive", categoria: "crm", patterns: [/pipedrive/i] },
  { key: "hubspot", nome: "HubSpot", categoria: "crm", patterns: [/hubspot/i, /hs-scripts\.com/i] },
  { key: "activecampaign", nome: "ActiveCampaign", categoria: "crm", patterns: [/activecampaign/i] },
  // === Analytics / Tag Managers ===
  { key: "gtag", nome: "Google Analytics / GA4", categoria: "analytics", patterns: [/gtag\.js/i, /google-analytics\.com/i, /googletagmanager\.com/i, /gtag\(/i] },
  { key: "meta_pixel", nome: "Meta Pixel (Facebook)", categoria: "analytics", patterns: [/fbq\(/i, /connect\.facebook\.net.*fbevents/i] },
  { key: "hotjar", nome: "Hotjar", categoria: "analytics", patterns: [/hotjar/i, /static\.hotjar\.com/i] },
  { key: "clarity", nome: "Microsoft Clarity", categoria: "analytics", patterns: [/clarity\.ms/i, /clarity\.start/i] },
  { key: "tawk", nome: "Tawk.to (chat)", categoria: "crm", patterns: [/tawk\.to/i] },
  { key: "zendesk", nome: "Zendesk", categoria: "crm", patterns: [/zendesk\.com/i, /zdassets\.com/i] },
];

function detectStackFromText(raw: string): StackDetection {
  const result: StackDetection = {
    sistema_gestao: null,
    outros_sistemas_gestao: [],
    crm_marketing: [],
    analytics: [],
    app_morador: [],
    evidencias_raw: [],
  };
  if (!raw) return result;
  const text = raw.slice(0, 200000); // cap defensivo
  const hits: Array<{ key: string; nome: string; categoria: string; evidence: string }> = [];
  for (const sig of STACK_SIGNATURES) {
    for (const pat of sig.patterns) {
      const m = text.match(pat);
      if (m) {
        hits.push({ key: sig.key, nome: sig.nome, categoria: sig.categoria, evidence: m[0].slice(0, 80) });
        result.evidencias_raw.push(`${sig.nome}: "${m[0].slice(0, 80)}"`);
        break;
      }
    }
  }
  const gestaoHits = hits.filter((h) => h.categoria === "gestao");
  const appHits = hits.filter((h) => h.categoria === "app");
  if (gestaoHits.length > 0) {
    result.sistema_gestao = { nome: gestaoHits[0].nome, evidencias: gestaoHits.slice(0, 3).map((h) => h.evidence) };
    result.outros_sistemas_gestao = gestaoHits.slice(1).map((h) => h.nome);
  }
  result.app_morador = Array.from(new Set(appHits.map((h) => h.nome)));
  result.crm_marketing = Array.from(new Set(hits.filter((h) => h.categoria === "crm").map((h) => h.nome)));
  result.analytics = Array.from(new Set(hits.filter((h) => h.categoria === "analytics").map((h) => h.nome)));
  return result;
}

// Wrapper: scrape com cache (reaproveita firecrawl_cache de 7d para páginas de portfólio)
async function cachedSiteScrape(url: string, sourceName: string, telemetry: { cacheHits: number; scrapes: number }): Promise<{ markdown: string; html: string }> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return { markdown: "", html: "" };
  try {
    const sb = getSupabaseAdmin();
    const cacheKey = `site_scrape:${url.toLowerCase()}`;
    const { data: cached } = await sb
      .from("firecrawl_cache")
      .select("results, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached && cached.expires_at && new Date(cached.expires_at) > new Date()) {
      telemetry.cacheHits++;
      const r = cached.results as Record<string, string>;
      return { markdown: r?.markdown || "", html: r?.html || "" };
    }
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown", "html"], onlyMainContent: false, timeout: 15000 }),
    });
    telemetry.scrapes++;
    if (!response.ok) return { markdown: "", html: "" };
    const data = await response.json();
    const md = data?.data?.markdown || data?.markdown || "";
    const html = data?.data?.html || data?.html || "";
    if (md.length > 100 || html.length > 500) {
      await sb.from("firecrawl_cache").upsert({
        cache_key: cacheKey,
        source_name: sourceName,
        query: url,
        results: { markdown: md.slice(0, 50000), html: html.slice(0, 100000) },
        error: null,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "cache_key" });
    }
    return { markdown: md, html };
  } catch (err) {
    console.warn(`[Site Scrape] ${sourceName} error:`, err);
    return { markdown: "", html: "" };
  }
}

// D3: Extração de portfólio por IA a partir do markdown consolidado
interface PortfolioIntel {
  total_condominios_estimado: number | null;
  tipologia_predominante: string | null; // residencial, comercial, misto, alto padrão...
  bairros_atendidos: string[];
  cidades_atendidas: string[];
  ticket_medio_estimado_cota: string | null; // ex: "R$ 800-1.500"
  diferenciais_declarados: string[];
  evidencias: string[]; // trechos literais do site que embasam as inferências
  confianca: "alta" | "média" | "baixa";
}

async function extractPortfolioWithAI(consolidatedMarkdown: string, brand: string, municipio: string | null, uf: string | null): Promise<PortfolioIntel | null> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY || !consolidatedMarkdown || consolidatedMarkdown.length < 200) return null;
  const sys = `Você é um analista B2B que extrai inteligência de portfólio de administradoras de condomínios e imobiliárias a partir do conteúdo do site delas. Retorne SOMENTE JSON válido, sem markdown, sem comentários.`;
  const user = `Empresa: ${brand} (${municipio || "?"}/${uf || "?"})

CONTEÚDO CONSOLIDADO DAS PÁGINAS INSTITUCIONAIS / PORTFÓLIO:
"""
${consolidatedMarkdown.slice(0, 18000)}
"""

Extraia o seguinte JSON (use null/[] quando não houver evidência clara — NÃO INVENTE):
{
  "total_condominios_estimado": number | null,
  "tipologia_predominante": string | null,
  "bairros_atendidos": string[],
  "cidades_atendidas": string[],
  "ticket_medio_estimado_cota": string | null,
  "diferenciais_declarados": string[],
  "evidencias": string[],
  "confianca": "alta" | "média" | "baixa"
}

REGRAS:
- "evidencias" deve conter 2-5 trechos LITERAIS curtos do conteúdo (≤140 chars cada) que sustentam as outras respostas.
- Para "total_condominios_estimado": só preencha se houver número explícito ("administramos 120 condomínios", "+200 empreendimentos").
- "ticket_medio_estimado_cota": só preencha se houver indício real (faixa, padrão alto declarado, condomínios premium). Caso contrário null.
- "confianca": "alta" se ≥3 evidências sólidas; "média" se 1-2; "baixa" se inferência fraca.`;
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://groupradar.lovable.app",
        "X-Title": "GroupRadar PortfolioIntel",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        max_tokens: 1200,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      console.warn(`[Portfolio AI] HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as PortfolioIntel;
  } catch (err) {
    console.warn("[Portfolio AI] parse/fetch error:", err);
    return null;
  }
}

// ============= LINKEDIN PHASE C: Cache + Dedup + Confidence Score =============

// Normaliza URLs do LinkedIn pra deduplicar variantes (?trk=, trailing slash, www, casing)
function normalizeLinkedinUrl(raw: string): string {
  if (!raw) return "";
  try {
    let u = raw.trim().split("?")[0].split("#")[0];
    u = u.replace(/\/+$/, "");
    u = u.replace(/^https?:\/\/(www\.)?/i, "https://www.");
    return u.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

// Cache 7d para /company/ e /in/ (mudam pouco); 24h para jobs/posts (sinais voláteis)
async function cachedLinkedinScrape(
  url: string,
  sourceName: string,
  ttlHours: number,
  telemetry: { cacheHits: number; scrapes: number },
): Promise<string> {
  const normalized = normalizeLinkedinUrl(url);
  if (!normalized) return "";
  try {
    const sb = getSupabaseAdmin();
    const { data: cached } = await sb
      .from("linkedin_scrape_cache")
      .select("markdown, expires_at")
      .eq("url", normalized)
      .maybeSingle();
    if (cached && cached.expires_at && new Date(cached.expires_at) > new Date()) {
      telemetry.cacheHits++;
      console.log(`[LinkedIn Cache] HIT ${sourceName} ${normalized}`);
      return (cached.markdown as string) || "";
    }
    const md = await firecrawlScrape(url, sourceName);
    telemetry.scrapes++;
    if (md && md.length > 100) {
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
      await sb.from("linkedin_scrape_cache").upsert({
        url: normalized,
        source: sourceName,
        markdown: md,
        scraped_at: new Date().toISOString(),
        expires_at: expiresAt,
      }, { onConflict: "url" });
    }
    return md;
  } catch (err) {
    console.warn(`[LinkedIn Cache] error ${sourceName}:`, err);
    return await firecrawlScrape(url, sourceName);
  }
}

// Similaridade simples (Jaccard de tokens) — 0..1
function tokenSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 2);
  const sa = new Set(norm(a));
  const sb = new Set(norm(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

// Confidence 0-100 para uma página /company/ raspada
function scoreCompanyPage(opts: {
  slug: string;
  markdown: string;
  brand: string;
  domain?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cnae?: string | null;
}): number {
  let score = 0;
  const md = (opts.markdown || "").toLowerCase();
  const slugClean = opts.slug.replace(/-/g, " ");
  // slug vs brand
  const slugSim = tokenSimilarity(slugClean, opts.brand);
  score += Math.round(slugSim * 30);
  // domain mention in markdown (forte)
  if (opts.domain && md.includes(opts.domain.toLowerCase().replace(/^www\./, ""))) score += 30;
  // brand mention in markdown
  if (tokenSimilarity(md.slice(0, 4000), opts.brand) > 0.15) score += 15;
  // cidade/UF
  if (opts.municipio && md.includes(opts.municipio.toLowerCase())) score += 15;
  else if (opts.uf && new RegExp(`\\b${opts.uf.toLowerCase()}\\b`).test(md)) score += 5;
  // CNAE keyword
  if (opts.cnae) {
    const cnaeTokens = opts.cnae.toLowerCase().split(/\s+/).filter((t) => t.length > 4).slice(0, 3);
    if (cnaeTokens.some((t) => md.includes(t))) score += 10;
  }
  return Math.min(100, score);
}

// Confidence 0-100 para uma página /in/<socio>
function scorePersonPage(opts: {
  markdown: string;
  socioNome: string;
  brand: string;
}): number {
  let score = 0;
  const md = (opts.markdown || "").toLowerCase();
  const firstChunk = md.slice(0, 1500); // headline + experiência atual
  // nome do sócio: tokens raros tem que aparecer
  const nameTokens = opts.socioNome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/).filter((t) => t.length > 3);
  const nameHits = nameTokens.filter((t) => firstChunk.includes(t)).length;
  if (nameTokens.length > 0) score += Math.round((nameHits / nameTokens.length) * 50);
  // marca aparece no headline/experiência?
  if (tokenSimilarity(firstChunk, opts.brand) > 0.2) score += 35;
  else if (md.includes(opts.brand.toLowerCase())) score += 15;
  // perfil real (tem cargo/experiência típicos)
  if (/experi[eê]ncia|experience|cargo|founder|ceo|cto|diretor|s[óo]cio/i.test(firstChunk)) score += 15;
  return Math.min(100, score);
}

// Apollo desativado temporariamente (plano free não permite /people/match).
// Enriquecimento de pessoas/contatos agora é feito via Seekloc (Unitfour).
// Mantemos a assinatura para não quebrar o fluxo existente.
async function fetchApolloEnrichment(_options: {
  firstName?: string;
  lastName?: string;
  email?: string;
  domain?: string;
}): Promise<Record<string, unknown> | null> {
  console.log("[Apollo] Disabled — usando Seekloc para enriquecimento de contatos.");
  return null;
}

async function fetchIbgeData(codigoIbge: string | number | null | undefined): Promise<Record<string, unknown> | null> {
  if (codigoIbge === null || codigoIbge === undefined || codigoIbge === "") return null;
  const cleanCode = String(codigoIbge).replace(/\D/g, "");
  if (cleanCode.length < 6) return null;
  
  try {
    console.log(`[IBGE] Fetching data for N6: ${cleanCode}`);
    
    const popUrl = `https://servicodados.ibge.gov.br/api/v3/agregados/9514/periodos/-1/variaveis/93?localidades=N6[${cleanCode}]`;
    const pibUrl = `https://servicodados.ibge.gov.br/api/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[${cleanCode}]`;

    const [popResp, pibResp] = await Promise.all([
      fetch(popUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(pibUrl).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    const result: Record<string, any> = {};

    if (popResp && Array.isArray(popResp) && popResp[0]?.resultados?.[0]?.series?.[0]?.serie) {
      const series = popResp[0].resultados[0].series[0].serie;
      const years = Object.keys(series).sort().reverse();
      const lastYear = years[0];
      if (lastYear) {
        result.populacao = series[lastYear];
        result.populacao_ano = lastYear;
      }
    }

    if (pibResp && Array.isArray(pibResp) && pibResp[0]?.resultados?.[0]?.series?.[0]?.serie) {
      const series = pibResp[0].resultados[0].series[0].serie;
      const years = Object.keys(series).sort().reverse();
      const lastYear = years[0];
      if (lastYear) {
        result.pib = series[lastYear];
        result.pib_ano = lastYear;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    console.warn("[IBGE] Error fetching data:", err);
    return null;
  }
}

async function fetchSeeklocData(params: { documento?: string; email?: string; nome?: string }): Promise<Record<string, any> | null> {
  const user = Deno.env.get("SEEKLOC_USER");
  const pwd = Deno.env.get("SEEKLOC_PWD");
  const emp = Deno.env.get("SEEKLOC_EMP");

  if (!user || !pwd || !emp) {
    console.warn("[Seekloc] Credentials not configured");
    return null;
  }

  try {
    console.log(`[Seekloc] Querying for: ${JSON.stringify(params)} (Step 1: Search)`);
    
    // Passo 1: Buscar o ID interno do Seekloc
    const form1 = new FormData();
    form1.append("usr", user);
    form1.append("pwd", pwd);
    form1.append("emp", emp);
    form1.append("tp", "14"); 

    if (params.documento) {
      form1.append("doc", params.documento.replace(/[^\d]/g, ""));
    } else if (params.email) {
      form1.append("mail", params.email);
    } else if (params.nome) {
      form1.append("nm", params.nome);
    } else {
      return null;
    }

    const response1 = await fetch("http://200.201.193.100/seekloc/ws.php", {
      method: "POST",
      body: form1,
    });

    if (!response1.ok) {
      console.warn(`[Seekloc] Step 1 Error ${response1.status}`);
      return null;
    }

    const data1 = await response1.json();
    
    // Verificar se encontrou o documento e tem um ID
    const seeklocId = data1.docs?.[0]?.id || data1.pessoa?.id;
    const foundDoc = params.documento?.replace(/[^\d]/g, "") || data1.docs?.[0]?.doc || data1.pessoa?.doc;
    
    if (!seeklocId) {
      console.log(`[Seekloc] No ID found for search criteria.`);
      return data1; 
    }

    console.log(`[Seekloc] Found ID: ${seeklocId}. (Step 2: Details)`);

    // Passo 2: Buscar detalhes usando o ID
    const form2 = new FormData();
    form2.append("usr", user);
    form2.append("pwd", pwd);
    form2.append("emp", emp);
    form2.append("tp", "3"); 
    form2.append("id", seeklocId);
    if (foundDoc) form2.append("doc", foundDoc);

    const response2 = await fetch("http://200.201.193.100/seekloc/ws.php", {
      method: "POST",
      body: form2,
    });

    if (!response2.ok) {
      console.warn(`[Seekloc] Step 2 Error ${response2.status}`);
      return data1; // Fallback para data1
    }

    const data2 = await response2.json();
    console.log(`[Seekloc] Step 2 Success. Data points found.`);
    return data2 || data1;

  } catch (err) {
    console.warn("[Seekloc] Fetch error:", err);
    return null;
  }
}

function formatSeeklocContext(data: any): string {
  if (!data) return "";

  const ocorrencia = data.ocorrencia || {};
  if (ocorrencia.codocor && ocorrencia.codocor !== "0") {
    console.log(`[Seekloc] API returned non-zero code: ${ocorrencia.codocor} - ${ocorrencia.msgocor}`);
    return "";
  }

  // CORREÇÃO CRÍTICA: os campos do Seekloc vêm no ROOT, não em data.pessoa
  // (data.pessoa só existe em alguns endpoints legados; o tp=3 retorna tudo no root)
  const p: any = data.pessoa && Object.keys(data.pessoa).length > 0 ? data.pessoa : data;

  const doc = (p.doc || "").replace(/^0+/, "");
  const isPJ = doc.length > 11;
  const tipo = isPJ ? "Pessoa Jurídica" : "Pessoa Física";

  // Datas formatadas (yyyymmdd ou ddmmyyyy)
  const fmtDate = (raw: string) => {
    if (!raw || raw.length < 8) return "";
    // dois formatos possíveis
    if (/^\d{8}$/.test(raw)) {
      // yyyymmdd
      if (raw.startsWith("19") || raw.startsWith("20")) return `${raw.slice(6,8)}/${raw.slice(4,6)}/${raw.slice(0,4)}`;
      // ddmmyyyy
      return `${raw.slice(0,2)}/${raw.slice(2,4)}/${raw.slice(4,8)}`;
    }
    return raw;
  };
  const dtNascAbertura = fmtDate(p.dtnasc_abertura);
  const dtSituacao = fmtDate(p.dtsituacao);
  const dtObito = fmtDate(p.dtobito);

  // Telefones — LIMITADO para não estourar contexto/tokens (empresas grandes podem ter 50+ números)
  const telefonesObj = p.telefones || {};
  const fixos = (Array.isArray(telefonesObj.fixo) ? telefonesObj.fixo : []).slice(0, 3);
  const celulares = (Array.isArray(telefonesObj.celulares) ? telefonesObj.celulares : []).slice(0, 8);
  const totalFixos = telefonesObj.qtdefix ?? (Array.isArray(telefonesObj.fixo) ? telefonesObj.fixo.length : 0);
  const totalCel = telefonesObj.qtdecel ?? (Array.isArray(telefonesObj.celulares) ? telefonesObj.celulares.length : 0);
  const phonesList: string[] = [];
  fixos.forEach((t: any) => phonesList.push(`(${t.ddd}) ${t.fone} [Fixo]`));
  celulares.forEach((t: any) => phonesList.push(`(${t.ddd}) ${t.fone} [Celular/WhatsApp]`));

  // E-mails — limitado a 5
  const emailsRaw = p.emails || {};
  const emailsArrRaw = Array.isArray(emailsRaw) ? emailsRaw : (Array.isArray(emailsRaw.email) ? emailsRaw.email : []);
  const emailsList = emailsArrRaw.map((e: any) => (typeof e === "string" ? e : e.email)).filter(Boolean).slice(0, 5);
  const totalEmails = emailsRaw.qtde ?? emailsArrRaw.length;

  // Endereços
  const enderecosObj = p.enderecos || {};
  const addressesArr = Array.isArray(enderecosObj.endereco) ? enderecosObj.endereco : (Array.isArray(enderecosObj) ? enderecosObj : []);
  const addressLines = addressesArr.map((e: any) =>
    `- ${e.tipo || ""} ${e.logradouro || ""}${e.numero ? `, ${String(e.numero).replace(/^0+/, "") || "s/n"}` : ""}${e.complemento ? ` (${e.complemento})` : ""} - ${e.bairro || ""} - ${e.cidade || ""}/${e.uf || ""} (CEP: ${e.cep || ""})`
  );

  // Veículos
  const veiculosArr = Array.isArray(p.veiculos?.veiculo) ? p.veiculos.veiculo : [];
  const veiculosLines = veiculosArr.slice(0, 10).map((v: any) =>
    `- ${v.marca || ""} ${v.modelo || ""} ${v.anomodelo || v.ano || ""} ${v.placa ? `(${v.placa})` : ""} ${v.combustivel || ""}`.replace(/\s+/g, " ").trim()
  );

  // Quadro societário (sócios da PJ)
  const qsocArr = Array.isArray(p.quadrosoc?.qsoc) ? p.quadrosoc.qsoc : [];
  const qsocLines = qsocArr.slice(0, 15).map((s: any) =>
    `- ${s.nome || "N/I"} (CPF/CNPJ: ${s.doc || "N/I"}) - ${s.qualific || s.cargo || "Sócio(a)"}${s.percentual ? ` | ${s.percentual}%` : ""}`
  );

  // Participações societárias (em quais outras empresas a pessoa/empresa é sócia)
  const participArr = Array.isArray(p.participsoc?.participsoc) ? p.participsoc.participsoc : (Array.isArray(p.participsoc?.particip) ? p.participsoc.particip : []);
  const participLines = participArr.slice(0, 15).map((e: any) =>
    `- ${e.nome || e.razao || "N/I"} (CNPJ: ${e.doc || e.cnpj || "N/I"})${e.qualific ? ` - ${e.qualific}` : ""}${e.percentual ? ` | ${e.percentual}%` : ""}${e.uf || e.cidade ? ` | ${e.cidade || ""}/${e.uf || ""}` : ""}`
  );

  // Vínculos empregatícios (PF)
  const empregosArr = Array.isArray(p.empregos?.emprego) ? p.empregos.emprego : [];
  const empregosLines = empregosArr.slice(0, 10).map((e: any) =>
    `- ${e.empresa || e.nome || "N/I"} (CNPJ: ${e.doc || "N/I"})${e.cargo ? ` - ${e.cargo}` : ""}${e.dtadmissao ? ` | Adm: ${fmtDate(e.dtadmissao)}` : ""}${e.dtdemissao ? ` | Dem: ${fmtDate(e.dtdemissao)}` : " | ATIVO"}`
  );

  // Cheques sem fundo (CCF) — red flag financeiro
  const ccfArr = Array.isArray(p.ccfs?.ccf) ? p.ccfs.ccf : [];
  const ccfQtde = p.ccfs?.qtde ? Number(p.ccfs.qtde) : ccfArr.length;
  const ccfLines = ccfArr.slice(0, 5).map((c: any) =>
    `- Banco ${c.banco || "N/I"} | Ag: ${c.agencia || "N/I"} | Qtde: ${c.qtde || 1} | Última: ${fmtDate(c.dtult || "")}`
  );

  // Vizinhos (leads adjacentes no mesmo endereço/condomínio)
  const vizinhosArr = Array.isArray(p.vizinhos?.vizinho) ? p.vizinhos.vizinho : [];
  const vizinhosLines = vizinhosArr.slice(0, 5).map((v: any) =>
    `- ${v.nome || "N/I"} (CPF: ${(v.cpf || "").replace(/^0+/, "")}) - ${v.logradouro || ""} ${v.numero || ""}`
  );

  // Irmãos / relacionamentos familiares (apenas para PF)
  const irmaosArr = Array.isArray(p.irmaos?.irmao) ? p.irmaos.irmao : [];
  const irmaosLines = irmaosArr.slice(0, 5).map((i: any) =>
    `- ${i.nome || "N/I"} (CPF: ${(i.doc || i.cpf || "").replace(/^0+/, "")})`
  );

  const hasNothing = !p.nome && phonesList.length === 0 && emailsList.length === 0 && addressLines.length === 0 && qsocLines.length === 0;
  if (hasNothing) return "";

  return `
=== DADOS COMPLEMENTARES SEEKLOC / UNITFOUR (${tipo}) ===
Nome/Razão Social: ${p.nome || "N/I"}
${p.fantasia ? `Nome Fantasia: ${p.fantasia}\n` : ""}Documento: ${doc || "N/I"}
${!isPJ && p.mae ? `Nome da Mãe: ${p.mae}\n` : ""}${dtNascAbertura ? `${isPJ ? "Data de Abertura" : "Data de Nascimento"}: ${dtNascAbertura}\n` : ""}${p.situacao ? `Situação: ${p.situacao}${dtSituacao ? ` (desde ${dtSituacao})` : ""}\n` : ""}${dtObito ? `⚠️ ÓBITO REGISTRADO: ${dtObito}\n` : ""}
TELEFONES (mostrando ${phonesList.length} de ${Number(totalFixos) + Number(totalCel)} disponíveis):
${phonesList.length ? phonesList.map(t => `- ${t}`).join("\n") : "Nenhum"}

E-MAILS (mostrando ${emailsList.length} de ${totalEmails} disponíveis):
${emailsList.length ? emailsList.map(e => `- ${e}`).join("\n") : "Nenhum"}

ENDEREÇOS HISTÓRICOS (${addressLines.length}):
${addressLines.length ? addressLines.join("\n") : "Nenhum"}
${qsocLines.length ? `\nQUADRO SOCIETÁRIO ATUAL (${qsocArr.length}):\n${qsocLines.join("\n")}\n` : ""}${participLines.length ? `\nPARTICIPAÇÕES EM OUTRAS EMPRESAS (${participArr.length}) — INDICADOR DE GRUPO ECONÔMICO:\n${participLines.join("\n")}\n` : ""}${empregosLines.length ? `\nVÍNCULOS EMPREGATÍCIOS (${empregosArr.length}):\n${empregosLines.join("\n")}\n` : ""}${veiculosLines.length ? `\nVEÍCULOS REGISTRADOS (${veiculosArr.length}) — SINAL DE PORTE/FROTA:\n${veiculosLines.join("\n")}\n` : ""}${ccfQtde > 0 ? `\n🚨 CHEQUES SEM FUNDO (CCF) — ${ccfQtde} ocorrências:\n${ccfLines.join("\n") || "(detalhes não disponíveis)"}\n` : ""}${vizinhosLines.length ? `\nVIZINHOS/CONTATOS NO MESMO ENDEREÇO (${vizinhosArr.length}) — POSSÍVEIS LEADS ADJACENTES:\n${vizinhosLines.join("\n")}\n` : ""}${irmaosLines.length ? `\nRELACIONAMENTOS FAMILIARES (${irmaosArr.length}):\n${irmaosLines.join("\n")}\n` : ""}
INSTRUÇÕES OBRIGATÓRIAS DE USO DOS DADOS SEEKLOC:
1. ⚠️ LIMITE RÍGIDO: inclua no máximo 6 contatos em "contatos_abordagem" (priorize 1 fixo principal + até 5 celulares/WhatsApp DISTINTOS). NUNCA repita o mesmo telefone, NUNCA gere uma entrada por cada número listado. Se houver mais números, mencione "X linhas adicionais disponíveis no Seekloc" em vez de listá-las.
2. Se houver PARTICIPAÇÕES EM OUTRAS EMPRESAS, preencha "grupos_economicos.identificado = true" e liste cada CNPJ encontrado em "grupos_economicos.detalhes" — isso revela o REAL tamanho do grupo (muito além do que aparece em buscas públicas).
3. Se houver VÍNCULOS EMPREGATÍCIOS (PF), use o histórico para inferir maturidade profissional, setores anteriores e nível hierárquico do decisor — alimente "socio_principal.historico_profissional".
4. Se houver VEÍCULOS, use a quantidade/tipo (utilitários, carros executivos, frota) como sinal complementar de porte e perfil patrimonial — mencione em "sinais_crescimento" se relevante.
5. Se houver CCF (cheques sem fundo) com qtde > 0, ELEVE "risco_financeiro.nivel_risco" para "Alto" e detalhe em "risco_financeiro.negativacoes" — é red flag crítico.
6. Se houver ÓBITO registrado para a PF, sinalize URGENTE em status_integridade e oriente a abordagem para outro sócio/decisor.
7. Use o NOME DA MÃE (PF) APENAS para validação interna de identidade (KYC) — NUNCA exponha esse dado no dossiê visível ao usuário final.
8. Os ENDEREÇOS HISTÓRICOS revelam mudanças/expansão — se houver endereços em cidades diferentes, mencione possível atuação multi-praça.
9. Os VIZINHOS NO MESMO ENDEREÇO podem ser empresas/pessoas do mesmo prédio comercial — mencione em "insights_estrategicos" como possíveis leads adjacentes para prospecção secundária (sem expor CPFs).
10. Se a Receita Federal divergir do Seekloc, prefira o SEEKLOC para contato (telefone/e-mail) e a RECEITA para dados cadastrais oficiais (razão social, capital, situação).
=== FIM SEEKLOC ===`;
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

function cleanCompanyNameForSearch(name: string): string {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\b(ltda|s\.?a\.?|eireli|me|epp|limitada?|despachos|assessoria|administracao|gestao|condominios?|imobiliaria|servicos?|comercio|industria|do brasil|brasileira?|de|do|da|dos|das|e)\b/gi, "")
    .replace(/[^a-z0-9\sà-ÿ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchGooglePlacesData(nomeEmpresa: string, endereco?: string): Promise<Record<string, unknown> | null> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey || !nomeEmpresa) return null;
  
  try {
    const query = encodeURIComponent(`${nomeEmpresa} ${endereco || ""}`.trim());
    const searchUrl = `https://places.googleapis.com/v1/places:searchText`;
    
    console.log(`[Google Places] Searching for: ${query}`);
    const searchResponse = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress,places.reviews"
      },
      body: JSON.stringify({
        textQuery: `${nomeEmpresa} ${endereco || ""}`.trim(),
        languageCode: "pt-BR"
      })
    });
    
    if (!searchResponse.ok) {
      console.warn(`[Google Places] Search failed: ${searchResponse.status}`);
      return null;
    }
    
    const searchData = await searchResponse.json();
    if (!searchData.places || searchData.places.length === 0) {
      console.log(`[Google Places] No place found for: ${nomeEmpresa}`);
      return null;
    }
    
    const place = searchData.places[0];

    const reviews = Array.isArray(place.reviews)
      ? place.reviews.slice(0, 8).map((r: any) => ({
          autor: r.authorAttribution?.displayName || "Anônimo",
          nota: r.rating,
          data: r.publishTime || r.relativePublishTimeDescription,
          texto: (r.text?.text || r.originalText?.text || "").slice(0, 600),
        })).filter((r: any) => r.texto)
      : [];

    return {
      id: place.id,
      nome: place.displayName?.text,
      rating: place.rating,
      user_ratings_total: place.userRatingCount,
      endereco: place.formattedAddress,
      reviews,
    };
  } catch (err) {
    console.warn(`[Google Places] Error:`, err);
    return null;
  }
}

async function fetchExternalSources(
  empresaNome: string,
  nomeFantasia?: string,
  dominio?: string,
  cnpj?: string | null,
  endereco?: string,
  skipCache = false,
  isFastMode = false
): Promise<FirecrawlResult[]> {
  const searchName = empresaNome || cnpj || "";
  if (!searchName) return [];

  const cleanedName = cleanCompanyNameForSearch(empresaNome);
  const cleanedFantasia = nomeFantasia ? cleanCompanyNameForSearch(nomeFantasia) : "";
  const brandName = cleanedFantasia || cleanedName || searchName;

  // Build a smart query for LinkedIn
  const linkedinQuery = dominio 
    ? `(${brandName} OR site:${dominio}) site:linkedin.com/company`
    : `(${brandName} OR "${empresaNome}") site:linkedin.com/company`;

  const sources = [
    { name: "reclame_aqui", query: `${brandName} site:reclameaqui.com.br`, opts: { limit: 3 } },
    { name: "jusbrasil_escavador", query: `${brandName} (site:jusbrasil.com.br OR site:escavador.com)`, opts: { limit: 3 } },
    { name: "linkedin", query: linkedinQuery, opts: { limit: 5 } },
    { name: "instagram", query: `${brandName} site:instagram.com`, opts: { limit: 3 } },
    { name: "facebook", query: `${brandName} site:facebook.com`, opts: { limit: 3 } },
    { name: "youtube", query: `${brandName} site:youtube.com`, opts: { limit: 2 } },
    { name: "twitter_x", query: `${brandName} site:twitter.com OR site:x.com`, opts: { limit: 2 } },
    { name: "google_news", query: `${brandName} notícias`, opts: { limit: 3, tbs: "qdr:y" } },
    { name: "protestos_negativacoes", query: `${brandName} protesto OR negativação OR serasa`, opts: { limit: 3 } },
    { name: "vagas_crescimento", query: `${brandName} vagas OR contratando OR expansão`, opts: { limit: 3, tbs: "qdr:m" } },
    { name: "tech_stack", query: `${brandName} ERP OR software OR superlógica OR condomob`, opts: { limit: 3 } },
    { name: "localizacao_contatos", query: `${brandName} site:casadosdados.com.br OR site:econodata.com.br OR site:cnpja.com`, opts: { limit: 3 } },
  ];

  // In Fast Mode, we skip most extensive searches to save time and credits
  const filteredSources = isFastMode 
    ? sources.filter(s => ["linkedin", "jusbrasil_escavador", "localizacao_contatos"].includes(s.name))
    : sources;

  if (dominio) {
    filteredSources.push({
      name: "direct_contacts",
      query: `site:${dominio} "whatsapp" OR "fale conosco" OR "contato" OR "sac"`,
      opts: { limit: 2 }
    });
  }

  if (endereco && !isFastMode) {
    const cleanAddr = endereco.replace(/\d{5}-\d{3}/, "").replace(/\b(sala|andar|bloco|loja|galpao|andar|mezzanino)\b.*$/i, "").trim();
    if (cleanAddr.length > 10) {
      filteredSources.push({ 
        name: "grupo_economico", 
        query: `"${cleanAddr}" site:casadosdados.com.br OR site:econodata.com.br "outras empresas"`, 
        opts: { limit: 3 } 
      });
    }
  }

  const results = await Promise.all(
    filteredSources.map(async (s) => {
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

// (extractSocialLinksFromMarkdown definida acima — duplicata removida)

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

const SYSTEM_PROMPT = `Você é o Group Radar, um Especialista em Inteligência Comercial B2B sênior e peça central do ecossistema Group Software. Sua missão é transformar dados brutos de Administradoras de Condomínios e Imobiliárias em um dossiê estratégico de alta conversão.

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

⚠️ REGRA CRÍTICA — DOMÍNIO INTERNO / JÁ CLIENTE:
- Se o campo "AVISO:" no contexto indicar que o e-mail pertence a um domínio da Group Software ou PartnerBank (ex: groupsoftware.com.br, partnerbank.com.br), você está analisando um FUNCIONÁRIO ou PARCEIRO INTERNO, e NÃO um lead externo.
- Nesse caso: (a) Preencha "logica_group_software.analise_fit" indicando que a pessoa já é interna à Group Software. (b) NUNCA sugira venda de produtos Group para alguém que já trabalha lá. (c) Redirecione o foco para o PERFIL PROFISSIONAL da pessoa, suas conexões externas, e possíveis oportunidades de indicação/parceria. (d) Em "logica_group_software.gancho_venda", escreva "NÃO APLICÁVEL — Lead interno. Analisar como oportunidade de advocacia ou indicação."

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

CONTEXTO REGIONAL (insights_estrategicos.contexto_regional):
- Com base no endereço/UF/cidade do lead, forneça inteligência regional rica e acionável.
- Inclua: tamanho estimado do mercado local (condomínios, imobiliárias), se é capital ou interior, presença da Group Software na região (ex: "sede em BH, forte atuação em MG"), concorrentes regionais ativos, associações do setor (SECOVI, ABADI, AABIC, etc.), eventos/feiras do setor na região, cultura de negócios local, sazonalidade relevante.
- Use esses dados para sugerir abordagens contextualizadas: ex: "Lead mineiro — reforce a autoridade de 28 anos no estado. Somos líderes absolutos em Minas Gerais."
- Se o lead for de uma região onde a Group tem menor presença, sugira estratégia de entrada.
- NUNCA deixe vazio. Mesmo com poucos dados, infira do endereço da Receita Federal.
- Se houver dados de "grupo_economico" nas fontes externas, analise se existem outras empresas no mesmo endereço com atividades similares ou sócios em comum.

ANÁLISE DE GRUPOS ECONÔMICOS (empresa.grupos_economicos):
- Se identificar outras empresas no mesmo endereço ou com sócios cruzados, marque "identificado: true".
- Em "detalhes", explique a relação detectada (ex: "Empresa XPTO e Empresa YYZ operam no mesmo prédio e compartilham o sócio principal").

EXTRAÇÃO DE CONTATOS (contatos_abordagem):
- Priorize links de WhatsApp (wa.me) e e-mails corporativos.
- EXTRAIA o número de telefone de links wa.me se possível (ex: wa.me/5531999991234 -> (31) 99999-1234).
- Se encontrar um e-mail no site oficial (ex: contato@empresa.com.br), marque-o como canal ideal.

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
    "tecnologia_atual": "string (ERP/software identificado ou 'Não identificado')",
    "grupos_economicos": { "identificado": false, "detalhes": "string" },
    "status_integridade": {
      "nivel": "Suficiente" | "Parcial" | "Insuficiente",
      "motivo": "string (ex: 'Dados oficiais da Receita Federal não localizados. Dossiê baseado em fontes web e redes sociais.')",
      "is_provisorio": boolean
    }
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
    "instagram": { "encontrado": true, "resumo": "string", "url": "string" },
    "facebook": { "encontrado": true, "resumo": "string", "url": "string" },
    "youtube": { "encontrado": true, "resumo": "string", "url": "string" },
    "twitter": { "encontrado": true, "resumo": "string", "url": "string" },
    "noticias": { "encontrado": true, "resumo": "string", "urls": ["string"] }
  },
  "risco_financeiro": {
    "protestos": { "encontrado": false, "resumo": "string", "quantidade_estimada": 0 },
    "negativacoes": { "encontrado": false, "resumo": "string" },
    "regularidade_fiscal": "string",
    "nivel_risco": "Baixo"
  },
  "contatos_abordagem": [
    { "nome": "string", "cargo": "string", "canal": "string", "contato": "string", "fonte": "string (ex: 'LinkedIn', 'Site Oficial', 'Casa dos Dados')" }
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
    "o_que_evitar": "string",
    "contexto_regional": "string — análise do contexto regional/geográfico do lead: particularidades do mercado local, presença da Group/PartnerBank na região, concorrentes regionais, cultura de negócios local, oportunidades específicas da UF/cidade. Inclua dados como: quantos condomínios/imobiliárias existem na região, se é capital ou interior, sazonalidade, eventos do setor na região, associações locais (ABADI, SECOVI regional, etc.), e como usar isso a favor da abordagem comercial."
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
  
  const capitalStr = empresa.capital_social?.replace(/[^\d,.]/g, "") || "0";
  const capital = parseFloat(capitalStr.replace(/\./g, "").replace(",", ".")) || 0;
  if (capital >= 100000) maturidade += 5;
  else if (capital >= 10000) maturidade += 3;

  // Regional Bonus (IBGE)
  const ibge = (dossier.insights_estrategicos as any)?.ibge_data;
  if (ibge) {
    const pib = parseFloat(ibge.pib || "0");
    const pop = parseInt(ibge.populacao || "0");
    if (pib > 10000000 || pop > 200000) { // PIB > 10bi ou Pop > 200k
      maturidade += 2;
    }
  }

  maturidade = Math.min(15, maturidade);
  breakdown.push({ categoria: "Maturidade", pontos: maturidade, max: 15, detalhe: `${anos} anos, Capital: ${empresa.capital_social || "N/I"}${ibge ? " + Bônus Regional" : ""}` });

  // 3. Complexidade societária (0-10)
  let societaria = 0;
  if (socios.length >= 3) societaria += 10;
  else if (socios.length >= 2) societaria += 7;
  else if (socios.length >= 1) societaria += 4;
  breakdown.push({ categoria: "Estrutura Societária", pontos: societaria, max: 10, detalhe: `${socios.length} sócio(s) mapeado(s)` });

  // 4. Presença digital (0-15) — now includes domain data
  let digital = 0;
  if (socio.linkedin && socio.linkedin !== "Não identificado") digital += 3;
  if (empresa.redes_sociais && empresa.redes_sociais !== "Não identificado") digital += 3;
  if (fontes.linkedin?.encontrado) digital += 3;
  const dominios = (dossier.dominios_associados || []) as Array<Record<string, string>>;
  if (dominios.length > 0) digital += 3; // has registered domains
  if (dominios.length >= 2) digital += 3; // multiple domains
  digital = Math.min(15, digital);
  const domainNames = dominios.map(d => d.dominio).filter(Boolean).join(", ");
  breakdown.push({ categoria: "Presença Digital", pontos: digital, max: 15, detalhe: dominios.length > 0 ? `${dominios.length} domínio(s): ${domainNames.slice(0, 60)}` : (digital >= 10 ? "Boa presença online" : "Presença limitada") });

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

  // 10. NEW: Validação Cruzada (0-10)
  let validacao = 0;
  const contatos = (dossier.contatos_abordagem || []) as Array<Record<string, any>>;
  const hasApollo = contatos.some(c => c.is_apollo_verified);
  const hasValidatedDomain = dominios.some(d => d.is_validated);
  if (hasApollo) validacao += 5;
  if (hasValidatedDomain) validacao += 5;
  breakdown.push({ categoria: "Validação Cruzada", pontos: validacao, max: 10, detalhe: `${hasApollo ? "Contatos Apollo verificado(s)" : ""} ${hasValidatedDomain ? "Domínio validado via WHOIS" : ""}`.trim() || "Nenhuma validação extra" });

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

function parseAiGatewayError(payload: unknown, fallbackStatus?: number): { status: number; message: string } | null {
  const data = typeof payload === "string" ? (() => {
    try { return JSON.parse(payload); } catch { return null; }
  })() : payload as Record<string, any> | null;

  const rawError = data?.error;
  if (!rawError) return null;

  const rawCode = rawError.code ?? rawError.status ?? fallbackStatus;
  const codeText = String(rawCode ?? "").toLowerCase();
  const status = Number(rawCode) || fallbackStatus || 500;
  const rawMessage = String(rawError.message ?? "Erro ao consultar a IA");

  if (status === 429 || codeText.includes("429") || codeText.includes("rate")) {
    return { status: 429, message: "Limite de requisições da IA excedido. Aguarde alguns instantes e tente novamente." };
  }
  if (status === 402 || codeText.includes("402") || codeText.includes("credit") || codeText.includes("quota")) {
    return { status: 402, message: "Créditos de IA insuficientes. Adicione créditos em Settings > Workspace > Usage." };
  }
  return { status, message: `Erro da IA: ${rawMessage}` };
}

function aiFailureResponse(message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message, upstream_status: status }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let userId: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const sbClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await sbClient.auth.getUser();
      if (user) userId = user.id;
    }
  } catch (err) {
    console.warn("Failed to extract userId from auth header", err);
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
    const { input, input_type, skip_cache, process_mode } = parsedBody;
    const isFastMode = process_mode === "fast";

    if (!input || !input_type) {
      return new Response(
        JSON.stringify({ error: "Input e tipo são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Autenticação obrigatória" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==================== BACKGROUND JOB MODE ====================
    // Create job row, respond immediately, process in background via EdgeRuntime.waitUntil
    const sbAdmin = getSupabaseAdmin();
    const { data: jobRow, error: jobErr } = await sbAdmin
      .from("dossier_jobs")
      .insert({
        user_id: userId,
        input: input as string,
        input_type: input_type as string,
        skip_cache: !!skip_cache,
        status: "processing",
      })
      .select("id")
      .single();

    if (jobErr || !jobRow) {
      console.error("[Job] Failed to create job:", jobErr);
      return new Response(
        JSON.stringify({ error: "Falha ao criar job de processamento" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const jobId = jobRow.id as string;

    const runPipeline = async (): Promise<Response> => {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENROUTER_API_KEY não configurada" }),
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
    let seeklocDataDirect: Record<string, any> | null = null;
    let emailInput = input_type === "email" ? (input as string) : null;

    // === NEW EMAIL FLOW ===
    if (emailInput) {
      console.log(`[Email Flow] Starting search for email: ${emailInput}`);
      const domainFromEmail = emailInput.split("@")[1];
      
      // 1. Try Apollo to find company from email
      const apolloInitial = await fetchApolloEnrichment({ email: emailInput });
      if (apolloInitial?.organization) {
        const org: any = apolloInitial.organization;
        const orgDomain = org.primary_domain;
        
        // SÓ ACEITA O NOME DA EMPRESA DO APOLLO SE NÃO FOR UM DOMÍNIO GENÉRICO
        // (Evita que iarahaizero@gmail.com vire "Google")
        if (!isGenericDomain(orgDomain) && !isGenericDomain(org.name)) {
          empresaNome = org.name;
          console.log(`[Email Flow] Apollo found valid company: "${empresaNome}" | Domain: ${orgDomain}`);
          
          // 2. Try to find CNPJ for this company
          const cnpjSearch = await firecrawlSearch(
            `CNPJ "${empresaNome}" site:cnpj.biz OR site:casadosdados.com.br`,
            "email_to_cnpj", { limit: 2 }
          );
          const cnpjMatch = cnpjSearch.results.map(r => r.title + r.description).join(" ").match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
          if (cnpjMatch) {
            cnpj = cnpjMatch[0];
            console.log(`[Email Flow] Deduced CNPJ: ${cnpj}`);
          }
        }
      }

      // NOVO: PIVOT SEARCH PARA E-MAILS GENÉRICOS
      // Se for @gmail/etc e ainda não temos CNPJ, tentamos achar a empresa baseada no nome do e-mail
      if (!cnpj && isGenericDomain(domainFromEmail)) {
        const localPart = emailInput.split("@")[0].replace(/[._-]/g, " ").trim();
        console.log(`[Email Flow] Generic email pivot search for: "${localPart}"`);
        
        const pivotSearch = await firecrawlSearch(
          `"${localPart}" CNPJ site:cnpj.biz OR site:casadosdados.com.br`, 
          "email_pivot_cnpj", { limit: 2 }
        );
        const cnpjMatch = pivotSearch.results.map(r => r.title + r.description).join(" ").match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
        if (cnpjMatch) {
          cnpj = cnpjMatch[0];
          console.log(`[Email Flow] Pivot found CNPJ: ${cnpj}`);
          // Se não achou CNPJ, seta como nome pra busca de pessoa posterior e tenta Seekloc
          empresaNome = localPart;
          
          // TENTATIVA SEEKLOC POR E-MAIL/NOME (Já que não achou CNPJ)
          // Helper: considera "encontrado" se tem doc/nome no root OU em .pessoa
          const seeklocHasData = (d: any) => !!(d && (d.doc || d.nome || d.pessoa?.id || d.pessoa?.doc));

          console.log(`[Email Flow] Trying Seekloc by email: ${emailInput}`);
          const seeklocByEmail = await fetchSeeklocData({ email: emailInput });
          if (seeklocHasData(seeklocByEmail)) {
            seeklocDataDirect = seeklocByEmail;
            console.log(`[Email Flow] Seekloc found data directly by email!`);
          } else {
            console.log(`[Email Flow] Seekloc by email failed, trying by name: ${localPart}`);
            const seeklocByName = await fetchSeeklocData({ nome: localPart });
            if (seeklocHasData(seeklocByName)) {
              seeklocDataDirect = seeklocByName;
              console.log(`[Email Flow] Seekloc found data by name!`);
            }
          }
        }
      }
    }
    
    let seeklocDataRef = seeklocDataDirect;

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
      const emailDomain = (input as string).split("@")[1];
      if (emailDomain && !isGenericDomain(emailDomain)) {
        empresaNome = emailDomain.split(".")[0];
      }
    }
    
    if (!empresaNome || (input_type === "email" && empresaNome.includes("@"))) {
      if (input_type === "email") {
        // Fallback final para e-mail: usar a parte do nome (antes do @) para tentar achar a pessoa 
        // e NÃO o domínio genérico ou o e-mail completo
        empresaNome = (input as string).split("@")[0].replace(/[._-]/g, " ").trim();
        console.log(`[Flow] Final fallback for generic/unknown email. Focus on: ${empresaNome}`);
      } else {
        empresaNome = input as string;
      }
    }

    // === PARALLEL ENRICHMENT PHASE 1 ===
    console.log(`[Enrichment] Starting parallel data fetching...`);
    
    // Preparar dados para Apollo
    let personFirstName = "";
    let personLastName = "";
    const personEmail = input_type === "email" ? (input as string) : undefined;
    if (input_type === "nome") {
      const parts = (input as string).trim().split(/\s+/);
      personFirstName = parts[0];
      personLastName = parts.slice(1).join(" ");
    } else if (cnpjDataRef?.qsa && Array.isArray(cnpjDataRef.qsa) && cnpjDataRef.qsa.length > 0) {
      const socioName = (cnpjDataRef.qsa[0].nome as string) || "";
      const parts = socioName.trim().split(/\s+/);
      personFirstName = parts[0];
      personLastName = parts.slice(1).join(" ");
    }

    const nomeFantasia = cnpjDataRef?.nome_fantasia as string;
    const enderecoCompleto = cnpjDataRef ? `${cnpjDataRef.logradouro}, ${cnpjDataRef.numero} - ${cnpjDataRef.municipio}/${cnpjDataRef.uf}` : undefined;

    // Detectar se o e-mail é de domínio interno / já cliente Group Software
    const emailDomainRaw = emailInput ? emailInput.split("@")[1]?.toLowerCase() : "";
    const isGroupInternalDomain = emailDomainRaw
      ? /groupsoftware|group\.com\.br|partnerbank/.test(emailDomainRaw)
      : false;
    if (isGroupInternalDomain) {
      console.warn(`[Email Flow] WARNING: E-mail domain "${emailDomainRaw}" belongs to Group Software itself. This is an internal lead.`);
    }

    // Derivar nome da pessoa a partir do Apollo ou da parte local do e-mail
    let personNomeDerivado = "";
    if (personEmail) {
      // Tenta extrair nome da parte local do email: joao.silva@empresa.com -> "joao silva"
      const localPart = personEmail.split("@")[0] || "";
      personNomeDerivado = localPart.replace(/[._-]/g, " ").replace(/\d/g, "").trim();
      console.log(`[Email Flow] Person name derived from email: "${personNomeDerivado}"`);
    }

    // Disparar consultas independentes
    const [domainData, externalResults, externalPersonResults, seeklocData, ibgeData, googlePlacesData] = await Promise.all([
      fetchDomainInfo(empresaNome, cnpj, cnpjDataRef, !!skip_cache),
      fetchExternalSources(empresaNome, nomeFantasia, null, cnpj, enderecoCompleto, !!skip_cache, isFastMode),
      // Buscas focadas na PESSOA para input tipo email (reduzir no FastMode)
      personNomeDerivado && personNomeDerivado.length > 4 ? Promise.all([
        firecrawlSearch(`"${personNomeDerivado}" site:linkedin.com/in`, "person_linkedin", { limit: isFastMode ? 2 : 3 }),
        !isFastMode ? firecrawlSearch(`"${personNomeDerivado}" site:instagram.com`, "person_instagram", { limit: 2 }) : Promise.resolve(null),
      ]) : Promise.resolve(null),
      seeklocDataRef ? Promise.resolve(seeklocDataRef) : (cnpj ? fetchSeeklocData({ documento: cnpj }) : (personEmail ? fetchSeeklocData({ email: personEmail }) : Promise.resolve(null))),
      cnpjDataRef?.codigo_municipio_ibge ? fetchIbgeData(cnpjDataRef.codigo_municipio_ibge as string) : Promise.resolve(null),
      !isFastMode && empresaNome ? fetchGooglePlacesData(empresaNome, enderecoCompleto) : Promise.resolve(null)
    ]);

    const mainDomain = domainData.dominios[0]?.dominio;
    const mainDomainObj = domainData.dominios[0];
    const isDomainValidated = mainDomainObj?.is_validated;
    const domainScore = mainDomainObj?.score || 0;

    // === PARALLEL ENRICHMENT PHASE 2 (Dependent on Domain) ===
    let apolloData: Record<string, unknown> | null = null;
    let websiteContent = "";
    let extractedSocialLinks: string[] = [];

    const phase2Promises = [];

    // Apollo needs domain or email
    if (personEmail || (mainDomain && (isDomainValidated || domainScore >= 110))) {
      phase2Promises.push(fetchApolloEnrichment({
        firstName: personFirstName || undefined,
        lastName: personLastName || undefined,
        email: personEmail,
        domain: mainDomain,
      }).then(data => { apolloData = data; }));
    }

    // Website scrape needs domain
    if (mainDomain && !isFastMode) {
      const websiteUrl = `https://www.${mainDomain}`;
      const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (apiKey) {
        phase2Promises.push(
          fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: websiteUrl, formats: ["markdown"], onlyMainContent: true, timeout: 10000 }),
          }).then(async (resp) => {
            if (resp.ok) {
              const scrapeData = await resp.json();
              const md = scrapeData?.data?.markdown || scrapeData?.markdown || "";
              if (md.length > 50) {
                websiteContent = md.slice(0, 3000);
                extractedSocialLinks = extractSocialLinksFromMarkdown(md);
              }
            }
          }).catch(err => console.warn(`[Website] Scrape error:`, err))
        );
      }
    }

    if (phase2Promises.length > 0) {
      console.log(`[Enrichment] Starting Phase 2 (Apollo/Scrape)...`);
      await Promise.all(phase2Promises);
    }

    // === PHASE 2.5: PORTFOLIO INTEL — Fase D + D.5 (validação de domínio + map + stack + IA) ===
    let portfolioContext = "";
    let portfolioIntel: PortfolioIntel | null = null;
    let stackDetection: StackDetection | null = null;
    const portfolioTelemetry: Record<string, unknown> = {
      domain_used: mainDomain || null,
      validated: false,
      skipped_reason: null,
      validation_signals: null,
      mapped_urls: 0,
      scraped_pages: 0,
      cache_hits: 0,
      scrapes: 0,
      has_ai_extraction: false,
    };

    if (!mainDomain) {
      portfolioTelemetry.skipped_reason = "sem_dominio_identificado";
    } else if (isFastMode) {
      portfolioTelemetry.skipped_reason = "fast_mode";
    } else {
      try {
        const brandForPortfolio = cleanCompanyNameForSearch(nomeFantasia || empresaNome).trim() || empresaNome;
        const baseUrl = `https://${mainDomain}`;
        const cacheTele = { cacheHits: 0, scrapes: 0 };

        // === D.5: VALIDAÇÃO DE DOMÍNIO (impede gastar IA num site que não é da empresa) ===
        const homeScrape = await cachedSiteScrape(baseUrl, "portfolio_page", cacheTele);
        const homeText = `${homeScrape.markdown} ${homeScrape.html}`.toLowerCase();
        const cleanCnpjDigits = (cnpj || "").replace(/\D/g, "");
        const cnpjFormatted = cleanCnpjDigits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
        const cidadeRaw = ((cnpjDataRef?.municipio as string) || "").toLowerCase().trim();
        const segmentoKeywords = ["condom", "síndic", "sindic", "administra", "imobili", "incorpora", "construt", "engenhar", "contabil", "consult", "segur", "tecnolog"];
        const blacklistHostPatterns = /(^|\.)(news|gazeta|folha|estadao|globo|uol|terra|r7|ig|abril|veja|exame|metropoles|cnn|band|sbt|record|noticias?|jornal|portal|tribunal|tjsp|tjmg|tjpr|stf|stj|trf|wikipedia|jusbrasil)([.\-]|$)|(\.gov\.br|\.gov$|\.edu\.br|\.edu$|\.mil\.br|registro\.br|whois)/i;

        const sigWords = empresaNome.toLowerCase()
          .replace(/[^a-z\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length >= 4 && !["ltda", "limitada", "administradora", "gestao", "servicos", "empresa", "comercio", "industria"].includes(w));

        const signals = {
          cnpj_match: !!cleanCnpjDigits && (homeText.includes(cleanCnpjDigits) || homeText.includes(cnpjFormatted.toLowerCase())),
          cidade_match: cidadeRaw.length >= 4 ? homeText.includes(cidadeRaw) : false,
          segmento_hits: segmentoKeywords.filter((k) => homeText.includes(k)).length,
          brand_match: sigWords.some((w) => homeText.includes(w)),
          home_length: homeScrape.markdown.length,
          blacklisted_host: blacklistHostPatterns.test(mainDomain),
        };
        portfolioTelemetry.validation_signals = signals;
        portfolioTelemetry.cache_hits = cacheTele.cacheHits;
        portfolioTelemetry.scrapes = cacheTele.scrapes;

        const isValid =
          !signals.blacklisted_host &&
          homeScrape.markdown.length > 200 &&
          (
            signals.cnpj_match ||
            (signals.cidade_match && signals.segmento_hits >= 1 && signals.brand_match) ||
            (signals.segmento_hits >= 2 && signals.brand_match)
          );

        if (!isValid) {
          portfolioTelemetry.skipped_reason = signals.blacklisted_host
            ? "dominio_blacklisted_news_gov"
            : homeScrape.markdown.length <= 200
            ? "home_vazia_ou_inacessivel"
            : "site_oficial_nao_confirmado";
          console.warn(`[Portfolio Intel] Skipping ${mainDomain}: ${portfolioTelemetry.skipped_reason} | signals=${JSON.stringify(signals)}`);
        } else {
          portfolioTelemetry.validated = true;

          // D1: descobrir URLs relevantes
          const mappedRaw = await firecrawlMap(baseUrl, "condomínio empreendimento cliente portfólio sobre", 60);
          portfolioTelemetry.mapped_urls = mappedRaw.length;

          const portfolioKeywords = /(portfolio|portif[óo]lio|condom[ií]nios|empreendiment|clientes|cases|sobre|institucional|quem-somos|servi[çc]os|administra[çc][ãa]o)/i;
          const skipKeywords = /(politica|privacidade|cookies|termos|login|admin|wp-admin|wp-content|feed|sitemap\.xml|\.pdf$|\.jpg$|\.png$)/i;

          const extraCandidates = Array.from(new Set(
            mappedRaw.filter((u) => portfolioKeywords.test(u) && !skipKeywords.test(u) && u !== baseUrl)
          )).slice(0, 6);

          const extraScrapes = await Promise.all(
            extraCandidates.map((u) => cachedSiteScrape(u, "portfolio_page", cacheTele).then((r) => ({ url: u, ...r })))
          );
          const scrapeResults = [{ url: baseUrl, ...homeScrape }, ...extraScrapes];
          portfolioTelemetry.cache_hits = cacheTele.cacheHits;
          portfolioTelemetry.scrapes = cacheTele.scrapes;
          portfolioTelemetry.scraped_pages = scrapeResults.filter((r) => r.markdown.length > 100 || r.html.length > 500).length;

          // D2: detectar stack
          const allHtml = scrapeResults.map((r) => r.html).join("\n").slice(0, 200000);
          const allMd = scrapeResults.map((r) => r.markdown).join("\n").slice(0, 200000);
          stackDetection = detectStackFromText(allHtml + "\n" + allMd);

          // D3: IA extrai portfólio estruturado
          const portfolioMd = scrapeResults
            .filter((r) => r.markdown.length > 100)
            .map((r) => `### URL: ${r.url}\n${r.markdown.slice(0, 4000)}`)
            .join("\n\n---\n\n");

          if (portfolioMd.length > 300) {
            portfolioIntel = await extractPortfolioWithAI(
              portfolioMd,
              brandForPortfolio,
              (cnpjDataRef?.municipio as string) || null,
              (cnpjDataRef?.uf as string) || null
            );
            portfolioTelemetry.has_ai_extraction = !!portfolioIntel;
          }

          // D4: contexto pra IA principal
          const blocks: string[] = [];
          if (portfolioIntel) {
            blocks.push(`--- PORTFÓLIO INFERIDO (IA, confiança: ${portfolioIntel.confianca}) ---
- Total condomínios estimado: ${portfolioIntel.total_condominios_estimado ?? "não declarado"}
- Tipologia predominante: ${portfolioIntel.tipologia_predominante ?? "não identificado"}
- Bairros atendidos: ${portfolioIntel.bairros_atendidos.join(", ") || "não declarado"}
- Cidades atendidas: ${portfolioIntel.cidades_atendidas.join(", ") || "não declarado"}
- Ticket médio estimado por cota: ${portfolioIntel.ticket_medio_estimado_cota ?? "não estimável"}
- Diferenciais declarados: ${portfolioIntel.diferenciais_declarados.join(" | ") || "—"}
- Evidências literais do site:
${portfolioIntel.evidencias.map((e) => `  • "${e}"`).join("\n") || "  (nenhuma)"}`);
          }
          if (stackDetection && (stackDetection.sistema_gestao || stackDetection.crm_marketing.length || stackDetection.analytics.length || stackDetection.app_morador.length)) {
            blocks.push(`--- STACK DETECTADA NO SITE (regex sobre HTML/JS) ---
- Sistema de gestão (concorrente): ${stackDetection.sistema_gestao ? `${stackDetection.sistema_gestao.nome} [evidências: ${stackDetection.sistema_gestao.evidencias.join(" | ")}]` : "não detectado"}
${stackDetection.outros_sistemas_gestao.length ? `- Outros sistemas mencionados: ${stackDetection.outros_sistemas_gestao.join(", ")}` : ""}
- App do morador: ${stackDetection.app_morador.join(", ") || "não detectado"}
- CRM/Marketing: ${stackDetection.crm_marketing.join(", ") || "não detectado"}
- Analytics/Tracking: ${stackDetection.analytics.join(", ") || "não detectado"}`);
          }

          if (blocks.length > 0) {
            portfolioContext =
              `\n=== INTELIGÊNCIA DE PORTFÓLIO E STACK (Fase D — extraído do site oficial ${mainDomain}) ===\n` +
              blocks.join("\n\n") +
              `\n=== FIM PORTFOLIO INTEL ===\n\n` +
              `INSTRUÇÃO CRÍTICA (Fase D — munição comercial):\n` +
              `1. Em "empresa.tecnologia_atual": se "Sistema de gestão (concorrente)" foi detectado, ESCREVA o nome literal (ex.: "Usa Superlógica — evidência no site"). NÃO escreva "Não identificado" quando houver evidência.\n` +
              `2. Em "abordagem_estrategica" e "gancho_venda": CITE LITERALMENTE pelo menos 1 bairro/cidade do portfólio, 1 diferencial declarado, e o sistema concorrente detectado (se houver).\n` +
              `3. Se "ticket_medio_estimado_cota" estiver preenchido, use-o em "insights_estrategicos.contexto_regional".\n` +
              `4. Se houver concorrente detectado, oriente "abordagem_estrategica" como SWITCH (não greenfield).\n` +
              `5. Se NÃO houver concorrente detectado mas SIM sinais de gestão (vagas, posts), trate como greenfield.\n` +
              `6. NÃO INVENTE bairros, números ou sistemas. Use APENAS o que está nesses blocos.`;
            console.log(`[Portfolio Intel] Built context (${portfolioContext.length} chars). Stack: ${stackDetection?.sistema_gestao?.nome || "—"}. AI extraction: ${portfolioTelemetry.has_ai_extraction}`);
          }
        }
      } catch (err) {
        console.warn("[Portfolio Intel] Phase 2.5 error (non-fatal):", err);
        portfolioTelemetry.skipped_reason = "erro_runtime";
      }
    }



    // === PHASE 3: LINKEDIN DEEP SCRAPE (Fase A + C: cache, dedup, confiança) ===
    let linkedinDeepContext = "";
    // Telemetria compartilhada entre Phase 3 e 3.5
    const linkedinTelemetry = {
      companies_scraped: 0,
      persons_scraped: 0,
      cache_hits: 0,
      scrapes: 0,
      avg_confidence: 0,
      discarded: [] as Array<{ url: string; score: number; reason: string; kind: string }>,
    };
    // Dedup global de URLs já raspadas no request (compartilhado com Phase 3.5)
    const scrapedUrlsInRequest = new Set<string>();
    const telemetryCounter = { cacheHits: 0, scrapes: 0 };

    if (!isFastMode) {
      try {
        // Dados de contexto para o score
        const brandForScore = cleanCompanyNameForSearch(nomeFantasia || empresaNome).trim() || empresaNome;
        const municipio = (cnpjDataRef?.municipio as string)?.toLowerCase() || null;
        const uf = (cnpjDataRef?.uf as string)?.toLowerCase() || null;
        const cnae = (cnpjDataRef?.cnae_fiscal_descricao as string) || null;
        const domainHint = (domainData?.dominios?.[0]?.dominio as string) || null;

        // 1) Empresa: extrair slugs únicos dedupados
        const companyUrls = new Set<string>();
        const lkResult = externalResults.find((r) => r.source === "linkedin");
        if (lkResult) {
          for (const item of lkResult.results) {
            const m = (item.url || "").match(/linkedin\.com\/company\/([^\/?#]+)/i);
            if (m) {
              const slug = m[1].toLowerCase();
              const url = `https://www.linkedin.com/company/${slug}`;
              const norm = normalizeLinkedinUrl(url);
              if (!scrapedUrlsInRequest.has(norm)) {
                companyUrls.add(url);
                scrapedUrlsInRequest.add(norm);
                if (companyUrls.size >= 2) break;
              }
            }
          }
        }

        // 2) Apollo passthrough (LinkedIn da pessoa)
        const apolloLinkedin = (apolloData as any)?.linkedin_url;
        const personScrapeTargets: { url: string; socio: string; cargo: string }[] = [];
        if (apolloLinkedin && typeof apolloLinkedin === "string" && /linkedin\.com\/in\//i.test(apolloLinkedin)) {
          const norm = normalizeLinkedinUrl(apolloLinkedin);
          if (!scrapedUrlsInRequest.has(norm)) {
            personScrapeTargets.push({
              url: apolloLinkedin.split("?")[0],
              socio: `${(apolloData as any)?.first_name || ""} ${(apolloData as any)?.last_name || ""}`.trim() || "Apollo Contact",
              cargo: ((apolloData as any)?.title || (apolloData as any)?.job_title || "") as string,
            });
            scrapedUrlsInRequest.add(norm);
          }
        }

        // 3) Sócios do QSA — search + pick top /in/ URL
        const socios = (cnpjDataRef?.qsa as Array<Record<string, string>>) || [];
        const socioBrand = cleanCompanyNameForSearch(nomeFantasia || empresaNome).split(" ").slice(0, 3).join(" ").trim() || empresaNome;
        const sociosToSearch = socios
          .filter((s) => s.nome && s.nome.length > 5 && !/^(administrador|holding|fundo|investiment)/i.test(s.nome))
          .slice(0, 3);

        if (sociosToSearch.length > 0) {
          const socioSearches = await Promise.all(
            sociosToSearch.map((s) =>
              firecrawlSearch(
                `"${s.nome}" "${socioBrand}" site:linkedin.com/in`,
                `socio_search_${s.nome.slice(0, 24)}`,
                { limit: 2 }
              )
                .then((r) => {
                  const top = r.results.find((x) => /linkedin\.com\/in\//i.test(x.url || ""));
                  return top ? { url: top.url.split("?")[0], socio: s.nome, cargo: s.qual || "Sócio" } : null;
                })
                .catch(() => null)
            )
          );
          for (const r of socioSearches) {
            if (!r) continue;
            const norm = normalizeLinkedinUrl(r.url);
            if (scrapedUrlsInRequest.has(norm)) continue;
            personScrapeTargets.push(r);
            scrapedUrlsInRequest.add(norm);
          }
        }

        // 4) Scrape em paralelo (com cache 7d)
        const companyJobs = Array.from(companyUrls).map((u) =>
          cachedLinkedinScrape(u, "linkedin_company", 24 * 7, telemetryCounter)
            .then((md) => ({ kind: "company" as const, url: u, md }))
        );
        const personJobs = personScrapeTargets.map((t) =>
          cachedLinkedinScrape(t.url, `linkedin_in_${t.socio.slice(0, 20)}`, 24 * 7, telemetryCounter)
            .then((md) => ({ kind: "person" as const, ...t, md }))
        );

        if (companyJobs.length + personJobs.length > 0) {
          console.log(`[LinkedIn Deep] Scraping ${companyJobs.length} company + ${personJobs.length} person pages`);
          const scraped = await Promise.all([...companyJobs, ...personJobs]);
          const parts: string[] = [];
          const scores: number[] = [];
          const CONFIDENCE_THRESHOLD = 50;

          for (const r of scraped) {
            if (!r.md || r.md.length < 120) {
              linkedinTelemetry.discarded.push({ url: r.url, score: 0, reason: "scrape vazio/curto", kind: r.kind });
              continue;
            }
            const snippet = r.md.slice(0, 2200);
            if (r.kind === "company") {
              const slug = (r.url.match(/\/company\/([^\/?#]+)/i)?.[1] || "").toLowerCase();
              const score = scoreCompanyPage({
                slug, markdown: r.md, brand: brandForScore,
                domain: domainHint, municipio, uf, cnae,
              });
              if (score < CONFIDENCE_THRESHOLD) {
                linkedinTelemetry.discarded.push({ url: r.url, score, reason: `confiança ${score}<${CONFIDENCE_THRESHOLD} — provável homônimo`, kind: "company" });
                console.log(`[LinkedIn Deep] DESCARTADO company score=${score}: ${r.url}`);
                continue;
              }
              scores.push(score);
              linkedinTelemetry.companies_scraped++;
              parts.push(`--- LINKEDIN COMPANY PAGE (${r.url}) [confiança: ${score}/100] ---\n${snippet}`);
            } else {
              const score = scorePersonPage({ markdown: r.md, socioNome: r.socio, brand: brandForScore });
              if (score < CONFIDENCE_THRESHOLD) {
                linkedinTelemetry.discarded.push({ url: r.url, score, reason: `confiança ${score}<${CONFIDENCE_THRESHOLD} — sócio/empresa não casaram`, kind: "person" });
                console.log(`[LinkedIn Deep] DESCARTADO person ${r.socio} score=${score}: ${r.url}`);
                continue;
              }
              scores.push(score);
              linkedinTelemetry.persons_scraped++;
              parts.push(`--- LINKEDIN /in/ — ${r.socio} (${r.cargo}) — ${r.url} [confiança: ${score}/100] ---\n${snippet}`);
            }
          }

          if (scores.length > 0) {
            linkedinTelemetry.avg_confidence = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
          }

          if (parts.length > 0) {
            linkedinDeepContext =
              `\n=== LINKEDIN DEEP SCRAPE (páginas reais, validadas por score de confiança) ===\n${parts.join("\n\n")}\n=== FIM LINKEDIN DEEP ===\n\n` +
              `INSTRUÇÃO: Os blocos acima vêm de scraping direto do LinkedIn e PASSARAM em validação de confiança (slug/domínio/cidade/nome do sócio batem com o CNPJ alvo). São a FONTE PRIMÁRIA para:\n` +
              `- socio_principal: cargo atual, historico_profissional, formacao_academica, linkedin (URL real)\n` +
              `- mapeamento_socios: enriquecer cada sócio do QSA com cargo/empresa atual encontrados\n` +
              `- Dados da empresa: headcount, indústria, especialidades, descrição oficial, sede, ano de fundação, website\n` +
              `Prefira estes dados aos snippets de busca em "DADOS DE FONTES EXTERNAS > LINKEDIN" sempre que houver conflito.`;
            console.log(`[LinkedIn Deep] Built context with ${parts.length} sections, avg_confidence=${linkedinTelemetry.avg_confidence}, discarded=${linkedinTelemetry.discarded.length}`);
          } else if (linkedinTelemetry.discarded.length > 0) {
            console.warn(`[LinkedIn Deep] TODOS os ${linkedinTelemetry.discarded.length} candidatos foram descartados por baixa confiança.`);
          }
        }
      } catch (err) {
        console.warn("[LinkedIn Deep] Phase 3 error (non-fatal):", err);
      }
    }

    // === PHASE 3.5: LINKEDIN EVENT SIGNALS (Fase B) ===
    // Sinais temporais: vagas abertas, posts recentes (últimos 30d), notícias recentes.
    // Tudo isso alimenta "gatilhos de abordagem" — o SDR sabe POR QUE ligar AGORA.
    let linkedinEventsContext = "";
    if (!isFastMode && (nomeFantasia || empresaNome)) {
      try {
        const brandForEvents = cleanCompanyNameForSearch(nomeFantasia || empresaNome)
          .split(" ").slice(0, 4).join(" ").trim();
        if (brandForEvents.length >= 3) {
          const [jobsRes, postsRes, newsRes] = await Promise.all([
            // Vagas abertas no LinkedIn (sinal forte de crescimento / dor de operação)
            firecrawlSearch(
              `"${brandForEvents}" site:linkedin.com/jobs`,
              "linkedin_jobs",
              { limit: 5 }
            ).catch(() => null),
            // Posts/pulse últimos 30 dias (movimentações, lançamentos, conquistas)
            firecrawlSearch(
              `"${brandForEvents}" (site:linkedin.com/posts OR site:linkedin.com/pulse OR site:linkedin.com/feed)`,
              "linkedin_posts_recentes",
              { limit: 5, tbs: "qdr:m" }
            ).catch(() => null),
            // Notícias gerais recentes (mês) — gatilhos externos (rodada, M&A, expansão, prêmio)
            firecrawlSearch(
              `"${brandForEvents}" (rodada OR investimento OR expansão OR contratou OR lançou OR aquisição OR prêmio OR inauguração)`,
              "noticias_recentes_30d",
              { limit: 5, tbs: "qdr:m" }
            ).catch(() => null),
          ]);

          const fmtBlock = (label: string, r: FirecrawlResult | null, max = 4) => {
            if (!r || !r.results?.length) return "";
            const lines = r.results.slice(0, max).map((x, i) => {
              const desc = (x.description || "").slice(0, 220);
              return `[${i + 1}] ${x.title || "(sem título)"}\n    ${x.url}\n    ${desc}`;
            });
            return `--- ${label} ---\n${lines.join("\n")}`;
          };

          const blocks = [
            fmtBlock("VAGAS ABERTAS NO LINKEDIN", jobsRes),
            fmtBlock("POSTS RECENTES NO LINKEDIN (últimos 30d)", postsRes),
            fmtBlock("NOTÍCIAS RECENTES (últimos 30d)", newsRes),
          ].filter(Boolean);

          if (blocks.length > 0) {
            linkedinEventsContext =
              `\n=== SINAIS DE EVENTO / GATILHOS DE ABORDAGEM (últimos 30 dias) ===\n` +
              blocks.join("\n\n") +
              `\n=== FIM SINAIS DE EVENTO ===\n\n` +
              `INSTRUÇÃO CRÍTICA: Os blocos acima são SINAIS TEMPORAIS e devem ser usados para:\n` +
              `- Preencher "sinais_crescimento" com fatos datados e específicos (ex.: "3 vagas abertas para Engenharia em ${new Date().toLocaleDateString("pt-BR", { month: "long" })}", "Post anunciando expansão para SP em 12/${new Date().getMonth() + 1}").\n` +
              `- Adicionar um campo/parágrafo "gatilhos_de_abordagem" dentro de "abordagem_estrategica" ou "gancho_venda": liste 2-4 motivos REAIS e DATADOS para o SDR ligar AGORA (ex.: "Empresa contratou 5 pessoas em outubro → escalando operação → momento ideal para apresentar módulo X"; "Lançaram nova unidade em SP → precisam centralizar gestão → módulo Y resolve").\n` +
              `- Cada gatilho deve ter: (a) o fato observado, (b) a inferência comercial, (c) o produto/módulo Group/PartnerBank que se conecta àquele momento.\n` +
              `- Se vagas mencionarem tecnologias específicas (React, AWS, etc.), considere isso em "tecnologia_atual".\n` +
              `- NÃO invente fatos. Se um bloco veio vazio, simplesmente não cite. Honestidade > criatividade.`;
            console.log(`[LinkedIn Events] Built context with ${blocks.length} signal blocks (${linkedinEventsContext.length} chars)`);
          }
        }
      } catch (err) {
        console.warn("[LinkedIn Events] Phase 3.5 error (non-fatal):", err);
      }
    }


    // Merge person-level results (LinkedIn/Instagram de pessoa) into context
    let personContext = "";
    if (externalPersonResults) {
      const [personLinkedin, personInstagram] = externalPersonResults;
      const personName = personNomeDerivado || "";
      const linkedinSnippet = personLinkedin?.results?.map((r: any) => `${r.title}: ${r.description}`).join("\n") || "";
      const instagramSnippet = personInstagram?.results?.map((r: any) => `${r.url}`).join(", ") || "";
      if (linkedinSnippet || instagramSnippet) {
        personContext = `\n=== PERFIL PESSOAL DO CONTATO ("${personName}") ===\n`;
        if (linkedinSnippet) personContext += `LinkedIn Pessoal:\n${linkedinSnippet}\n`;
        if (instagramSnippet) personContext += `Instagram Pessoal: ${instagramSnippet}\n`;
        personContext += `=== FIM PERFIL PESSOAL ===`;
        console.log(`[Person] Found personal profiles for "${personName}"`);
      }
    }

    // Aviso de domínio interno para a IA
    const internalDomainWarning = isGroupInternalDomain
      ? `\nAVISO: O e-mail "${personEmail}" pertence ao domínio "${emailDomainRaw}", que é um domínio da própria Group Software / PartnerBank. Este NÃO é um lead externo — siga as REGRAS CRÍTICAS de domínio interno do system prompt.\n`
      : "";

    // === CONTEXT FORMATTING ===
    const externalContext = formatExternalContext(externalResults);
    const externalSourcesFound = externalResults.filter((r) => r.results.length > 0).map((r) => r.source);

    let apolloContext = "";
    if (apolloData) {
      const orgName = (apolloData.organization as any)?.name || "";
      const orgDomain = (apolloData.organization as any)?.primary_domain || "";
      
      // BLOQUEIO CRÍTICO: Se o Apollo retornar Google/Microsoft como empresa para um e-mail pessoal, ignoramos.
      const isGenericOrg = isGenericDomain(orgName) || isGenericDomain(orgDomain);
      
      apolloContext = `\n=== DADOS ENRIQUECIDOS APOLLO (SOCIO/CONTATO) ===\n` +
        `Nome: ${apolloData.first_name} ${apolloData.last_name}\n` +
        `Cargo: ${apolloData.title || apolloData.job_title || "Não informado"}\n` +
        `LinkedIn: ${apolloData.linkedin_url || "Não informado"}\n` +
        `Twitter: ${apolloData.twitter_url || "Não informado"}\n` +
        `E-mail Corporativo: ${apolloData.email || "Não informado"}\n` +
        `Status E-mail: ${apolloData.email_status || "Não informado"}\n` +
        (apolloData.organization && !isGenericOrg ? `Empresa no Apollo: ${orgName}\n` : "");
    }

    // Limpeza extra para e-mails pessoais: Se o domínio for genérico, removemos qualquer domínio associado que aponte para o provedor
    const isPersonalEmail = input_type === "email" && isGenericDomain((input as string).split("@")[1]);
    if (isPersonalEmail && domainData.dominios.length > 0) {
      domainData.dominios = domainData.dominios.filter(d => !isGenericDomain(d.dominio) && !isGenericDomain(d.registrante || ""));
      console.log(`[Filter] Filtered out provider domains from personal email context. Remaining: ${domainData.dominios.length}`);
    }

    let ibgeContext = "";
    if (ibgeData) {
      ibgeContext = `\n=== DADOS SOCIOECONÔMICOS MUNICIPAIS (IBGE) ===\n` +
        `Município: ${cnpjDataRef?.municipio || "N/I"}/${cnpjDataRef?.uf || "N/I"}\n` +
        (ibgeData.populacao ? `População: ${Number(ibgeData.populacao).toLocaleString("pt-BR")} habitantes (${ibgeData.populacao_ano})\n` : "") +
        (ibgeData.pib ? `PIB Municipal: R$ ${Number(ibgeData.pib).toLocaleString("pt-BR")} mil (${ibgeData.pib_ano})\n` : "");
    }

    let googlePlacesContext = "";
    if (googlePlacesData && googlePlacesData.rating) {
      const reviewsArr = (googlePlacesData.reviews as any[]) || [];
      const reviewsBlock = reviewsArr.length > 0
        ? `\n\nAVALIAÇÕES RECENTES (até 8 mais relevantes):\n` +
          reviewsArr.map((r, i) =>
            `[${i + 1}] ${r.nota ?? "?"}/5 — ${r.autor} (${r.data || "s/data"})\n"${r.texto}"`
          ).join("\n\n")
        : "\n\n(Sem textos de avaliações disponíveis)";

      googlePlacesContext = `\n=== AVALIAÇÕES DO GOOGLE (Google Places API) ===\n` +
        `Empresa encontrada: ${googlePlacesData.nome}\n` +
        `Nota (Rating): ${googlePlacesData.rating} / 5.0\n` +
        `Total de Avaliações: ${googlePlacesData.user_ratings_total}\n` +
        `Endereço no Google: ${googlePlacesData.endereco}` +
        reviewsBlock +
        `\n\nINSTRUÇÕES OBRIGATÓRIAS DE ANÁLISE DAS AVALIAÇÕES:\n` +
        `1. Leia TODAS as avaliações acima (principalmente as negativas, 1-3 estrelas) e extraia DORES RECORRENTES dos clientes (ex.: "boleto sempre atrasa", "demora no registro", "atendimento ruim", "falta de comunicação", "taxas abusivas", "portaria ineficiente", "manutenção lenta", "síndico ausente", etc.).\n` +
        `2. Preencha o campo "reputacao" com a nota + número de avaliações + um resumo das 2-3 dores principais identificadas. Exemplo: "Google Maps: 3.2 (148 avaliações). Reclamações recorrentes: atraso recorrente na emissão de boletos, demora no registro de pagamentos, dificuldade de contato com a administração."\n` +
        `3. Use essas dores para personalizar os campos "analise_fit", "gancho_venda" e "abordagem_estrategica" — conectando explicitamente como os produtos Group Software / PartnerBank resolvem CADA dor encontrada (ex.: dor "boleto atrasa" → módulo de cobrança automatizada / PartnerBank; dor "falta de comunicação" → app do morador / portal de comunicação).\n` +
        `4. Em "contatos_abordagem" ou em um campo "pontos_de_dor", liste as dores reais extraídas das avaliações como BULLETS curtos para o vendedor "tocar" no contato.\n` +
        `5. Se as avaliações forem majoritariamente positivas (4.5+), destaque isso como sinal de empresa madura e ajuste o discurso para upgrade/eficiência ao invés de resolução de crise.\n` +
        `=== FIM GOOGLE PLACES ===`;
    }

    let seeklocContext = "";
    if (seeklocData) {
      seeklocContext = formatSeeklocContext(seeklocData);
    }

    // Format domain context for AI
    const domainContext = domainData.dominios.length > 0
      ? `\n\n=== DOMÍNIOS ASSOCIADOS (WHOIS/RDAP registro.br) ===\n${domainData.dominios.map(d =>
        `- ${d.dominio} | Status: ${d.status} | Criado: ${d.data_criacao || "N/I"} | Expira: ${d.data_expiracao || "N/I"} | Registrante: ${d.registrante || "N/I"}${d.email_registrante ? ` (Email: ${d.email_registrante})` : ""}${d.cnpj_registrante ? ` (CNPJ: ${d.cnpj_registrante})` : ""}${d.nameservers ? ` | NS: ${d.nameservers.join(", ")}` : ""}`
      ).join("\n")}\n=== FIM DOMÍNIOS ===${websiteContent ? `\n\n=== CONTEÚDO DO SITE DA EMPRESA (${domainData.dominios[0].dominio}) ===\n${websiteContent}\n=== FIM CONTEÚDO SITE ===` : ""}${extractedSocialLinks.length > 0 ? `\n\n=== LINKS DE REDES SOCIAIS ENCONTRADOS NO SITE ===\n${extractedSocialLinks.join("\n")}\n` : ""}`
      : "";

    // Call AI with all context
    const userMessage = `Gere o dossiê completo ENRIQUECIDO para o seguinte lead:
Tipo de input: ${input_type}
Dado fornecido: ${input}

⚠️ REGRAS DE OURO PARA ESTE LEAD:
1. SE O E-MAIL FOR @GMAIL, @HOTMAIL, @OUTLOOK, ETC: É estritamente PROIBIDO dizer que a empresa dele é a Google ou Microsoft. FOQUE NA PESSOA e trate a empresa como "Não identificado" se não houver um CNPJ comercial real.
2. NUNCA sugira produtos Group Software para a própria Google. O objetivo é analisar o profissional "iarahaizer" e suas possíveis atividades independentes.
3. Se o nome da empresa parecer um provedor de e-mail, IGNORE e foque no indivíduo.
${internalDomainWarning}${cascadeContext ? `\n=== DADOS DO EFEITO CASCATA (Nome → LinkedIn → Empresa → CNPJ) ===${cascadeContext}\n=== FIM CASCATA ===` : ""}
${cnpjContext ? `\n${cnpjContext}\n\nUse os dados reais acima como base principal para o dossiê.` : ""}
${apolloContext ? `\n${apolloContext}\n\nUse os dados do Apollo acima para preencher contatos_abordagem e validar o LinkedIn do sócio principal.` : ""}
${ibgeContext ? `\n${ibgeContext}\n\nUse os dados do IBGE para fornecer "contexto_regional" e estimar o ticket médio dos condomínios na região.` : ""}
${googlePlacesContext ? `\n${googlePlacesContext}` : ""}
${seeklocContext ? `\n${seeklocContext}\n\nUse os dados do Seekloc como fonte secundária e altamente confiável para telefones, e-mails e endereços. Se houver divergência com a Receita Federal, mencione a existência de dados mais recentes no Seekloc.` : ""}
${personContext ? `\n${personContext}\n\nINSTRUÇÃO DE CRUZAMENTO — PERFIL DO CONTATO x EMPRESA:\nO perfil pessoal acima é de um decisor ou sócio da empresa analisada. Use esses dados para ENRIQUECER o dossiê da EMPRESA, não para fazer um dossiê da pessoa:\n- Use o cargo e empresa listados no LinkedIn para CONFIRMAR o porte e segmento da empresa.\n- Use o histórico profissional para entender o nível de maturidade e exigência da gestão (ex: sócio com passagem por grandes grupos = empresa bem estruturada).\n- Use menções a portfólio (ex: "gerenciamos 300 condomínios" no perfil) para estimar o volume da empresa.\n- Use o Instagram para capturar posicionamento de marca, estilo de comunicação, eventos, parcerias e sinais de crescimento da empresa.\n- Preencha socio_principal.linkedin com a URL real encontrada e socio_principal.historico_profissional com o que encontrou no perfil.\n- Preencha contatos_abordagem com a pessoa encontrada, incluindo canal preferencial baseado no perfil pessoal (ex: LinkedIn se for ativo lá).` : ""}
${linkedinDeepContext}
${linkedinEventsContext}
${portfolioContext}
${externalContext ? `\n${externalContext}\n\nUse os dados das fontes externas para enriquecer o dossiê. As fontes "protestos_negativacoes", "vagas_crescimento" e "tech_stack" são NOVAS — use-as para preencher risco_financeiro, sinais_crescimento e tecnologia_atual. AS FONTES "localizacao_contatos" e "grupo_economico" trazem dados de localização e outras empresas no endereço — use-as para cruzar com o endereço da Receita e preencher grupos_economicos. A FONTE "direct_contacts" traz links diretos do site da empresa — use-a para encontrar WhatsApp e e-mails oficiais.` : ""}
${domainContext ? `\n${domainContext}\n\nUse os dados de domínio/WHOIS para avaliar a presença digital da empresa. Domínios ativos com registrante correspondente ao CNPJ indicam boa presença online. Se houver CONTEÚDO DO SITE, analise-o profundamente para extrair: serviços oferecidos, portfólio de condomínios/imóveis, equipe, diferenciais, tecnologias usadas, e qualquer informação que enriqueça o dossiê e a abordagem comercial.` : ""}

LEMBRETE OBRIGATÓRIO:
1. Na seção "logica_group_software", use ESTRITAMENTE os produtos dos catálogos Group Software e PartnerBank.
2. Preencha TODAS as novas seções: risco_financeiro, contatos_abordagem, sinais_crescimento, tecnologia_atual, is_pep para sócios.
3. Inclua "analise_fit", "modulos_sugeridos" (nomes exatos dos sites), e "gancho_venda" (copy do site).

Analise profundamente e retorne o JSON estruturado conforme o formato especificado.`;

    let dossier;
    let aiDataTracker: any = null;

    if (isFastMode) {
      console.log("[Fast Mode] Skipping AI inference, generating static dossier.");
      dossier = {
        empresa: {
          nome: empresaNome || "Não identificado",
          cnpj: cnpj || "Não identificado",
          situacao: cnpjDataRef?.descricao_situacao_cadastral || "Não identificado",
          abertura: cnpjDataRef?.data_inicio_atividade || "Não identificado",
          porte: cnpjDataRef?.porte || cnpjDataRef?.descricao_porte || "Não identificado",
          capital_social: cnpjDataRef?.capital_social ? `R$ ${Number(cnpjDataRef.capital_social).toLocaleString("pt-BR")}` : "Não identificado",
          endereco: cnpjDataRef ? `${cnpjDataRef.logradouro || ""} ${cnpjDataRef.numero || ""}, ${cnpjDataRef.municipio || ""}/${cnpjDataRef.uf || ""}` : "Não identificado",
          telefone: cnpjDataRef?.ddd_telefone_1 || "Não identificado",
          redes_sociais: "Verificado no dashboard",
          reputacao: googlePlacesData ? `Google Maps: ${googlePlacesData.rating} (${googlePlacesData.user_ratings_total} avaliações)` : "Busca ignorada (Fast Mode)",
          atividade_principal: cnpjDataRef?.cnae_fiscal_descricao || "Não identificado",
          tecnologia_atual: "Busca ignorada (Fast Mode)",
          grupos_economicos: { identificado: false, detalhes: "Busca ignorada" },
          status_integridade: { nivel: cnpjDataRef ? "Suficiente" : "Insuficiente", motivo: "Modo de processo em lote. IA desligada.", is_provisorio: true }
        },
        socio_principal: {
          nome: personFirstName ? `${personFirstName} ${personLastName}` : (cnpjDataRef?.qsa as any[])?.[0]?.nome || "Não identificado",
          cargo: (cnpjDataRef?.qsa as any[])?.[0]?.qual || "Sócio(a)",
          formacao_academica: "Busca ignorada",
          historico_profissional: "Busca ignorada",
          linkedin: "N/I",
          background_provavel: "N/I",
          is_pep: false,
          pep_detalhes: ""
        },
        mapeamento_socios: (cnpjDataRef?.qsa as any[])?.map(s => ({
          nome: s.nome || "N/I",
          cargo: s.qual || "N/I",
          background_provavel: "N/I",
          is_pep: false,
          pep_detalhes: ""
        })) || [],
        fontes_externas: {
          reclame_aqui: { encontrado: false, resumo: "N/A", url: "" },
          processos_judiciais: { encontrado: false, resumo: "N/A", url: "" },
          linkedin: { encontrado: false, resumo: "N/A", url: "" },
          instagram: { encontrado: false, resumo: "N/A", url: "" },
          facebook: { encontrado: false, resumo: "N/A", url: "" },
          youtube: { encontrado: false, resumo: "N/A", url: "" },
          twitter: { encontrado: false, resumo: "N/A", url: "" },
          noticias: { encontrado: false, resumo: "N/A", urls: [] }
        },
        risco_financeiro: { protestos: { encontrado: false, resumo: "N/A", quantidade_estimada: 0 }, negativacoes: { encontrado: false, resumo: "N/A" }, regularidade_fiscal: "N/A", nivel_risco: "Baixo" },
        contatos_abordagem: [],
        sinais_crescimento: [],
        insights_estrategicos: {
          janela_oportunidade: "Busca ignorada",
          abordagem_personalizada: { canal_ideal: "LinkedIn / E-mail", tom_de_voz: "Formatado", argumento_central: "N/A" },
          ressonancia_por_perfil: [],
          o_que_evitar: "N/A",
          contexto_regional: ibgeData ? `População: ${ibgeData.populacao} - PIB: ${ibgeData.pib}` : "N/I"
        },
        logica_group_software: {
          analise_fit: "Sem Análise de IA",
          modulos_sugeridos: [],
          gancho_venda: "Modo Expresso (Apenas Dados)",
          recomendacao_principal: "Análise não realizada. Modo em lote focado em contatos.",
          produtos_sugeridos: [],
          justificativa: "Modo Fast não gera argumentação."
        }
      };

      // Populate contatos from Apollo if found
      if (apolloData && apolloData.email) {
        dossier.contatos_abordagem.push({
          nome: `${apolloData.first_name} ${apolloData.last_name}`,
          cargo: apolloData.title || apolloData.job_title || "Não informado",
          canal: "Email corporativo",
          contato: apolloData.email,
          fonte: "Apollo",
          is_apollo_verified: true
        });
      }
      // Populate contatos from Seekloc if found (campos vêm no root, não em .pessoa)
      if (seeklocData) {
         const p: any = seeklocData.pessoa && Object.keys(seeklocData.pessoa).length > 0 ? seeklocData.pessoa : seeklocData;
         const telObj: any = p.telefones || {};
         const fixos: any[] = Array.isArray(telObj.fixo) ? telObj.fixo : [];
         const celulares: any[] = Array.isArray(telObj.celulares) ? telObj.celulares : [];
         [...fixos.map((t) => ({ ...t, _tipo: "Fixo" })), ...celulares.map((t) => ({ ...t, _tipo: "Celular/WhatsApp" }))].forEach((t: any) => {
            dossier.contatos_abordagem.push({
               nome: "Contato da Empresa",
               cargo: t._tipo,
               canal: t._tipo === "Celular/WhatsApp" ? "WhatsApp" : "Telefone",
               contato: `(${t.ddd}) ${t.fone}`,
               fonte: "Seekloc/Unitfour"
            });
         });
         const emailsRaw: any = p.emails || {};
         const emailsArr: any[] = Array.isArray(emailsRaw) ? emailsRaw : (Array.isArray(emailsRaw.email) ? emailsRaw.email : []);
         emailsArr.forEach((e: any) => {
            const addr = typeof e === "string" ? e : e.email;
            if (!addr) return;
            dossier.contatos_abordagem.push({
               nome: "Contato da Empresa",
               cargo: "E-mail",
               canal: "Email corporativo",
               contato: addr,
               fonte: "Seekloc/Unitfour"
            });
         });
      }

    } else {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://groupradar.lovable.app",
          "X-Title": "GroupRadar Dossier",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          max_tokens: 16384,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const gatewayError = parseAiGatewayError(errorText, response.status);
        console.error("AI gateway error:", response.status, errorText);
        return aiFailureResponse(gatewayError?.message || "Erro ao gerar dossiê", gatewayError?.status || response.status);
      }

      const aiText = await response.text();
      let aiData;
      try {
        aiData = JSON.parse(aiText);
        aiDataTracker = aiData;
      } catch {
        console.error("Failed to parse AI response:", aiText?.slice(0, 500));
        return new Response(
          JSON.stringify({ error: "Erro ao processar resposta da IA (parsing)" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const embeddedGatewayError = parseAiGatewayError(aiData, response.status);
      if (embeddedGatewayError) {
        console.error("[AI] Gateway returned error payload:", JSON.stringify(aiData).slice(0, 2000));
        return aiFailureResponse(embeddedGatewayError.message, embeddedGatewayError.status);
      }
      const content = aiData.choices?.[0]?.message?.content;
      const finishReason = aiData.choices?.[0]?.finish_reason;
      console.log("[AI] finish_reason:", finishReason, "content length:", content?.length ?? 0);

      if (!content) {
        console.error("[AI] Empty content. Full response:", JSON.stringify(aiData).slice(0, 2000));
        const isLength = finishReason === "length" || finishReason === "MAX_TOKENS";
        return new Response(
          JSON.stringify({
            success: false,
            error: isLength
              ? "Resposta da IA truncada (limite de tokens). Tente reduzir o escopo ou troque para gemini-2.5-flash ou gemini-2.5-pro."
              : `Resposta vazia da IA${finishReason ? ` (motivo: ${finishReason})` : ""}`,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
    }

    // Inject domain data directly into dossier (not AI-generated)
    dossier.dominios_associados = domainData.dominios;

    // Fase D: injeta portfolio_intel + stack_detectada + telemetria no dossier (não-IA, raw)
    if (portfolioIntel) dossier.portfolio_intel = portfolioIntel;
    if (stackDetection && (stackDetection.sistema_gestao || stackDetection.crm_marketing.length || stackDetection.analytics.length || stackDetection.app_morador.length)) {
      dossier.stack_detectada = stackDetection;
    }
    // D.5: persiste telemetria de validação de domínio (auditável via DB)
    dossier.portfolio_debug = portfolioTelemetry;

    // Inject IBGE raw data into insights
    if (ibgeData) {
      if (!dossier.insights_estrategicos) dossier.insights_estrategicos = {};
      dossier.insights_estrategicos.ibge_data = ibgeData;
    }

    // Tag Apollo verified contacts
    if (apolloData && apolloData.email && dossier.contatos_abordagem) {
      dossier.contatos_abordagem = (dossier.contatos_abordagem as any[]).map(c => {
        if (c.contato === apolloData.email) {
          return { ...c, is_apollo_verified: true };
        }
        return c;
      });
    }

    // Calculate lead qualification score V2 (now includes domain data)
    const lead_score = calculateLeadScore(dossier, cnpjDataFound, externalResults);

    // Build data_sources metadata
    const data_sources = {
      receita_federal: cnpjDataFound,
      campos_receita: cnpjDataFound
        ? ["nome", "cnpj", "situacao", "abertura", "porte", "capital_social", "endereco", "telefone", "atividade_principal", "mapeamento_socios"]
        : [],
      campos_ia: ["redes_sociais", "formacao_academica", "historico_profissional", "linkedin", "background_provavel", "insights_estrategicos", "logica_group_software", "risco_financeiro", "contatos_abordagem", "sinais_crescimento", "tecnologia_atual"],
      fontes_externas: [...externalSourcesFound, ...(domainData.dominios.length > 0 ? ["dominios_whois"] : []), ...(seeklocData ? ["seekloc"] : []), ...(googlePlacesData ? ["google_places"] : [])],
      firecrawl_details: [
        ...externalResults.map((r) => ({
          source: r.source,
          found: r.results.length > 0,
          count: r.results.length,
          error: r.error || null,
        })),
        {
          source: "dominios_whois",
          found: domainData.dominios.length > 0,
          count: domainData.dominios.length,
          error: null,
        },
      ],
    };

    if (userId) {
      const logs = [];

      if (!isFastMode && aiDataTracker?.usage) {
        const usage = aiDataTracker.usage;
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || 0;
        const costUsd = (promptTokens / 1_000_000) * 0.075 + (completionTokens / 1_000_000) * 0.30;
        logs.push({
          user_id: userId,
          api_name: "gemini",
          credits_used: totalTokens,
          cost_usd: costUsd,
          details: { prompt: promptTokens, completion: completionTokens, model: "gemini-2.5-flash-lite" }
        });
      }

      if (externalResults && externalResults.length > 0) {
        logs.push({
          user_id: userId,
          api_name: "firecrawl",
          credits_used: externalResults.length,
          cost_usd: externalResults.length * 0.001,
          details: { count: externalResults.length }
        });
      }

      if (seeklocData) {
        logs.push({
          user_id: userId,
          api_name: "seekloc",
          credits_used: 2, 
          cost_usd: 0.05, 
          details: { calls: 2 }
        });
      }

      if (googlePlacesData) {
        logs.push({
          user_id: userId,
          api_name: "google_places",
          credits_used: 1,
          cost_usd: 0.017, 
          details: { calls: 1 }
        });
      }

      if (cnpjDataFound) {
        logs.push({
          user_id: userId,
          api_name: "brasilapi",
          credits_used: 1,
          cost_usd: 0,
          details: { calls: 1 }
        });
      }

      if (logs.length > 0) {
        try {
          const sb = getSupabaseAdmin();
          await sb.from("api_usage_logs").insert(logs);
        } catch (err) {
          console.error("[Usage Tracking] Error inserting logs:", err);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dossier,
        data_sources,
        lead_score,
        linkedin_debug: {
          ...linkedinTelemetry,
          cache_hits: telemetryCounter.cacheHits,
          live_scrapes: telemetryCounter.scrapes,
        },
        portfolio_debug: portfolioTelemetry,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    }; // end runPipeline

    // Kick off pipeline in background; persist result to dossier_jobs when done.
    // @ts-ignore - EdgeRuntime is provided by Supabase Deno runtime
    EdgeRuntime.waitUntil((async () => {
      try {
        const resp = await runPipeline();
        let payload: Record<string, unknown> = {};
        try { payload = await resp.json(); } catch { /* ignore */ }
        if (payload.success) {
          await sbAdmin.from("dossier_jobs").update({
            status: "completed",
            result: payload,
          }).eq("id", jobId);
        } else {
          await sbAdmin.from("dossier_jobs").update({
            status: "failed",
            error: (payload.error as string) || "Erro desconhecido",
          }).eq("id", jobId);
        }
      } catch (err) {
        console.error("[Job] Pipeline failed:", err);
        await sbAdmin.from("dossier_jobs").update({
          status: "failed",
          error: err instanceof Error ? err.message : "Erro desconhecido",
        }).eq("id", jobId);
      }
    })());

    return new Response(
      JSON.stringify({ success: true, job_id: jobId, status: "processing" }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating dossier:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
