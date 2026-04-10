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

export async function generateDossier(input: string, inputType: InputType): Promise<Dossier> {
  const { data, error } = await supabase.functions.invoke("generate-dossier", {
    body: { input, input_type: inputType },
  });

  if (error) {
    throw new Error(error.message || "Erro ao gerar dossiê");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Erro desconhecido");
  }

  return data.dossier as Dossier;
}
