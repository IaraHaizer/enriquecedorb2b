import {
  Building2, UserCircle, Users, Target, Lightbulb, ShieldAlert,
  MapPin, Phone, Globe, Award, Briefcase, GraduationCap, Linkedin,
  MessageSquare, AlertTriangle, Package, Database, Sparkles
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Dossier, DataSources } from "@/lib/dossier-api";

interface DossierDisplayProps {
  dossier: Dossier;
  dataSources?: DataSources | null;
}

function SourceBadge({ source }: { source: "receita" | "ia" }) {
  if (source === "receita") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0 font-normal gap-1">
        <Database className="h-2.5 w-2.5" />
        Receita Federal
      </Badge>
    );
  }
  return (
    <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[10px] px-1.5 py-0 font-normal gap-1">
      <Sparkles className="h-2.5 w-2.5" />
      Análise IA
    </Badge>
  );
}

function SectionSourceBadge({ source }: { source: "receita" | "ia" | "mixed" }) {
  if (source === "mixed") {
    return (
      <div className="flex gap-1.5">
        <SourceBadge source="receita" />
        <SourceBadge source="ia" />
      </div>
    );
  }
  return <SourceBadge source={source} />;
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
          {source && <SectionSourceBadge source={source} />}
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

// Map field names to their data source
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

export function DossierDisplay({ dossier, dataSources }: DossierDisplayProps) {
  const empresa = dossier.empresa || {} as Dossier["empresa"];
  const socio_principal = dossier.socio_principal || {} as Dossier["socio_principal"];
  const mapeamento_socios = dossier.mapeamento_socios || [];
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
                <span>Dados oficiais da Receita Federal via BrasilAPI</span>
              </div>
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
                  <TableCell>
                    <Badge variant="outline">{s.background_provavel}</Badge>
                  </TableCell>
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
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                Ressonância por Perfil
              </span>
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
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Recomendação Principal</span>
            <p className="text-sm mt-1 font-medium">{logica_group_software.recomendacao_principal}</p>
          </div>

          {(logica_group_software.produtos_sugeridos?.length ?? 0) > 0 && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                Produtos Sugeridos
              </span>
              <div className="flex flex-wrap gap-2">
                {logica_group_software.produtos_sugeridos.map((p, i) => (
                  <Badge key={i} className="bg-primary/10 text-primary border-primary/20">
                    <Package className="h-3 w-3 mr-1" />
                    {p}
                  </Badge>
                ))}
              </div>
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
