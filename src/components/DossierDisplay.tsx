import {
  Building2, UserCircle, Users, Target, Lightbulb, ShieldAlert,
  MapPin, Phone, Globe, Award, Briefcase, GraduationCap, Linkedin,
  MessageSquare, AlertTriangle, Package, Database, Sparkles,
  Search, Scale, Newspaper, ExternalLink, TrendingUp, ChevronDown, ChevronUp
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import type { Dossier, DataSources, LeadScore } from "@/lib/dossier-api";
import { useState } from "react";

interface DossierDisplayProps {
  dossier: Dossier;
  dataSources?: DataSources | null;
  leadScore?: LeadScore | null;
}

function SourceBadge({ source }: { source: "receita" | "ia" | "firecrawl" | "reclame_aqui" | "jusbrasil" | "linkedin" | "noticias" }) {
  const configs: Record<string, { bg: string; text: string; border: string; icon: typeof Database; label: string }> = {
    receita: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", icon: Database, label: "Receita Federal" },
    ia: { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/30", icon: Sparkles, label: "Análise IA" },
    firecrawl: { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30", icon: Search, label: "Firecrawl" },
    reclame_aqui: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30", icon: MessageSquare, label: "Reclame Aqui" },
    jusbrasil: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30", icon: Scale, label: "JusBrasil" },
    linkedin: { bg: "bg-sky-500/15", text: "text-sky-400", border: "border-sky-500/30", icon: Linkedin, label: "LinkedIn" },
    noticias: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30", icon: Newspaper, label: "Notícias" },
  };
  const c = configs[source] || configs.ia;
  const Icon = c.icon;
  return (
    <Badge className={`${c.bg} ${c.text} ${c.border} text-[10px] px-1.5 py-0 font-normal gap-1`}>
      <Icon className="h-2.5 w-2.5" />
      {c.label}
    </Badge>
  );
}

function SectionCard({
  icon: Icon, title, children, accent = false, source,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
  accent?: boolean;
  source?: "receita" | "ia" | "mixed";
}) {
  return (
    <Card className={`border-border/50 ${accent ? "border-l-4 border-l-accent" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg font-heading">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
          {source && (
            source === "mixed" ? (
              <div className="flex gap-1.5"><SourceBadge source="receita" /><SourceBadge source="ia" /></div>
            ) : <SourceBadge source={source} />
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InfoRow({ label, value, icon: Icon, source }: { label: string; value: string; icon?: typeof MapPin; source?: "receita" | "ia" }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
          {source && <SourceBadge source={source} />}
        </div>
        <p className="text-sm mt-0.5">{value || "Não identificado"}</p>
      </div>
    </div>
  );
}

function getFieldSource(fieldName: string, dataSources: DataSources | null | undefined): "receita" | "ia" | undefined {
  if (!dataSources) return undefined;
  if (dataSources.campos_receita.includes(fieldName)) return "receita";
  if (dataSources.campos_ia.includes(fieldName)) return "ia";
  return undefined;
}

function getSectionSource(sectionFields: string[], dataSources: DataSources | null | undefined): "receita" | "ia" | "mixed" | undefined {
  if (!dataSources) return undefined;
  const hasReceita = sectionFields.some(f => dataSources.campos_receita.includes(f));
  const hasIA = sectionFields.some(f => dataSources.campos_ia.includes(f));
  if (hasReceita && hasIA) return "mixed";
  if (hasReceita) return "receita";
  if (hasIA) return "ia";
  return undefined;
}

function FonteExternaCard({ title, icon: Icon, fonte, badgeSource }: {
  title: string;
  icon: typeof MessageSquare;
  fonte?: { encontrado: boolean; resumo: string; url?: string; urls?: string[] };
  badgeSource: "reclame_aqui" | "jusbrasil" | "linkedin" | "noticias";
}) {
  if (!fonte || !fonte.encontrado) return null;
  const urls = fonte.urls || (fonte.url ? [fonte.url] : []);

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <SourceBadge source={badgeSource} />
      </div>
      <p className="text-sm text-muted-foreground">{fonte.resumo}</p>
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.slice(0, 3).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> Fonte {urls.length > 1 ? i + 1 : ""}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadScoreWidget({ score }: { score: LeadScore }) {
  const [expanded, setExpanded] = useState(false);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score.percentual / 100) * circumference;

  return (
    <Card className="border-border/50 border-l-4" style={{ borderLeftColor: score.cor }}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg font-heading">
          <TrendingUp className="h-5 w-5 text-primary" />
          Score de Qualificação
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          {/* Circular gauge */}
          <div className="relative shrink-0">
            <svg width="128" height="128" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
              <circle
                cx="64" cy="64" r={radius} fill="none"
                stroke={score.cor} strokeWidth="8" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={offset}
                transform="rotate(-90 64 64)"
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold" style={{ color: score.cor }}>{score.total}</span>
              <span className="text-[10px] text-muted-foreground">/ {score.max}</span>
            </div>
          </div>

          <div className="flex-1 space-y-2">
            <div>
              <Badge className="text-sm px-3 py-1" style={{ backgroundColor: score.cor + "22", color: score.cor, borderColor: score.cor + "44" }}>
                {score.classificacao}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {score.classificacao === "Muito Quente" && "Lead altamente qualificado — prioridade máxima para abordagem."}
              {score.classificacao === "Quente" && "Bom potencial de conversão — agendar contato em breve."}
              {score.classificacao === "Morno" && "Potencial moderado — qualificar melhor antes de abordar."}
              {score.classificacao === "Frio" && "Dados insuficientes ou baixo potencial — monitorar."}
            </p>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Ocultar detalhes" : "Ver detalhes"}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3">
            <Separator />
            {score.breakdown.map((b, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{b.categoria}</span>
                  <span className="text-muted-foreground">{b.pontos}/{b.max}</span>
                </div>
                <Progress value={(b.pontos / b.max) * 100} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground">{b.detalhe}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DossierDisplay({ dossier, dataSources, leadScore }: DossierDisplayProps) {
  const empresa = dossier.empresa || {} as Dossier["empresa"];
  const socio_principal = dossier.socio_principal || {} as Dossier["socio_principal"];
  const mapeamento_socios = dossier.mapeamento_socios || [];
  const fontes_externas = dossier.fontes_externas;
  const insights_estrategicos = dossier.insights_estrategicos || {} as Dossier["insights_estrategicos"];
  const logica_group_software = dossier.logica_group_software || {} as Dossier["logica_group_software"];

  const empresaSource = getSectionSource(
    ["nome", "cnpj", "situacao", "abertura", "porte", "capital_social", "endereco", "telefone", "atividade_principal", "redes_sociais", "reputacao"],
    dataSources
  );
  const socioSource = getSectionSource(
    ["formacao_academica", "historico_profissional", "linkedin", "background_provavel"],
    dataSources
  );
  const sociosMapSource = dataSources?.campos_receita.includes("mapeamento_socios") ? "receita" as const : dataSources ? "ia" as const : undefined;

  const hasExternalSources = dataSources?.fontes_externas && dataSources.fontes_externas.length > 0;
  const hasFonteExternaData = fontes_externas && (
    fontes_externas.reclame_aqui?.encontrado ||
    fontes_externas.processos_judiciais?.encontrado ||
    fontes_externas.linkedin?.encontrado ||
    fontes_externas.noticias?.encontrado
  );

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 mt-8">
      {/* Data source legend */}
      {dataSources && (
        <Card className="border-border/50 bg-card/50">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
              <span className="font-medium">Fontes dos dados:</span>
              <div className="flex items-center gap-1.5">
                <SourceBadge source="receita" />
                <span>Receita Federal (BrasilAPI)</span>
              </div>
              {hasExternalSources && (
                <>
                  {dataSources.fontes_externas!.includes("reclame_aqui") && (
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source="reclame_aqui" />
                      <span>Firecrawl Search</span>
                    </div>
                  )}
                  {dataSources.fontes_externas!.includes("jusbrasil_escavador") && (
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source="jusbrasil" />
                      <span>Firecrawl Search</span>
                    </div>
                  )}
                  {dataSources.fontes_externas!.includes("linkedin") && (
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source="linkedin" />
                      <span>Firecrawl Search</span>
                    </div>
                  )}
                  {dataSources.fontes_externas!.includes("google_news") && (
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source="noticias" />
                      <span>Firecrawl Search</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex items-center gap-1.5">
                <SourceBadge source="ia" />
                <span>Análise e enriquecimento por IA</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-heading font-bold">{empresa.nome || "Empresa"}</h2>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {empresa.cnpj && <Badge variant="outline">{empresa.cnpj}</Badge>}
          {empresa.situacao && (
            <Badge className={empresa.situacao.toLowerCase().includes("ativa") ? "bg-accent text-accent-foreground" : "bg-destructive text-destructive-foreground"}>
              {empresa.situacao}
            </Badge>
          )}
          {empresa.porte && <Badge variant="secondary">{empresa.porte}</Badge>}
        </div>
      </div>

      {/* Lead Score */}
      {leadScore && <LeadScoreWidget score={leadScore} />}

      {/* Dados da Empresa */}
      <SectionCard icon={Building2} title="Dados da Empresa" source={empresaSource}>
        <div className="grid md:grid-cols-2 gap-x-8">
          <InfoRow label="Atividade Principal" value={empresa.atividade_principal} icon={Briefcase} source={getFieldSource("atividade_principal", dataSources)} />
          <InfoRow label="Abertura / Tempo" value={empresa.abertura} icon={Award} source={getFieldSource("abertura", dataSources)} />
          <InfoRow label="Capital Social" value={empresa.capital_social} icon={Award} source={getFieldSource("capital_social", dataSources)} />
          <InfoRow label="Endereço" value={empresa.endereco} icon={MapPin} source={getFieldSource("endereco", dataSources)} />
          <InfoRow label="Telefone" value={empresa.telefone} icon={Phone} source={getFieldSource("telefone", dataSources)} />
          <InfoRow label="Redes Sociais" value={empresa.redes_sociais} icon={Globe} source={getFieldSource("redes_sociais", dataSources)} />
          <InfoRow label="Reputação" value={empresa.reputacao} icon={Award} source={getFieldSource("reputacao", dataSources)} />
        </div>
      </SectionCard>

      {/* Fontes Externas */}
      {hasFonteExternaData && (
        <SectionCard icon={Search} title="Inteligência de Fontes Externas" accent>
          <div className="grid md:grid-cols-2 gap-4">
            <FonteExternaCard title="Reclame Aqui" icon={MessageSquare} fonte={fontes_externas?.reclame_aqui} badgeSource="reclame_aqui" />
            <FonteExternaCard title="Processos Judiciais" icon={Scale} fonte={fontes_externas?.processos_judiciais} badgeSource="jusbrasil" />
            <FonteExternaCard title="LinkedIn" icon={Linkedin} fonte={fontes_externas?.linkedin} badgeSource="linkedin" />
            <FonteExternaCard title="Notícias Recentes" icon={Newspaper} fonte={fontes_externas?.noticias} badgeSource="noticias" />
          </div>
        </SectionCard>
      )}

      {/* Sócio Principal */}
      <SectionCard icon={UserCircle} title="Perfil do Sócio Principal" accent source={socioSource}>
        <div className="grid md:grid-cols-2 gap-x-8">
          <InfoRow label="Nome" value={socio_principal.nome} icon={UserCircle} source={getFieldSource("nome", dataSources)} />
          <InfoRow label="Cargo" value={socio_principal.cargo} icon={Briefcase} source={getFieldSource("nome", dataSources)} />
          <InfoRow label="Formação Acadêmica" value={socio_principal.formacao_academica} icon={GraduationCap} source={getFieldSource("formacao_academica", dataSources)} />
          <InfoRow label="Background Provável" value={socio_principal.background_provavel} icon={Target} source={getFieldSource("background_provavel", dataSources)} />
          <InfoRow label="LinkedIn" value={socio_principal.linkedin} icon={Linkedin} source={getFieldSource("linkedin", dataSources)} />
        </div>
        {socio_principal.historico_profissional && (
          <>
            <Separator className="my-3" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Histórico Profissional</span>
                {getFieldSource("historico_profissional", dataSources) && <SourceBadge source={getFieldSource("historico_profissional", dataSources)!} />}
              </div>
              <p className="text-sm mt-1">{socio_principal.historico_profissional}</p>
            </div>
          </>
        )}
      </SectionCard>

      {/* Mapeamento de Sócios */}
      {mapeamento_socios.length > 0 && (
        <SectionCard icon={Users} title="Mapeamento de Sócios" source={sociosMapSource}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Background Provável</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mapeamento_socios.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{s.nome}</TableCell>
                  <TableCell>{s.cargo}</TableCell>
                  <TableCell><Badge variant="outline">{s.background_provavel}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      {/* Insights Estratégicos */}
      <SectionCard icon={Lightbulb} title="Insights Estratégicos para Pré-Vendas" accent source={dataSources ? "ia" : undefined}>
        <div className="space-y-4">
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Target className="h-3 w-3" /> Janela de Oportunidade
            </span>
            <p className="text-sm mt-1">{insights_estrategicos.janela_oportunidade}</p>
          </div>
          <Separator />
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Canal Ideal
              </span>
              <p className="text-sm mt-1 font-medium">{insights_estrategicos.abordagem_personalizada?.canal_ideal}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Tom de Voz</span>
              <p className="text-sm mt-1 font-medium">{insights_estrategicos.abordagem_personalizada?.tom_de_voz}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Argumento Central</span>
              <p className="text-sm mt-1 font-medium">{insights_estrategicos.abordagem_personalizada?.argumento_central}</p>
            </div>
          </div>
          <Separator />
          {(insights_estrategicos.ressonancia_por_perfil?.length ?? 0) > 0 && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Ressonância por Perfil</span>
              <div className="space-y-2">
                {insights_estrategicos.ressonancia_por_perfil.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 bg-secondary/50 rounded-md p-3">
                    <UserCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <span className="text-sm font-medium">{r.socio}</span>
                      <p className="text-sm text-muted-foreground">{r.ponto_de_dor}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Separator />
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> O que Evitar
            </span>
            <p className="text-sm mt-1 text-destructive/80">{insights_estrategicos.o_que_evitar}</p>
          </div>
        </div>
      </SectionCard>

      {/* Lógica Group Software */}
      <SectionCard icon={ShieldAlert} title="Recomendação Group Software" accent source={dataSources ? "ia" : undefined}>
        <div className="space-y-4">
          {/* Análise de Fit */}
          {(logica_group_software as any).analise_fit && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Análise de Fit</span>
              <p className="text-sm mt-1">{(logica_group_software as any).analise_fit}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Recomendação Principal</span>
            <p className="text-sm mt-1 font-medium">{logica_group_software.recomendacao_principal}</p>
          </div>
          {/* Módulos Sugeridos (new field) */}
          {((logica_group_software as any).modulos_sugeridos?.length ?? 0) > 0 && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Módulos Sugeridos</span>
              <div className="flex flex-wrap gap-2">
                {(logica_group_software as any).modulos_sugeridos.map((m: string, i: number) => (
                  <Badge key={i} className="bg-primary/10 text-primary border-primary/20">
                    <Package className="h-3 w-3 mr-1" />{m}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {/* Fallback: Produtos Sugeridos (backward compat) */}
          {!((logica_group_software as any).modulos_sugeridos?.length) && (logica_group_software.produtos_sugeridos?.length ?? 0) > 0 && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Produtos Sugeridos</span>
              <div className="flex flex-wrap gap-2">
                {logica_group_software.produtos_sugeridos.map((p, i) => (
                  <Badge key={i} className="bg-primary/10 text-primary border-primary/20">
                    <Package className="h-3 w-3 mr-1" />{p}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {/* Gancho de Venda */}
          {(logica_group_software as any).gancho_venda && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                💡 Gancho de Venda (Pitch)
              </span>
              <p className="text-sm mt-1 font-medium italic text-primary">"{(logica_group_software as any).gancho_venda}"</p>
            </div>
          )}
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Justificativa</span>
            <p className="text-sm mt-1">{logica_group_software.justificativa}</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
