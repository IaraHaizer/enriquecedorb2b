# Documentação de Produto - Intel B2B

## Visão Geral
O **Intel B2B** (Enriquecedor de Leads Estratégico) é uma ferramenta interna desenvolvida para as equipes de vendas da **Group Software** e **PartnerBank**. O objetivo principal é transformar dados brutos de prospecção (como um simples e-mail ou nome de sócio) em dossiês de inteligência comercial altamente detalhados e prontos para ação.

---

## Funcionalidades Principais

### 1. Enriquecimento de Dados Multicanal
A ferramenta utiliza uma técnica de "Busca em Cascata":
- **Entrada por Nome**: Identifica o perfil no LinkedIn -> Extrai a empresa -> Localiza o CNPJ -> Gera o dossiê.
- **Entrada por E-mail**: Identifica o domínio -> Localiza a empresa e o CNPJ associado.
- **Entrada por CNPJ**: Consulta direta à base da Receita Federal (via BrasilAPI).

### 2. Enriquecimento Premium (Contatos e Regional)
Expandimos a capacidade de inteligência com fontes líderes de mercado:
- **Inteligência de Contatos (Apollo.io)**: Vai além do LinkedIn, extraindo e-mails corporativos validados e cargos precisos. Isso garante que o SDR fale com a pessoa certa, reduzindo o *bounce rate* de e-mails.
- **Inteligência Regional (IBGE)**: Coleta dados de PIB e População do município do lead. Isso permite à IA sugerir tickets médios e argumentos baseados no poder aquisitivo da região (essencial para administradoras de condomínios).

### 2. Dossiê Estratégico (IA)
Utilizando inteligência artificial avançada (Gemini), o sistema consolida dados de múltiplas fontes para gerar:
- **Resumo da Empresa**: Porte, capital social, situação cadastral e histórico.
- **Mapeamento de Sócios**: Perfis, cargos e identificação de PEP (Pessoa Exposta Politicamente).
- **Insights de Mercado**: Contexto regional, presença digital e tecnologia atual (ERP/Software usado).
- **Argumentos de Venda**: Ganchos personalizados e recomendações de produtos específicos da Group Software ou PartnerBank baseados nas "dores" do lead.

### 3. Sistema de Lead Scoring (V2)
Cada lead é avaliado automaticamente com uma pontuação de **0 a 130**, dividida em 9 categorias:

| Categoria | Pontos Máx. | Critério de Avaliação |
| :--- | :---: | :--- |
| **Dados Cadastrais** | 20 | Validação do CNPJ e situação ativa na Receita Federal. |
| **Maturidade** | 15 | Tempo de mercado (anos de fundação) e Capital Social. |
| **Estrutura Societária** | 10 | Quantidade e relevância dos sócios mapeados. |
| **Presença Digital** | 15 | Domínios registrados, perfis em redes sociais e LinkedIn. |
| **Reputação / Riscos** | 15 | Histórico no Reclame Aqui, processos judiciais e notícias. |
| **Camada de Validação** | 10 | Domínios validados via WHOIS/CNPJ e contatos verificados via Apollo. |
| **Cobertura de Dados** | 10 | Volume de informações encontradas em fontes externas. |
| **Saúde Financeira** | 10 | Nível de risco financeiro (protestos e negativações). |
| **Fit Tecnológico** | 10 | Uso de ERPs concorrentes (oportunidade de migração) ou "Greenfield". |
| **Sinais de Crescimento** | 10 | Vagas abertas, expansão física ou novos empreendimentos. |

#### Classificação de Temperatura:
- ❄️ **Frio**: < 35%
- 🌡️ **Morno**: 35% - 54%
- 🔥 **Quente**: 55% - 74%
- 💥 **Muito Quente**: ≥ 75%

### 4. Histórico e Ranking
O sistema mantém um registro permanente de todas as buscas realizadas, permitindo filtrar e identificar os melhores leads prospeccionados ao longo do tempo.

---

## Valor de Negócio
- **Redução de SDR/BDR Manual**: Economia de horas de pesquisa manual em LinkedIn e sites de consulta.
- **Personalização de Abordagem**: Aumenta a taxa de conversão ao fornecer ganchos de venda precisos.
- **Qualificação Rápida**: Identifica leads com alto "Fit Tecnológico" e "Saúde Financeira" antes mesmo do primeiro contato.
