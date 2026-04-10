import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History, Building2, Mail, Hash, User, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchHistory, type DossierHistoryItem, type Dossier } from "@/lib/dossier-api";

const typeIcons: Record<string, typeof Mail> = {
  email: Mail,
  cnpj: Hash,
  nome: User,
};

interface DossierHistoryProps {
  onSelect: (dossier: Dossier) => void;
  refreshKey: number;
}

export function DossierHistory({ onSelect, refreshKey }: DossierHistoryProps) {
  const [items, setItems] = useState<DossierHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchHistory()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-heading">
            <History className="h-4 w-4 text-primary" /> Histórico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-secondary/50 rounded-md animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-heading">
            <History className="h-4 w-4 text-primary" /> Histórico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum dossiê gerado ainda
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-heading">
          <History className="h-4 w-4 text-primary" /> Histórico
          <Badge variant="secondary" className="ml-auto text-xs">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="px-6 pb-4 space-y-2">
            {items.map((item) => {
              const Icon = typeIcons[item.input_type] || User;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.dossier_data)}
                  className="w-full text-left rounded-md border border-border/50 p-3 hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {item.empresa_nome || item.input}
                        </p>
                        {item.empresa_cnpj && (
                          <p className="text-xs text-muted-foreground truncate">{item.empresa_cnpj}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(item.created_at), "dd MMM yyyy · HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <Eye className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
