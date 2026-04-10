

# Enriquecimento de Leads Avançado — Inspirado no InTouch/Unitfour

## O que o InTouch oferece que ainda não temos

O InTouch foca em: localização de pessoas/empresas, validação cadastral, **análise de crédito e risco**, compliance (KYC/PLD/PEP), antifraude e enriquecimento de contatos em massa. Nosso dossiê já cobre bem a parte de inteligência comercial, mas falta profundidade em **risco, validação e dados de contato**.

## Incrementos Propostos (por prioridade)

### 1. Indicadores de Risco Financeiro
- Buscar via Firecrawl dados de **protestos e negativações** (sites como SerasaExperian, Boa Vista SCPC)
- Adicionar seção `risco_financeiro` ao dossiê com: protestos encontrados, pendências financeiras, regularidade fiscal
- Impacta diretamente no score de qualificação (lead com muitos protestos = risco)

### 2. Detecção de PEP (Pessoa Exposta Politicamente)
- Buscar se algum sócio é PEP via Firecrawl (Portal da Transparência, Diário Oficial)
- Flag visual no dossiê: "Sócio X é PEP" com badge de alerta
- Relevante para compliance e abordagem diferenciada

### 3. Enriquecimento de Contatos (Multi-decisor)
- Além do sócio principal, buscar **e-mails e telefones** de outros decisores via Firecrawl (LinkedIn, sites de contato corporativo)
- Seção "Contatos para Abordagem" com nome, cargo, canal preferencial
- Inspirado no "Autopreenchimento de dados" e "Cadastro" do InTouch

### 4. Análise de Tecnologia (Tech Stack)
- Buscar via Firecrawl se a empresa já usa algum ERP concorrente (Superlogica, Condomob, etc.)
- Informação estratégica: se já usa sistema, é migração; se não usa, é venda greenfield
- Adiciona campo `tecnologia_atual` ao dossiê

### 5. Sinais de Crescimento
- Buscar se a empresa está contratando (vagas abertas)
- Verificar notícias de expansão, novos empreendimentos, fusões
- Seção `sinais_crescimento` com indicadores positivos/negativos
- Impacta no score: empresa crescendo = lead mais quente

### 6. Score de Qualificação V2 (mais dimensões)
- Adicionar novas dimensões ao score:
  - Risco Financeiro (-10 a +10)
  - Fit Tecnológico (0 a 10) — usa concorrente? não usa nada?
  - Sinais de Crescimento (0 a 10)
- Score passa de 100 para um modelo mais refinado

## Implementação Técnica

### Edge Function (`generate-dossier/index.ts`)
- Adicionar 3 novas buscas Firecrawl: protestos/negativações, vagas/crescimento, stack tecnológico
- Expandir o `SYSTEM_PROMPT` com instruções para as novas seções
- Atualizar `calculateLeadScore` com as novas dimensões
- Todas as buscas novas usam o mesmo sistema de cache existente

### Frontend (`DossierDisplay.tsx`)
- Nova seção "Risco Financeiro" com badges de alerta (protestos, negativações)
- Nova seção "Contatos para Abordagem" com tabela de decisores
- Nova seção "Sinais de Crescimento" com indicadores visuais
- Flag PEP como badge de alerta nos cards de sócios
- Indicador de tech stack na seção da empresa

### Tipos (`dossier-api.ts`)
- Expandir a interface `Dossier` com os novos campos
- Atualizar `LeadScore` para as novas dimensões

### Ranking e Histórico
- Ranking atualizado para refletir o score V2
- Exportação CSV inclui os novos campos

## O que NÃO implementar agora
- Integração direta com bureaus de crédito (Serasa API, Boa Vista API) — requer contratos e APIs pagas. Usamos Firecrawl como proxy para buscar informações públicas
- Validação de documentos/antifraude — fora do escopo de pré-vendas
- Mailing em massa (DataFour-style) — o foco é dossiê individual

## Resumo visual das mudanças

```text
DOSSIÊ ATUAL                    DOSSIÊ ENRIQUECIDO
─────────────                   ──────────────────
Empresa (Receita)               Empresa (Receita)
Sócio Principal                 Sócio Principal + Flag PEP
Mapeamento Sócios               Mapeamento Sócios + PEP
Fontes Externas (4)             Fontes Externas (7)
                                + Protestos/Negativações
                                + Vagas/Crescimento  
                                + Tech Stack
                                Contatos p/ Abordagem
                                Sinais de Crescimento
                                Risco Financeiro
Insights Estratégicos           Insights Estratégicos
Recomendação Group              Recomendação Group
Score (6 dimensões, 100pts)     Score (9 dimensões, 130pts)
```

