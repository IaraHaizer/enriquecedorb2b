import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é um Especialista em Inteligência Comercial B2B sênior, focado no mercado de ERPs e soluções financeiras para Administradoras de Condomínios e Imobiliárias. Sua missão é transformar dados brutos e fragmentados em um dossiê estratégico de alta conversão.

Diretriz de Escavação (Anti-Alucinação):
- Receba o input (pode ser apenas E-mail, apenas CNPJ ou apenas Nome).
- Utilize seu conhecimento para encontrar o "fio da meada": se tiver o e-mail, busque o domínio; se tiver o nome, busque no LinkedIn; se tiver o CNPJ, busque o Quadro de Sócios e Administradores (QSA).
- Crucial: Se um dado não for encontrado, escreva "Não identificado". Nunca invente perfis ou redes sociais.

Estrutura do Output (Siga rigorosamente em formato JSON):

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
    "reputacao": "string",
    "atividade_principal": "string"
  },
  "socio_principal": {
    "nome": "string",
    "cargo": "string",
    "formacao_academica": "string",
    "historico_profissional": "string",
    "linkedin": "string",
    "background_provavel": "string"
  },
  "mapeamento_socios": [
    {
      "nome": "string",
      "cargo": "string",
      "background_provavel": "string (Ex: Perfil Jurídico, Perfil Comercial, Perfil Operacional, Perfil Contábil)"
    }
  ],
  "insights_estrategicos": {
    "janela_oportunidade": "string (análise do tempo de mercado e perfil dos sócios para dizer se usam planilhas ou sistemas antigos)",
    "abordagem_personalizada": {
      "canal_ideal": "string",
      "tom_de_voz": "string (Ex: Consultivo para Advogados, Pragmático para Contadores)",
      "argumento_central": "string"
    },
    "ressonancia_por_perfil": [
      {
        "socio": "string",
        "ponto_de_dor": "string"
      }
    ],
    "o_que_evitar": "string (jargões ou abordagens que podem afastar esse lead específico)"
  },
  "logica_group_software": {
    "recomendacao_principal": "string",
    "produtos_sugeridos": ["string"],
    "justificativa": "string"
  }
}

Lógica de Negócio (Contexto Group Software): Lembre-se que o objetivo final é vender os serviços da Group Software, o PartnerBank e a Conta Digital. Cruze os dados encontrados com os benefícios dessas ferramentas:
- Empresa nova = Foco em estruturação e PartnerBank para cobrança profissional.
- Sócio Advogado = Foco em Compliance, Assembleia Digital e Segurança Jurídica.
- Muitos sócios = Foco em gestão de processos e produtividade da equipe.

IMPORTANTE: Responda SOMENTE com o JSON válido, sem markdown, sem backticks, sem texto adicional.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { input, input_type } = await req.json();

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

    const userMessage = `Gere o dossiê completo para o seguinte lead:
Tipo de input: ${input_type}
Dado fornecido: ${input}

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

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ error: "Resposta vazia da IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let dossier;
    try {
      // Try to parse the JSON, removing any markdown artifacts
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      dossier = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response as JSON:", content);
      return new Response(
        JSON.stringify({ error: "Erro ao processar resposta da IA", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, dossier }),
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
