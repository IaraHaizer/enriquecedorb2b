import { supabase } from "@/integrations/supabase/client";

export type InputType = "email" | "cnpj" | "nome";

export interface Socio {
  nome: string;
  cargo: string;
  background_provavel: string;
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

export interface DataSources {
  receita_federal: boolean;
  campos_receita: string[];
  campos_ia: string[];
}

export interface DossierResult {
  dossier: Dossier;
  data_sources: DataSources;
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

export async function generateDossier(input: string, inputType: InputType): Promise<DossierResult> {
  const { data, error } = await supabase.functions.invoke("generate-dossier", {
    body: { input, input_type: inputType },
  });

  if (error) {
    throw new Error(error.message || "Erro ao gerar dossiê");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Erro desconhecido");
  }

  const dossier = data.dossier as Dossier;
  const data_sources = (data.data_sources || { receita_federal: false, campos_receita: [], campos_ia: [] }) as DataSources;

  // Save to history
  await supabase.from("dossier_history").insert([{
    input,
    input_type: inputType,
    empresa_nome: dossier.empresa?.nome || null,
    empresa_cnpj: dossier.empresa?.cnpj || null,
    dossier_data: JSON.parse(JSON.stringify(dossier)),
  }]);

  return { dossier, data_sources };
}

export async function fetchHistory(): Promise<DossierHistoryItem[]> {
  const { data, error } = await supabase
    .from("dossier_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data || []) as unknown as DossierHistoryItem[];
}
