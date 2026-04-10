import {
  Building2, UserCircle, Users, Target, Lightbulb, ShieldAlert,
  MapPin, Phone, Globe, Award, Briefcase, GraduationCap, Linkedin,
  MessageSquare, AlertTriangle, Package
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Dossier } from "@/lib/dossier-api";

interface DossierDisplayProps {
  dossier: Dossier;
}

function SectionCard({
  icon: Icon, title, children, accent = false,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className={`border-border/50 ${accent ? "border-l-4 border-l-accent" : ""}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg font-heading">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof MapPin }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
        <p className="text-sm mt-0.5">{value || "Não identificado"}</p>
      </div>
    </div>
  );
}

export function DossierDisplay({ dossier }: DossierDisplayProps) {
  const { empresa, socio_principal, mapeamento_socios, insights_estrategicos, logica_group_software } = dossier;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 mt-8">
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
      <SectionCard icon={Building2} title="Dados da Empresa">
        <div className="grid md:grid-cols-2 gap-x-8">
          <InfoRow label="Atividade Principal" value={empresa.atividade_principal} icon={Briefcase} />
          <InfoRow label="Abertura / Tempo" value={empresa.abertura} icon={Award} />
          <InfoRow label="Capital Social" value={empresa.capital_social} icon={Award} />
          <InfoRow label="Endereço" value={empresa.endereco} icon={MapPin} />
          <InfoRow label="Telefone" value={empresa.telefone} icon={Phone} />
          <InfoRow label="Redes Sociais" value={empresa.redes_sociais} icon={Globe} />
          <InfoRow label="Reputação" value={empresa.reputacao} icon={Award} />
        </div>
      </SectionCard>

      {/* Sócio Principal */}
      <SectionCard icon={UserCircle} title="Perfil do Sócio Principal" accent>
        <div className="grid md:grid-cols-2 gap-x-8">
          <InfoRow label="Nome" value={socio_principal.nome} icon={UserCircle} />
          <InfoRow label="Cargo" value={socio_principal.cargo} icon={Briefcase} />
          <InfoRow label="Formação Acadêmica" value={socio_principal.formacao_academica} icon={GraduationCap} />
          <InfoRow label="Background Provável" value={socio_principal.background_provavel} icon={Target} />
          <InfoRow label="LinkedIn" value={socio_principal.linkedin} icon={Linkedin} />
        </div>
        {socio_principal.historico_profissional && (
          <>
            <Separator className="my-3" />
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Histórico Profissional</span>
              <p className="text-sm mt-1">{socio_principal.historico_profissional}</p>
            </div>
          </>
        )}
      </SectionCard>

      {/* Mapeamento de Sócios */}
      {mapeamento_socios.length > 0 && (
        <SectionCard icon={Users} title="Mapeamento de Sócios">
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
      <SectionCard icon={Lightbulb} title="Insights Estratégicos para Pré-Vendas" accent>
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
              <p className="text-sm mt-1 font-medium">{insights_estrategicos.abordagem_personalizada.canal_ideal}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Tom de Voz</span>
              <p className="text-sm mt-1 font-medium">{insights_estrategicos.abordagem_personalizada.tom_de_voz}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Argumento Central</span>
              <p className="text-sm mt-1 font-medium">{insights_estrategicos.abordagem_personalizada.argumento_central}</p>
            </div>
          </div>

          <Separator />

          {insights_estrategicos.ressonancia_por_perfil.length > 0 && (
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
      <SectionCard icon={ShieldAlert} title="Recomendação Group Software" accent>
        <div className="space-y-4">
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Recomendação Principal</span>
            <p className="text-sm mt-1 font-medium">{logica_group_software.recomendacao_principal}</p>
          </div>

          {logica_group_software.produtos_sugeridos.length > 0 && (
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
