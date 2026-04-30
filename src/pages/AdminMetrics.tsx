import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { LayoutDashboard } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";

export default function AdminMetrics() {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      const { data, error } = await supabase
        .from('vw_api_usage_stats')
        .select('*')
        .order('month', { ascending: false });

      if (data) {
        setStats(data);
      }
      setLoading(false);
    }
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="dark min-h-screen bg-background text-foreground">
        <AppHeader />
        <div className="p-8">Carregando métricas...</div>
      </div>
    );
  }

  // Agrupar por API para exibir os cards
  const summaryByApi = stats.reduce((acc, curr) => {
    if (!acc[curr.api_name]) {
      acc[curr.api_name] = { total_calls: 0, total_cost_usd: 0, total_credits: 0 };
    }
    acc[curr.api_name].total_calls += curr.total_calls;
    acc[curr.api_name].total_cost_usd += curr.total_cost_usd;
    acc[curr.api_name].total_credits += curr.total_credits;
    return acc;
  }, {});

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <AppHeader />
      <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Métricas de Consumo de APIs</h1>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {Object.entries(summaryByApi).map(([api, data]: [string, any]) => (
            <Card key={api} className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg capitalize">{api.replace('_', ' ')}</CardTitle>
                <CardDescription>Uso Total Acumulado</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${Number(data.total_cost_usd).toFixed(4)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.total_calls} requisições
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.total_credits} créditos/tokens
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Histórico por Mês</CardTitle>
          </CardHeader>
          <CardContent className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats}>
                <XAxis dataKey="month" tickFormatter={(val) => new Date(val).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric'})} />
                <YAxis />
                <Tooltip 
                  formatter={(value: number, name: string) => {
                    if (name === 'total_cost_usd') return [`$${value.toFixed(4)}`, 'Custo (USD)'];
                    if (name === 'total_calls') return [value, 'Requisições'];
                    return [value, name];
                  }}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric'})}
                />
                <Legend />
                <Bar dataKey="total_cost_usd" name="Custo USD" fill="#3b82f6" />
                <Bar dataKey="total_calls" name="Requisições" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
