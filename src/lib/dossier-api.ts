import { supabase } from "@/integrations/supabase/client";

export type InputType = "email" | "cnpj" | "nome";

export interface Socio {
  nome: string;
  cargo: string;
  background_provavel: string;
}

export interface FonteExterna {
  encontrado: boolean;
  resumo: string;
  url?: string;
  urls?: string[];
}

export interface FontesExternas {
  reclame_aqui?: FonteExterna;
  processos_judiciais?: FonteExterna;
  linkedin?: FonteExterna;
  noticias?: FonteExterna;
}

export interface Dossier {
  empresa: {
    nome: string;
    cnpj: string;
    situacao: string;
    abertura: string;
    porte: string;
    capital_social: string;
    endereco: string;
    telefone: string;
    redes_sociais: string;
    reputacao: string;
    atividade_principal: string;
  };
  socio_principal: {
    nome: string;
    cargo: string;
    formacao_academica: string;
    historico_profissional: string;
    linkedin: string;
    background_provavel: string;
  };
  mapeamento_socios: Socio[];
  fontes_externas?: FontesExternas;
  insights_estrategicos: {
    janela_oportunidade: string;
    abordagem_personalizada: {
      canal_ideal: string;
      tom_de_voz: string;
      argumento_central: string;
    };
    ressonancia_por_perfil: Array<{
      socio: string;
      ponto_de_dor: string;
    }>;
    o_que_evitar: string;
  };
  logica_group_software: {
    recomendacao_principal: string;
    produtos_sugeridos: string[];
    justificativa: string;
  };
}

export interface FirecrawlDetail {
  source: string;
  found: boolean;
  count: number;
  error: string | null;
}

export interface DataSources {
  receita_federal: boolean;
  campos_receita: string[];
  campos_ia: string[];
  fontes_externas?: string[];
  firecrawl_details?: FirecrawlDetail[];
}

export interface LeadScoreBreakdown {
  categoria: string;
  pontos: number;
  max: number;
  detalhe: string;
}

export interface LeadScore {
  total: number;
  max: number;
  percentual: number;
  classificacao: "Frio" | "Morno" | "Quente" | "Muito Quente";
  cor: string;
  breakdown: LeadScoreBreakdown[];
}

export interface DossierResult {
  dossier: Dossier;
  data_sources: DataSources;
  lead_score?: LeadScore;
}

export interface DossierHistoryItem {
  id: string;
  input: string;
  input_type: string;
  empresa_nome: string | null;
  empresa_cnpj: string | null;
  created_at: string;
  dossier_data: Dossier;
}

export async function generateDossier(input: string, inputType: InputType, skipCache = false): Promise<DossierResult> {
  const { data, error } = await supabase.functions.invoke("generate-dossier", {
    body: { input, input_type: inputType, skip_cache: skipCache },
  });

  if (error) {
    throw new Error(error.message || "Erro ao gerar dossiê");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Erro desconhecido");
  }

  const dossier = data.dossier as Dossier;
  const data_sources = (data.data_sources || { receita_federal: false, campos_receita: [], campos_ia: [], fontes_externas: [], firecrawl_details: [] }) as DataSources;
  const lead_score = (data.lead_score || undefined) as LeadScore | undefined;

  // Save to history
  await supabase.from("dossier_history").insert([{
    input,
    input_type: inputType,
    empresa_nome: dossier.empresa?.nome || null,
    empresa_cnpj: dossier.empresa?.cnpj || null,
    dossier_data: JSON.parse(JSON.stringify(dossier)),
  }]);

  return { dossier, data_sources, lead_score };
}

export async function fetchHistory(): Promise<DossierHistoryItem[]> {
  const { data, error } = await supabase
    .from("dossier_history")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []) as unknown as DossierHistoryItem[];
}
