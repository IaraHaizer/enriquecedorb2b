import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  History, Download, Search, Filter, Building2, Hash, Mail, User,
  Eye, LogOut, Crosshair, BarChart3, Calendar, X, Flame, Thermometer, Snowflake,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AppNavLink } from "@/components/AppNavLink";
import { useAuth } from "@/hooks/useAuth";
import { fetchHistory, type DossierHistoryItem, type Dossier } from "@/lib/dossier-api";
import { useNavigate } from "react-router-dom";

type TypeFilter = "all" | "cnpj" | "email" | "nome";
type DateFilter = "all" | "today" | "week" | "month";

const typeIcons: Record<string, typeof Mail> = { email: Mail, cnpj: Hash, nome: User };
const typeLabels: Record<string, string> = { cnpj: "CNPJ", email: "E-mail", nome: "Nome" };

function calcScore(d: Dossier): number {
  let score = 0;
  const e = d.empresa;
  if (e?.cnpj) score += 10;
  if (e?.situacao?.toLowerCase().includes("ativa")) score += 10;
  if (e?.abertura) {
    const y = new Date().getFullYear() - new Date(e.abertura.split("/").reverse().join("-")).getFullYear();
    score += Math.min(y >= 5 ? 10 : y >= 2 ? 6 : 3, 10);
  }
  if (e?.capital_social) {
    const v = parseFloat(e.capital_social.replace(/[^\d,]/g, "").replace(",", "."));
    score += v > 500000 ? 5 : v > 100000 ? 3 : 1;
  }
  if (d.socio_principal?.linkedin && d.socio_principal.linkedin !== "Não encontrado") score += 8;
  if (e?.redes_sociais && e.redes_sociais !== "Não informado") score += 7;
  if (d.mapeamento_socios?.length > 2) score += 10;
  else if (d.mapeamento_socios?.length > 0) score += 5;
  if (d.fontes_externas?.reclame_aqui?.encontrado) score += 5;
  if (d.fontes_externas?.processos_judiciais?.encontrado) score -= 5;
  if (d.fontes_externas?.linkedin?.encontrado) score += 5;
  if (d.fontes_externas?.noticias?.encontrado) score += 5;
  const fields = Object.values(e || {}).filter((v) => v && v !== "Não informado" && v !== "Não encontrado").length;
  score += Math.min(Math.floor(fields / 2), 10);
  return Math.max(0, Math.min(100, score));
}

function getClassificacao(s: number) {
  if (s >= 80) return { label: "Muito Quente", color: "text-red-400", bg: "bg-red-500/10", icon: Flame };
  if (s >= 60) return { label: "Quente", color: "text-orange-400", bg: "bg-orange-500/10", icon: Flame };
  if (s >= 40) return { label: "Morno", color: "text-yellow-400", bg: "bg-yellow-500/10", icon: Thermometer };
  return { label: "Frio", color: "text-blue-400", bg: "bg-blue-500/10", icon: Snowflake };
}

function exportCSV(rows: DossierHistoryItem[]) {
  const header = "Empresa,CNPJ,Tipo,Input,Score,Classificação,Data\n";
  const body = rows.map((r) => {
    const s = calcScore(r.dossier_data);
    const c = getClassificacao(s);
    return `"${r.empresa_nome || ""}","${r.empresa_cnpj || ""}","${typeLabels[r.input_type] || r.input_type}","${r.input}",${s},"${c.label}","${format(new Date(r.created_at), "dd/MM/yyyy HH:mm")}"`;
  }).join("\n");
  const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `historico_dossies_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Historico() {
  const [items, setItems] = useState<DossierHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchHistory().then(setItems).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) =>
        (i.empresa_nome || "").toLowerCase().includes(q) ||
        (i.empresa_cnpj || "").toLowerCase().includes(q) ||
        i.input.toLowerCase().includes(q)
      );
    }
    if (typeFilter !== "all") {
      list = list.filter((i) => i.input_type === typeFilter);
    }
    if (dateFilter !== "all") {
      const now = new Date();
      list = list.filter((i) => {
        const d = new Date(i.created_at);
        if (dateFilter === "today") return d.toDateString() === now.toDateString();
        if (dateFilter === "week") return now.getTime() - d.getTime() < 7 * 86400000;
        if (dateFilter === "month") return now.getTime() - d.getTime() < 30 * 86400000;
        return true;
      });
    }
    return list;
  }, [items, search, typeFilter, dateFilter]);

  const activeFilters = [typeFilter !== "all", dateFilter !== "all", search !== ""].filter(Boolean).length;

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setDateFilter("all");
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Crosshair className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-heading font-bold tracking-tight">Intel B2B</h1>
              <p className="text-xs text-muted-foreground">Inteligência Comercial · Group Software</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AppNavLink to="/" icon={Search} label="Pesquisa" />
            <AppNavLink to="/ranking" icon={BarChart3} label="Ranking" />
            <AppNavLink to="/historico" icon={History} label="Histórico" />
            <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
              <History className="h-6 w-6 text-primary" /> Histórico de Dossiês
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Todos os dossiês gerados com filtros avançados e exportação
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                <X className="h-4 w-4 mr-1" /> Limpar filtros
                <Badge variant="secondary" className="ml-1 text-xs">{activeFilters}</Badge>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => exportCSV(filtered)} disabled={filtered.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Exportar CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar empresa, CNPJ ou input..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card border-border/50"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
            <SelectTrigger className="w-full sm:w-44 bg-card border-border/50">
              <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="cnpj"># CNPJ</SelectItem>
              <SelectItem value="email">✉ E-mail</SelectItem>
              <SelectItem value="nome">👤 Nome</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="w-full sm:w-44 bg-card border-border/50">
              <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer data</SelectItem>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="week">Últimos 7 dias</SelectItem>
              <SelectItem value="month">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground">
          <span>{filtered.length} de {items.length} registros</span>
          {typeFilter !== "all" && <Badge variant="outline" className="text-xs">{typeLabels[typeFilter] || typeFilter}</Badge>}
          {dateFilter !== "all" && <Badge variant="outline" className="text-xs">{dateFilter === "today" ? "Hoje" : dateFilter === "week" ? "7 dias" : "30 dias"}</Badge>}
        </div>

        {/* Table */}
        <Card className="border-border/50">
          <ScrollArea className="h-[560px]">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="hidden md:table-cell">CNPJ</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead className="hidden sm:table-cell">Data</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-border/50">
                      <TableCell colSpan={7}><div className="h-10 bg-secondary/50 rounded animate-pulse" /></TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow className="border-border/50">
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      Nenhum dossiê encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((item, idx) => {
                    const Icon = typeIcons[item.input_type] || User;
                    const score = calcScore(item.dossier_data);
                    const cls = getClassificacao(score);
                    const ClsIcon = cls.icon;
                    return (
                      <TableRow
                        key={item.id}
                        className="border-border/50 cursor-pointer hover:bg-secondary/30 transition-colors"
                        onClick={() => navigate("/", { state: { dossier: item.dossier_data } })}
                      >
                        <TableCell className="text-center text-muted-foreground font-mono text-sm">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium text-sm truncate max-w-[200px]">
                              {item.empresa_nome || item.input}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground font-mono">
                          {item.empresa_cnpj || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            <Icon className="h-3 w-3 mr-1" />
                            {typeLabels[item.input_type] || item.input_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm font-bold ${cls.bg} ${cls.color}`}>
                              <ClsIcon className="h-3 w-3" />
                              {score}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(item.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell>
                          <Eye className="h-4 w-4 text-muted-foreground opacity-50 hover:opacity-100 transition-opacity" />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </Card>
      </main>
    </div>
  );
}
