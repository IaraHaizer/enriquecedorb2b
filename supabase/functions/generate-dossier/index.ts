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

  return [...new Set(candidates)].slice(0, 12);
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
      if (!d.match(/registro\.br|google|facebook|instagram|linkedin|twitter|youtube|whois|jusbrasil|reclame/)) {
        extraDomains.add(d);
      }
    }
    // Also extract domain from URL directly
    if (r.url) {
      try {
        const urlDomain = new URL(r.url).hostname.replace(/^www\./, "");
        if (!urlDomain.match(/google|facebook|instagram|linkedin|twitter|youtube|whois|jusbrasil|reclame|registro\.br/)) {
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

async function fetchApolloEnrichment(options: { 
  firstName?: string; 
  lastName?: string; 
  email?: string; 
  domain?: string; 
}): Promise<Record<string, unknown> | null> {
  const apiKey = Deno.env.get("APOLLO_API_KEY");
  if (!apiKey) {
    console.warn("[Apollo] API key not configured");
    return null;
  }

  try {
    console.log(`[Apollo] Enriching: ${options.email || `${options.firstName} ${options.lastName} @ ${options.domain}`}`);
    const response = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        first_name: options.firstName,
        last_name: options.lastName,
        email: options.email,
        domain: options.domain,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Apollo] Error ${response.status}: ${errText}`);
      return null;
    }

    const data = await response.json();
    return (data.person as Record<string, unknown>) || null;
  } catch (err) {
    console.warn("[Apollo] Fetch error:", err);
    return null;
  }
}

async function fetchIbgeData(codigoIbge: string): Promise<Record<string, unknown> | null> {
  if (!codigoIbge) return null;
  const cleanCode = codigoIbge.replace(/\D/g, "");
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

async function fetchSeeklocData(documento: string, tipo: string = "1"): Promise<Record<string, unknown> | null> {
  const user = Deno.env.get("SEEKLOC_USER");
  const pwd = Deno.env.get("SEEKLOC_PWD");
  const emp = Deno.env.get("SEEKLOC_EMP");

  if (!user || !pwd || !emp) {
    console.warn("[Seekloc] Credentials not configured");
    return null;
  }

  try {
    const cleanDoc = documento.replace(/[^\d]/g, "");
    console.log(`[Seekloc] Querying for document: ${cleanDoc} (type: ${tipo})`);
    
    const body = new URLSearchParams();
    body.append("usr", user);
    body.append("pwd", pwd);
    body.append("emp", emp);
    body.append("tp", tipo);
    body.append("doc", cleanDoc);

    const response = await fetch("http://200.201.193.100/seekloc/ws.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      console.warn(`[Seekloc] Error ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data || null;
  } catch (err) {
    console.warn("[Seekloc] Fetch error:", err);
    return null;
  }
}

function formatSeeklocContext(data: any): string {
  if (!data || data.retornado === "nao") return "";
  
  const p = data.pessoa || {};
  const teltes = (p.telefones || []) as any[];
  const emails = (p.emails || []) as any[];
  const enderecos = (p.enderecos || []) as any[];
  
  return `
=== DADOS COMPLEMENTARES SEEKLOC (Unitfour) ===
Telefones: ${teltes.map(t => `${t.ddd}${t.fone} (${t.tipo || "Fixo"})`).join(", ") || "N/A"}
E-mails: ${emails.map(e => e.email).join(", ") || "N/A"}
Endereços Encontrados:
${enderecos.map(e => `- ${e.logradouro}, ${e.numero} - ${e.bairro} - ${e.cidade}/${e.uf} (CEP: ${e.cep})`).join("\n") || "N/A"}
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
  const normalize = (s: string) => s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Remove accents

  return normalize(name)
    .replace(/\b(ltda|s\.?a\.?|eireli|me|epp|limitada?|despachos|assessoria|administracao|gestao|condominios?|imobiliaria|servicos?|comercio|industria|do brasil|brasileira?|de|do|da|dos|das|e)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
    ? `("${brandName}" OR "${dominio}") site:linkedin.com/company`
    : `("${brandName}" OR "${empresaNome}") site:linkedin.com/company`;

  const sources = [
    { name: "reclame_aqui", query: `"${brandName}" site:reclameaqui.com.br`, opts: { limit: 3 } },
    { name: "jusbrasil_escavador", query: `"${brandName}" (site:jusbrasil.com.br OR site:escavador.com)`, opts: { limit: 3 } },
    { name: "linkedin", query: linkedinQuery, opts: { limit: 5 } },
    { name: "instagram", query: `"${brandName}" site:instagram.com`, opts: { limit: 3 } },
    { name: "facebook", query: `"${brandName}" site:facebook.com`, opts: { limit: 3 } },
    { name: "youtube", query: `"${brandName}" site:youtube.com`, opts: { limit: 2 } },
    { name: "twitter_x", query: `"${brandName}" site:twitter.com OR site:x.com`, opts: { limit: 2 } },
    { name: "google_news", query: `"${brandName}" notícias`, opts: { limit: 3, tbs: "qdr:y" } },
    { name: "protestos_negativacoes", query: `"${brandName}" protesto OR negativação OR serasa`, opts: { limit: 3 } },
    { name: "vagas_crescimento", query: `"${brandName}" vagas OR contratando OR expansão`, opts: { limit: 3, tbs: "qdr:m" } },
    { name: "tech_stack", query: `"${brandName}" ERP OR software OR superlógica OR condomob`, opts: { limit: 3 } },
    { name: "localizacao_contatos", query: `"${brandName}" site:casadosdados.com.br OR site:econodata.com.br OR site:cnpja.com`, opts: { limit: 3 } },
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

function extractSocialLinksFromMarkdown(markdown: string): string[] {
  if (!markdown) return [];
  const socialPatterns = [
    /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/(?:user|channel|c)\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?twitter\.com\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?x\.com\/[a-zA-Z0-9._-]+/gi,
  ];

  const links = new Set<string>();
  for (const pattern of socialPatterns) {
    const matches = markdown.match(pattern);
    if (matches) {
      matches.forEach(link => {
        // Basic cleanup
        const clean = link.replace(/[.,;]$/, "").split(/[?#]/)[0];
        if (!clean.match(/login|share|privacy|terms|policies/i)) {
          links.add(clean);
        }
      });
    }
  }
  return [...links];
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
    }
    const { input, input_type, skip_cache, process_mode } = parsedBody;
    const isFastMode = process_mode === "fast";

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
    let emailInput = input_type === "email" ? (input as string) : null;

    // === NEW EMAIL FLOW ===
    if (emailInput) {
      console.log(`[Email Flow] Starting search for email: ${emailInput}`);
      // 1. Try Apollo to find company from email
      const apolloInitial = await fetchApolloEnrichment({ email: emailInput });
      if (apolloInitial?.organization) {
        const org: any = apolloInitial.organization;
        empresaNome = org.name;
        const orgDomain = org.primary_domain;
        console.log(`[Email Flow] Apollo found company: "${empresaNome}" | Domain: ${orgDomain}`);
        
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
      } else {
        // Fallback: use domain from email
        const domain = emailInput.split("@")[1];
        if (domain && !domain.match(/gmail|hotmail|outlook|yahoo|uol|bol|terra|ig\.com/i)) {
          console.log(`[Email Flow] Domain fallback: ${domain}`);
          const domainSearch = await firecrawlSearch(
             `CNPJ "${domain}" site:registro.br OR site:cnpj.biz`,
             "domain_to_cnpj", { limit: 2 }
          );
          const cnpjMatch = domainSearch.results.map(r => r.title + r.description).join(" ").match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
          if (cnpjMatch) {
            cnpj = cnpjMatch[0];
            console.log(`[Email Flow] Found CNPJ via domain: ${cnpj}`);
          }
        }
      }
    }

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
    const [domainData, externalResults, externalPersonResults, seeklocData, ibgeData] = await Promise.all([
      fetchDomainInfo(empresaNome, cnpj, cnpjDataRef, !!skip_cache),
      fetchExternalSources(empresaNome, nomeFantasia, null, cnpj, enderecoCompleto, !!skip_cache, isFastMode),
      // Buscas focadas na PESSOA para input tipo email (reduzir no FastMode)
      personNomeDerivado && personNomeDerivado.length > 4 ? Promise.all([
        firecrawlSearch(`"${personNomeDerivado}" site:linkedin.com/in`, "person_linkedin", { limit: isFastMode ? 2 : 3 }),
        !isFastMode ? firecrawlSearch(`"${personNomeDerivado}" site:instagram.com`, "person_instagram", { limit: 2 }) : Promise.resolve(null),
      ]) : Promise.resolve(null),
      cnpj ? fetchSeeklocData(cnpj, "1") : Promise.resolve(null),
      cnpjDataRef?.codigo_municipio_ibge ? fetchIbgeData(cnpjDataRef.codigo_municipio_ibge as string) : Promise.resolve(null)
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
      apolloContext = `\n=== DADOS ENRIQUECIDOS APOLLO (SOCIO/CONTATO) ===\n` +
        `Nome: ${apolloData.first_name} ${apolloData.last_name}\n` +
        `Cargo: ${apolloData.title || apolloData.job_title || "Não informado"}\n` +
        `LinkedIn: ${apolloData.linkedin_url || "Não informado"}\n` +
        `Twitter: ${apolloData.twitter_url || "Não informado"}\n` +
        `E-mail Corporativo: ${apolloData.email || "Não informado"}\n` +
        `Status E-mail: ${apolloData.email_status || "Não informado"}\n` +
        (apolloData.organization ? `Empresa no Apollo: ${(apolloData.organization as any).name}\n` : "");
    }

    let ibgeContext = "";
    if (ibgeData) {
      ibgeContext = `\n=== DADOS SOCIOECONÔMICOS MUNICIPAIS (IBGE) ===\n` +
        `Município: ${cnpjDataRef?.municipio || "N/I"}/${cnpjDataRef?.uf || "N/I"}\n` +
        (ibgeData.populacao ? `População: ${Number(ibgeData.populacao).toLocaleString("pt-BR")} habitantes (${ibgeData.populacao_ano})\n` : "") +
        (ibgeData.pib ? `PIB Municipal: R$ ${Number(ibgeData.pib).toLocaleString("pt-BR")} mil (${ibgeData.pib_ano})\n` : "");
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
${internalDomainWarning}${cascadeContext ? `\n=== DADOS DO EFEITO CASCATA (Nome → LinkedIn → Empresa → CNPJ) ===${cascadeContext}\n=== FIM CASCATA ===` : ""}
${cnpjContext ? `\n${cnpjContext}\n\nUse os dados reais acima como base principal para o dossiê.` : ""}
${apolloContext ? `\n${apolloContext}\n\nUse os dados do Apollo acima para preencher contatos_abordagem e validar o LinkedIn do sócio principal.` : ""}
${ibgeContext ? `\n${ibgeContext}\n\nUse os dados do IBGE para fornecer "contexto_regional" e estimar o ticket médio dos condomínios na região.` : ""}
${seeklocContext ? `\n${seeklocContext}\n\nUse os dados do Seekloc como fonte secundária e altamente confiável para telefones, e-mails e endereços. Se houver divergência com a Receita Federal, mencione a existência de dados mais recentes no Seekloc.` : ""}
${personContext ? `\n${personContext}\n\nINSTRUÇÃO DE CRUZAMENTO — PERFIL DO CONTATO x EMPRESA:\nO perfil pessoal acima é de um decisor ou sócio da empresa analisada. Use esses dados para ENRIQUECER o dossiê da EMPRESA, não para fazer um dossiê da pessoa:\n- Use o cargo e empresa listados no LinkedIn para CONFIRMAR o porte e segmento da empresa.\n- Use o histórico profissional para entender o nível de maturidade e exigência da gestão (ex: sócio com passagem por grandes grupos = empresa bem estruturada).\n- Use menções a portfólio (ex: "gerenciamos 300 condomínios" no perfil) para estimar o volume da empresa.\n- Use o Instagram para capturar posicionamento de marca, estilo de comunicação, eventos, parcerias e sinais de crescimento da empresa.\n- Preencha socio_principal.linkedin com a URL real encontrada e socio_principal.historico_profissional com o que encontrou no perfil.\n- Preencha contatos_abordagem com a pessoa encontrada, incluindo canal preferencial baseado no perfil pessoal (ex: LinkedIn se for ativo lá).` : ""}
${externalContext ? `\n${externalContext}\n\nUse os dados das fontes externas para enriquecer o dossiê. As fontes "protestos_negativacoes", "vagas_crescimento" e "tech_stack" são NOVAS — use-as para preencher risco_financeiro, sinais_crescimento e tecnologia_atual. AS FONTES "localizacao_contatos" e "grupo_economico" trazem dados de localização e outras empresas no endereço — use-as para cruzar com o endereço da Receita e preencher grupos_economicos. A FONTE "direct_contacts" traz links diretos do site da empresa — use-a para encontrar WhatsApp e e-mails oficiais.` : ""}
${domainContext ? `\n${domainContext}\n\nUse os dados de domínio/WHOIS para avaliar a presença digital da empresa. Domínios ativos com registrante correspondente ao CNPJ indicam boa presença online. Se houver CONTEÚDO DO SITE, analise-o profundamente para extrair: serviços oferecidos, portfólio de condomínios/imóveis, equipe, diferenciais, tecnologias usadas, e qualquer informação que enriqueça o dossiê e a abordagem comercial.` : ""}

LEMBRETE OBRIGATÓRIO:
1. Na seção "logica_group_software", use ESTRITAMENTE os produtos dos catálogos Group Software e PartnerBank.
2. Preencha TODAS as novas seções: risco_financeiro, contatos_abordagem, sinais_crescimento, tecnologia_atual, is_pep para sócios.
3. Inclua "analise_fit", "modulos_sugeridos" (nomes exatos dos sites), e "gancho_venda" (copy do site).

Analise profundamente e retorne o JSON estruturado conforme o formato especificado.`;

    let dossier;

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
          reputacao: "Busca ignorada (Fast Mode)",
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
      // Populate contatos from Seekloc if found
      if (seeklocData && seeklocData.pessoa) {
         const p = seeklocData.pessoa;
         if (p.telefones) {
            (p.telefones as any[]).forEach(t => {
               dossier.contatos_abordagem.push({
                  nome: "Contato da Empresa",
                  cargo: t.tipo || "Telefone",
                  canal: "Telefone",
                  contato: `(${t.ddd}) ${t.fone}`,
                  fonte: "Unitfour"
               });
            });
         }
         if (p.emails) {
            (p.emails as any[]).forEach(e => {
               dossier.contatos_abordagem.push({
                  nome: "Contato da Empresa",
                  cargo: "Email",
                  canal: "Email corporativo",
                  contato: e.email,
                  fonte: "Unitfour"
               });
            });
         }
      }

    } else {
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
      fontes_externas: [...externalSourcesFound, ...(domainData.dominios.length > 0 ? ["dominios_whois"] : []), ...(seeklocData ? ["seekloc"] : [])],
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
