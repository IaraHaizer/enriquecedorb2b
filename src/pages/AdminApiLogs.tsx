import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, Filter, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type ApiName = "gemini" | "google_places" | "firecrawl" | "brasilapi" | "seekloc";

interface LogRow {
  id: string;
  created_at: string;
  api_name: ApiName;
  cost_usd: number;
  credits_used: number;
  user_id: string | null;
  details: any;
}

interface StatRow {
  month: string;
  api_name: ApiName;
  total_calls: number;
  total_credits: number;
  total_cost_usd: number;
}

const API_OPTIONS: { value: ApiName | "all"; label: string }[] = [
  { value: "all", label: "Todas as APIs" },
  { value: "gemini", label: "Gemini" },
  { value: "google_places", label: "Google Places" },
  { value: "firecrawl", label: "Firecrawl" },
  { value: "brasilapi", label: "BrasilAPI" },
  { value: "seekloc", label: "Seekloc" },
];

export default function AdminApiLogs() {
  const { role } = useAuth();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiFilter, setApiFilter] = useState<ApiName | "all">("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [limit, setLimit] = useState<number>(200);

  const fetchData = async () => {
    setLoading(true);
    let q = supabase
      .from("api_usage_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (apiFilter !== "all") q = q.eq("api_name", apiFilter);
    if (from) q = q.gte("created_at", new Date(from).toISOString());
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      q = q.lte("created_at", end.toISOString());
    }

    const [{ data: logData, error: logErr }, { data: statData, error: statErr }] = await Promise.all([
      q,
      supabase.from("vw_api_usage_stats").select("*").order("month", { ascending: false }),
    ]);

    if (logErr) toast.error("Erro ao carregar logs: " + logErr.message);
    if (statErr) toast.error("Erro ao carregar estatísticas: " + statErr.message);

    setLogs((logData as LogRow[]) || []);
    setStats((statData as StatRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    return logs.reduce(
      (acc, l) => {
        acc.cost += Number(l.cost_usd || 0);
        acc.credits += Number(l.credits_used || 0);
        acc.calls += 1;
        return acc;
      },
      { cost: 0, credits: 0, calls: 0 }
    );
  }, [logs]);

  const statsByApi = useMemo(() => {
    const agg: Record<string, { calls: number; cost: number; credits: number }> = {};
    for (const s of stats) {
      if (!agg[s.api_name]) agg[s.api_name] = { calls: 0, cost: 0, credits: 0 };
      agg[s.api_name].calls += Number(s.total_calls);
      agg[s.api_name].cost += Number(s.total_cost_usd);
      agg[s.api_name].credits += Number(s.total_credits);
    }
    return agg;
  }, [stats]);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <AppHeader />
      <div className="p-6 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Activity className="h-7 w-7 text-primary" />
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Logs de Uso de APIs</h1>
                <p className="text-sm text-muted-foreground">
                  {role === "admin"
                    ? "Visão global · Admin"
                    : "Mostrando apenas seus próprios registros"}
                </p>
              </div>
            </div>
            <Button onClick={fetchData} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>

          {/* Painel agregado vw_api_usage_stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.entries(statsByApi).map(([api, d]) => (
              <Card key={api} className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm capitalize">{api.replace("_", " ")}</CardTitle>
                  <CardDescription className="text-xs">Acumulado</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">${d.cost.toFixed(4)}</div>
                  <p className="text-xs text-muted-foreground">{d.calls} chamadas</p>
                  <p className="text-xs text-muted-foreground">{d.credits.toFixed(0)} créditos</p>
                </CardContent>
              </Card>
            ))}
            {Object.keys(statsByApi).length === 0 && (
              <Card className="col-span-full bg-card">
                <CardContent className="py-6 text-sm text-muted-foreground">
                  Nenhum dado agregado disponível ainda.
                </CardContent>
              </Card>
            )}
          </div>

          {/* Filtros */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" /> Filtros
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="text-xs text-muted-foreground">API</label>
                  <Select value={apiFilter} onValueChange={(v) => setApiFilter(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {API_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">De</label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Até</label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Limite</label>
                  <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[50, 100, 200, 500, 1000].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={fetchData} disabled={loading}>
                  Aplicar filtros
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Totais da consulta filtrada */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Registros exibidos</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totals.calls}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Custo total (USD)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totals.cost.toFixed(4)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Créditos consumidos</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totals.credits.toFixed(0)}</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela de logs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Logs detalhados</CardTitle>
              <CardDescription>
                Ordenados do mais recente para o mais antigo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>API</TableHead>
                      <TableHead className="text-right">Custo (USD)</TableHead>
                      <TableHead className="text-right">Créditos</TableHead>
                      {role === "admin" && <TableHead>Usuário</TableHead>}
                      <TableHead>Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          Carregando...
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading && logs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          Nenhum registro encontrado.
                        </TableCell>
                      </TableRow>
                    )}
                    {logs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {new Date(l.created_at).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize">
                            {l.api_name.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${Number(l.cost_usd).toFixed(6)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(l.credits_used).toFixed(0)}
                        </TableCell>
                        {role === "admin" && (
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {l.user_id ? l.user_id.slice(0, 8) : "—"}
                          </TableCell>
                        )}
                        <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate">
                          {l.details ? JSON.stringify(l.details) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
