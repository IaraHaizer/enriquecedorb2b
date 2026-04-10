import { useState } from "react";
import { DossierForm } from "@/components/DossierForm";
import { DossierDisplay } from "@/components/DossierDisplay";
import { DossierHistory } from "@/components/DossierHistory";
import { toast } from "sonner";
import { generateDossier, type Dossier, type DataSources, type LeadScore, type InputType } from "@/lib/dossier-api";
import { Crosshair, RotateCcw, LogOut, RefreshCw, Search, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppNavLink } from "@/components/AppNavLink";
import { useAuth } from "@/hooks/useAuth";

export default function Index() {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [dataSources, setDataSources] = useState<DataSources | null>(null);
  const [leadScore, setLeadScore] = useState<LeadScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastInput, setLastInput] = useState<{ input: string; inputType: InputType } | null>(null);
  
  const { signOut } = useAuth();

  const handleSubmit = async (input: string, inputType: InputType, skipCache = false) => {
    setIsLoading(true);
    setDossier(null);
    setDataSources(null);
    setLeadScore(null);

    try {
      const result = await generateDossier(input, inputType, skipCache);
      setDossier(result.dossier);
      setDataSources(result.data_sources);
      setLeadScore(result.lead_score || null);
      setLastInput({ input, inputType });
      setRefreshKey((k) => k + 1);
      toast.success(skipCache ? "Dossiê atualizado com dados frescos!" : `Dossiê gerado com sucesso! Lead: ${input}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao gerar dossiê. Tente novamente");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForceRefresh = () => {
    if (lastInput) {
      handleSubmit(lastInput.input, lastInput.inputType, true);
    }
  };

  const handleSelectFromHistory = (d: Dossier) => {
    setDossier(d);
    setDataSources(null);
    setLeadScore(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNewSearch = () => {
    setDossier(null);
    setDataSources(null);
    setLeadScore(null);
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
            {dossier && !isLoading && (
              <>
                <Button variant="ghost" size="sm" onClick={handleForceRefresh} className="text-muted-foreground" disabled={!lastInput}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Atualizar Dados
                </Button>
                <Button variant="ghost" size="sm" onClick={handleNewSearch} className="text-muted-foreground">
                  <RotateCcw className="h-4 w-4 mr-1" /> Nova Pesquisa
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-12">
        <div className="grid lg:grid-cols-[1fr_320px] gap-8">
          <div>
            {!dossier && !isLoading && (
              <div className="text-center mb-10">
                <h2 className="text-3xl font-heading font-bold mb-3">Dossiê Estratégico de Leads</h2>
                <p className="text-muted-foreground max-w-lg mx-auto">
                  Insira um CNPJ, e-mail ou nome para gerar um dossiê completo com insights
                  de pré-vendas focados em Administradoras de Condomínios e Imobiliárias.
                </p>
              </div>
            )}

            {!dossier && <DossierForm onSubmit={handleSubmit} isLoading={isLoading} />}

            {isLoading && (
              <div className="text-center mt-16 space-y-4">
                <div className="h-12 w-12 mx-auto border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <div>
                  <p className="font-heading font-medium">Analisando lead...</p>
                  <p className="text-sm text-muted-foreground">Isso pode levar alguns segundos</p>
                </div>
              </div>
            )}

            {dossier && <DossierDisplay dossier={dossier} dataSources={dataSources} leadScore={leadScore} />}
          </div>

          <aside className="order-first lg:order-last">
            <DossierHistory onSelect={handleSelectFromHistory} refreshKey={refreshKey} />
          </aside>
        </div>
      </main>
    </div>
  );
}
