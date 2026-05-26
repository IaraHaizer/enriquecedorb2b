## Objetivo
Reduzir consumo de créditos do Lovable AI Gateway trocando o modelo padrão usado na síntese do dossiê.

## Situação atual
A `generate-dossier` já usa `google/gemini-2.5-flash` (não `pro`). Mesmo assim o erro 402 apareceu por saldo zerado. Para reduzir ainda mais o custo por dossiê, dá pra descer um degrau.

## Mudanças

**`supabase/functions/generate-dossier/index.ts`**
- Linha 1918: trocar `model: "google/gemini-2.5-flash"` → `model: "google/gemini-2.5-flash-lite"` (mais barato e mais rápido da família Gemini 2.5).
- Linha 2041: atualizar o `model` registrado no log de `api_usage_logs` para `gemini-2.5-flash-lite` (manter consistência das estatísticas).
- Linha 1962: ajustar a mensagem de truncamento para sugerir subir para `gemini-2.5-flash` ou `gemini-2.5-pro` em caso de resposta cortada.

## Observações
- `flash-lite` é o mais econômico da linha 2.5. Em troca, perde alguma nuance em raciocínio complexo — pra síntese de dossiê estruturado costuma ser suficiente, mas se notar queda de qualidade dá pra voltar pro `flash`.
- Nenhuma mudança de schema, RLS, UI ou prompt. Apenas o identificador do modelo.
- Ainda é necessário ter saldo no Lovable AI; o erro 402 só some quando a workspace tiver créditos.
