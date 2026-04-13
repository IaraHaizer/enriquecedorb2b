import { Flame, Thermometer, Snowflake } from "lucide-react";
import type { Dossier } from "@/lib/dossier-api";

export const SCORE_MAX = 130;

export interface ScoreBreakdown {
  categoria: string;
  pontos: number;
  max: number;
  detalhe: string;
}

export interface ScoreResult {
  total: number;
  max: number;
  percentual: number;
  breakdown: ScoreBreakdown[];
}

export function calcScoreV2(d: Dossier): ScoreResult {
  const breakdown: ScoreBreakdown[] = [];
  const e = d.empresa;

  // 1. Dados Cadastrais (max 20)
  let cadastrais = 0;
  if (e?.cnpj) cadastrais += 10;
  if (e?.situacao?.toLowerCase().includes("ativa")) cadastrais += 10;
  breakdown.push({ categoria: "Dados Cadastrais", pontos: cadastrais, max: 20, detalhe: cadastrais >= 20 ? "CNPJ ativo verificado" : "Dados parciais" });

  // 2. Maturidade (max 15)
  let maturidade = 0;
  if (e?.abertura) {
    const match = e.abertura.match(/(\d{4})/);
    if (match) {
      const anos = new Date().getFullYear() - parseInt(match[1]);
      maturidade += anos >= 10 ? 10 : anos >= 5 ? 7 : anos >= 2 ? 4 : 2;
    }
  }
  if (e?.capital_social) {
    const v = parseFloat(e.capital_social.replace(/[^\d,]/g, "").replace(",", "."));
    maturidade += v > 1000000 ? 5 : v > 100000 ? 3 : 1;
  }

  // Regional Bonus (IBGE)
  const ibge = d.insights_estrategicos?.ibge_data;
  let regionalBonus = false;
  if (ibge) {
    const pib = parseFloat(ibge.pib || "0");
    const pop = parseInt(ibge.populacao || "0");
    if (pib > 10000000 || pop > 200000) {
      maturidade += 2;
      regionalBonus = true;
    }
  }

  maturidade = Math.min(maturidade, 15);
  breakdown.push({ 
    categoria: "Maturidade", 
    pontos: maturidade, 
    max: 15, 
    detalhe: `${e?.abertura || "?"}, Capital: ${e?.capital_social || "?"}${regionalBonus ? " + Bônus Regional" : ""}` 
  });

  // 3. Estrutura Societária (max 10)
  const numSocios = d.mapeamento_socios?.length || 0;
  const societaria = numSocios >= 3 ? 10 : numSocios >= 1 ? 5 : 0;
  breakdown.push({ categoria: "Estrutura Societária", pontos: societaria, max: 10, detalhe: `${numSocios} sócio(s) mapeado(s)` });

  // 4. Presença Digital (max 15) — includes domain data
  let digital = 0;
  if (d.socio_principal?.linkedin && !["Não encontrado", "Não identificado"].includes(d.socio_principal.linkedin)) digital += 3;
  if (e?.redes_sociais && !["Não informado", "Não identificado"].includes(e.redes_sociais)) digital += 3;
  if (d.fontes_externas?.linkedin?.encontrado) digital += 3;
  const dominios = d.dominios_associados || [];
  if (dominios.length > 0) digital += 3;
  if (dominios.length >= 2) digital += 3;
  digital = Math.min(digital, 15);
  const domainDetail = dominios.length > 0 ? `${dominios.length} domínio(s) registrado(s)` : "";
  breakdown.push({ categoria: "Presença Digital", pontos: Math.min(digital, 15), max: 15, detalhe: domainDetail || (digital >= 10 ? "Boa presença online" : "Presença limitada") });

  // 5. Reputação / Riscos (max 15)
  let reputacao = 10; // base
  if (d.fontes_externas?.reclame_aqui?.encontrado) reputacao -= 2;
  if (d.fontes_externas?.processos_judiciais?.encontrado) reputacao -= 4;
  if (d.fontes_externas?.noticias?.encontrado) reputacao += 3;
  breakdown.push({ categoria: "Reputação / Riscos", pontos: Math.max(0, Math.min(reputacao, 15)), max: 15, detalhe: d.fontes_externas?.processos_judiciais?.encontrado ? "Processos judiciais encontrados" : "Sem alertas graves" });

  // 6. Cobertura de Dados (max 15)
  const fontes = [
    d.fontes_externas?.reclame_aqui?.encontrado,
    d.fontes_externas?.processos_judiciais?.encontrado,
    d.fontes_externas?.linkedin?.encontrado,
    d.fontes_externas?.noticias?.encontrado,
  ].filter(Boolean).length;
  const cobertura = Math.min(Math.round((fontes / 4) * 15), 15);
  breakdown.push({ categoria: "Cobertura de Dados", pontos: cobertura, max: 15, detalhe: `${fontes}/4 fontes externas com dados` });

  // 7. Saúde Financeira (max 10) — NEW V2
  let financeiro = 10;
  const risco = d.risco_financeiro;
  if (risco) {
    if (risco.nivel_risco === "Crítico") financeiro = 0;
    else if (risco.nivel_risco === "Alto") financeiro = 3;
    else if (risco.nivel_risco === "Médio") financeiro = 6;
    else financeiro = 10;
  }
  breakdown.push({ categoria: "Saúde Financeira", pontos: financeiro, max: 10, detalhe: risco ? `Nível: ${risco.nivel_risco}` : "Sem dados de risco" });

  // 8. Fit Tecnológico (max 10) — NEW V2
  let techFit = 5; // default neutral
  const tech = e?.tecnologia_atual?.toLowerCase() || "";
  if (tech && !tech.includes("não identificado")) {
    const concorrentes = ["superlógica", "superlogica", "condomob", "mycond", "uau", "cidade inteligente"];
    if (concorrentes.some((c) => tech.includes(c))) techFit = 8; // usa concorrente = oportunidade de migração
    else techFit = 3; // usa algo diferente
  } else {
    techFit = 10; // greenfield
  }
  breakdown.push({ categoria: "Fit Tecnológico", pontos: techFit, max: 10, detalhe: tech && !tech.includes("não identificado") ? `Usa: ${e?.tecnologia_atual}` : "Greenfield (sem sistema)" });

  // 9. Sinais de Crescimento (max 10) — NEW V2
  let crescimento = 0;
  const sinais = d.sinais_crescimento || [];
  const positivos = sinais.filter((s) => s.tipo === "positivo").length;
  const negativos = sinais.filter((s) => s.tipo === "negativo").length;
  crescimento = Math.min(positivos * 4, 10) - Math.min(negativos * 2, 5);
  breakdown.push({ categoria: "Sinais de Crescimento", pontos: Math.max(0, Math.min(crescimento, 10)), max: 10, detalhe: `${positivos} positivo(s), ${negativos} negativo(s)` });

  // 10. Validação Cruzada (max 10) — NEW V2 Refined
  let validacao = 0;
  const contatos = d.contatos_abordagem || [];
  const hasApollo = contatos.some(c => c.is_apollo_verified);
  const hasValidatedDomain = dominios.some(d => d.is_validated);
  if (hasApollo) validacao += 5;
  if (hasValidatedDomain) validacao += 5;
  breakdown.push({ 
    categoria: "Validação Cruzada", 
    pontos: validacao, 
    max: 10, 
    detalhe: `${hasApollo ? "Apollo verificado" : ""} ${hasValidatedDomain ? "Domínio validado" : ""}`.trim() || "Nenhuma validação extra" 
  });

  const total = breakdown.reduce((s, b) => s + b.pontos, 0);
  return {
    total: Math.min(total, SCORE_MAX),
    max: SCORE_MAX,
    percentual: Math.round((Math.min(total, SCORE_MAX) / SCORE_MAX) * 100),
    breakdown,
  };
}

export function getClassificacaoV2(percentual: number) {
  if (percentual >= 75) return { label: "Muito Quente", color: "text-red-400", bg: "bg-red-500/10", icon: Flame };
  if (percentual >= 55) return { label: "Quente", color: "text-orange-400", bg: "bg-orange-500/10", icon: Flame };
  if (percentual >= 35) return { label: "Morno", color: "text-yellow-400", bg: "bg-yellow-500/10", icon: Thermometer };
  return { label: "Frio", color: "text-blue-400", bg: "bg-blue-500/10", icon: Snowflake };
}
