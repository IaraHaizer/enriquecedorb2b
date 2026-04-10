import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Trophy, ArrowUpDown, ArrowUp, ArrowDown, Download, Search, Filter,
  Building2, Eye, LogOut, Crosshair, BarChart3, History,
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
import { fetchHistory, type DossierHistoryItem } from "@/lib/dossier-api";
import { calcScoreV2, getClassificacaoV2, SCORE_MAX } from "@/lib/lead-scoring";
import { useNavigate } from "react-router-dom";

type SortField = "score" | "empresa" | "data";
type SortDir = "asc" | "desc";
type ScoreFilter = "all" | "muito_quente" | "quente" | "morno" | "frio";

function exportCSV(rows: { empresa: string; cnpj: string; score: number; percentual: number; classificacao: string; input_type: string; data: string }[]) {
  const header = "Empresa,CNPJ,Score,Percentual,Classificação,Tipo,Data\n";
  const body = rows.map((r) =>
    `"${r.empresa}","${r.cnpj}",${r.score}/${SCORE_MAX},${r.percentual}%,"${r.classificacao}","${r.input_type}","${r.data}"`
  ).join("\n");
  const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads_ranking_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LeadRanking() {
  const [items, setItems] = useState<DossierHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchHistory().then(setItems).catch(console.error).finally(() => setLoading(false));
  }, []);

  const scored = useMemo(() =>
    items.map((item) => {
      const result = calcScoreV2(item.dossier_data);
      const c = getClassificacaoV2(result.percentual);
      return { ...item, score: result.total, percentual: result.percentual, classificacao: c.label, classInfo: c, breakdown: result.breakdown };
    }), [items]);

  const filtered = useMemo(() => {
    let list = scored;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) =>
        (i.empresa_nome || "").toLowerCase().includes(q) ||
        (i.empresa_cnpj || "").toLowerCase().includes(q) ||
        i.input.toLowerCase().includes(q)
      );
    }
    if (scoreFilter !== "all") {
      const map: Record<string, string> = { muito_quente: "Muito Quente", quente: "Quente", morno: "Morno", frio: "Frio" };
      list = list.filter((i) => i.classificacao === map[scoreFilter]);
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "score") cmp = a.score - b.score;
      else if (sortField === "empresa") cmp = (a.empresa_nome || "").localeCompare(b.empresa_nome || "");
      else cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [scored, search, scoreFilter, sortField, sortDir]);

  const stats = useMemo(() => {
    const total = scored.length;
    const mq = scored.filter((i) => i.classificacao === "Muito Quente").length;
    const q = scored.filter((i) => i.classificacao === "Quente").length;
    const m = scored.filter((i) => i.classificacao === "Morno").length;
    const f = scored.filter((i) => i.classificacao === "Frio").length;
    const avg = total ? Math.round(scored.reduce((s, i) => s + i.percentual, 0) / total) : 0;
    return { total, mq, q, m, f, avg };
  }, [scored]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "desc"
      ? <ArrowDown className="h-3 w-3 ml-1 text-primary" />
      : <ArrowUp className="h-3 w-3 ml-1 text-primary" />;
  };

  const handleExport = () => {
    exportCSV(filtered.map((i) => ({
      empresa: i.empresa_nome || i.input,
      cnpj: i.empresa_cnpj || "",
      score: i.score,
      percentual: i.percentual,
      classificacao: i.classificacao,
      input_type: i.input_type,
      data: format(new Date(i.created_at), "dd/MM/yyyy HH:mm"),
    })));
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
            <AppNavLink to="/ranking" icon={BarChart3} label="Ranking" active />
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
              <Trophy className="h-6 w-6 text-primary" /> Ranking de Leads
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Score V2 · 9 dimensões · {SCORE_MAX} pontos máximos</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          {[
            { label: "Total", value: stats.total, color: "text-foreground" },
            { label: "Muito Quente", value: stats.mq, color: "text-red-400" },
            { label: "Quente", value: stats.q, color: "text-orange-400" },
            { label: "Morno", value: stats.m, color: "text-yellow-400" },
            { label: "Frio", value: stats.f, color: "text-blue-400" },
            { label: "Média", value: `${stats.avg}%`, color: "text-primary" },
          ].map((s) => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-heading font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
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
          <Select value={scoreFilter} onValueChange={(v) => setScoreFilter(v as ScoreFilter)}>
            <SelectTrigger className="w-full sm:w-48 bg-card border-border/50">
              <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Classificação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="muito_quente">🔥 Muito Quente</SelectItem>
              <SelectItem value="quente">🟠 Quente</SelectItem>
              <SelectItem value="morno">🟡 Morno</SelectItem>
              <SelectItem value="frio">🔵 Frio</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card className="border-border/50">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("empresa")} className="flex items-center font-heading text-xs">
                      Empresa <SortIcon field="empresa" />
                    </button>
                  </TableHead>
                  <TableHead className="hidden md:table-cell">CNPJ</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("score")} className="flex items-center font-heading text-xs">
                      Score V2 <SortIcon field="score" />
                    </button>
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">Classificação</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("data")} className="flex items-center font-heading text-xs">
                      Data <SortIcon field="data" />
                    </button>
                  </TableHead>
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
                      Nenhum lead encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((item, idx) => {
                    const Icon = item.classInfo.icon;
                    return (
                      <TableRow
                        key={item.id}
                        className="border-border/50 cursor-pointer hover:bg-secondary/30 transition-colors"
                        onClick={() => navigate("/", { state: { dossier: item.dossier_data } })}
                      >
                        <TableCell className="text-center text-muted-foreground font-mono text-sm">
                          {idx + 1}
                        </TableCell>
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
                          <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-bold ${item.classInfo.bg} ${item.classInfo.color}`}>
                            {item.score}<span className="text-xs font-normal opacity-60">/{SCORE_MAX}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="outline" className={`${item.classInfo.color} border-current/20 text-xs`}>
                            <Icon className="h-3 w-3 mr-1" />
                            {item.classificacao}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
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

        <p className="text-xs text-muted-foreground text-center mt-4">
          Score médio: <span className="font-bold text-foreground">{stats.avg}%</span> · {filtered.length} de {scored.length} leads exibidos
        </p>
      </main>
    </div>
  );
}
