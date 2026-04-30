import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DossierForm } from "@/components/DossierForm";
import { DossierDisplay } from "@/components/DossierDisplay";

import { toast } from "sonner";
import { generateDossier, type Dossier, type DataSources, type LeadScore, type InputType } from "@/lib/dossier-api";
import { Radar, RotateCcw, LogOut, RefreshCw, Search, BarChart3, History, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppNavLink } from "@/components/AppNavLink";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";

export default function Index() {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [dataSources, setDataSources] = useState<DataSources | null>(null);
  const [leadScore, setLeadScore] = useState<LeadScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastInput, setLastInput] = useState<{ input: string; inputType: InputType } | null>(null);
  
  const { signOut } = useAuth();
  const location = useLocation();

  // Handle navigation from ranking page
  useEffect(() => {
    if (location.state?.dossier) {
      setDossier(location.state.dossier);
      setDataSources(null);
      setLeadScore(null);
      window.history.replaceState({}, "");
    }
  }, [location.state]);
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


  const handleNewSearch = () => {
    setDossier(null);
    setDataSources(null);
    setLeadScore(null);
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <AppHeader>
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
      </AppHeader>

      <main className="container max-w-4xl mx-auto px-4 py-12">
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
      </main>
    </div>
  );
}
