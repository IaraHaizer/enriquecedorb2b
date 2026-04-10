import { useState } from "react";
import { DossierForm } from "@/components/DossierForm";
import { DossierDisplay } from "@/components/DossierDisplay";
import { useToast } from "@/hooks/use-toast";
import { generateDossier, type Dossier, type InputType } from "@/lib/dossier-api";
import { Crosshair, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Index() {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (input: string, inputType: InputType) => {
    setIsLoading(true);
    setDossier(null);

    try {
      const result = await generateDossier(input, inputType);
      setDossier(result);
      toast({ title: "Dossiê gerado com sucesso!", description: `Lead: ${input}` });
    } catch (error) {
      toast({
        title: "Erro ao gerar dossiê",
        description: error instanceof Error ? error.message : "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Crosshair className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-heading font-bold tracking-tight">Intel B2B</h1>
              <p className="text-xs text-muted-foreground">Inteligência Comercial · Group Software</p>
            </div>
          </div>
          {dossier && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDossier(null)}
              className="text-muted-foreground"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Nova Pesquisa
            </Button>
          )}
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-12">
        {!dossier && !isLoading && (
          <div className="text-center mb-10">
            <h2 className="text-3xl font-heading font-bold mb-3">
              Dossiê Estratégico de Leads
            </h2>
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

        {dossier && <DossierDisplay dossier={dossier} />}
      </main>
    </div>
  );
}
