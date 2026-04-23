
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { generateDossier, type DossierResult, type InputType } from "@/lib/dossier-api";
import { Upload, Play, Download, Trash2, CheckCircle2, XCircle, Loader2, ArrowLeft, Eye, Printer, FileText, ChevronRight, Radar } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DossierDisplay } from "@/components/DossierDisplay";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card as CardShadcn } from "@/components/ui/card";

interface BulkItem {
  input: string;
  type: InputType;
  status: "pending" | "processing" | "completed" | "error";
  result?: DossierResult;
  error?: string;
}

export default function BulkProcess() {
  const [items, setItems] = useState<BulkItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedResult, setSelectedResult] = useState<DossierResult | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [printMode, setPrintMode] = useState<"estrategico" | "completo">("estrategico");
  const [processMode, setProcessMode] = useState<"complete" | "fast">("fast");
  const navigate = useNavigate();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      
      const newItems: BulkItem[] = lines.map(line => {
        const value = line.trim();
        let type: InputType = "nome";
        if (value.includes("@")) type = "email";
        else if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(value) || /^\d{14}$/.test(value)) type = "cnpj";
        
        return { input: value, type, status: "pending" };
      });

      setItems(newItems);
      toast.success(`${newItems.length} leads carregados.`);
    };
    reader.readAsText(file);
  };

  const startProcessing = async () => {
    if (items.length === 0) return;
    setIsProcessing(true);
    let completedCount = 0;

    for (let i = 0; i < items.length; i++) {
        // Stop if not processing anymore
        if (!isProcessing && i > 0) break; 

        const item = items[i];
        if (item.status === "completed") {
            completedCount++;
            continue;
        }

        setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "processing" } : it));

        try {
            const result = await generateDossier(item.input, item.type, false, processMode);
            setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "completed", result } : it));
        } catch (error) {
            setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "error", error: error instanceof Error ? error.message : "Erro desconhecido" } : it));
        }

        completedCount++;
        setProgress(Math.round((completedCount / items.length) * 100));
        
        // Anti-rate limit delay
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setIsProcessing(false);
    toast.success("Processamento em massa concluído.");
  };

  const startMassDownload = () => {
    const completedItems = items.filter(i => i.status === "completed" && i.result);
    if (completedItems.length === 0) {
      toast.error("Nenhum dossiê pronto para download.");
      return;
    }
    setIsPrintDialogOpen(true);
  };

  const confirmMassPrint = () => {
    setIsPrintDialogOpen(false);
    // Give time for the modal to close and the print layout to be ready
    setTimeout(() => {
        window.print();
    }, 500);
  };

  const exportResults = () => {
    const completedItems = items.filter(i => i.status === "completed" && i.result);
    if (completedItems.length === 0) {
      toast.error("Nenhum item concluído para exportar.");
      return;
    }

    const headers = ["Input", "Tipo", "Empresa", "CNPJ", "Score", "Classificação", "Telefone", "WhatsApp/Contatos"];
    const rows = completedItems.map(item => {
      const d = item.result!.dossier;
      const s = item.result!.lead_score;
      const contatos = d.contatos_abordagem?.map(c => `${c.canal}: ${c.contato}`).join(" | ") || "";
      
      return [
        item.input,
        item.type,
        d.empresa.nome || "N/I",
        d.empresa.cnpj || "N/I",
        s?.total || 0,
        s?.classificacao || "N/I",
        d.empresa.telefone || "N/I",
        contatos
      ].map(v => `"${v}"`).join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `radar_massa_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearList = () => {
    setItems([]);
    setProgress(0);
    setIsProcessing(false);
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground pb-20">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10 no-print">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-heading font-bold tracking-tight">Consulta em Massa</h1>
              <p className="text-xs text-muted-foreground">Processamento inteligente de listas B2B</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="grid md:grid-cols-3 gap-6">
          <Card className="md:col-span-1 border-border/50 bg-card">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Configuração</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Formato CSV: Uma linha por lead (CNPJ, E-mail ou Nome)</p>
                <div className="relative">
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={isProcessing}
                  />
                  <Button variant="outline" className="w-full gap-2">
                    <Upload className="h-4 w-4" /> Carregar Arquivo
                  </Button>
                </div>
              </div>
              <div className="pt-2 space-y-2">
                <Label className="text-xs text-muted-foreground">Profundidade da Busca:</Label>
                <RadioGroup defaultValue="fast" value={processMode} onValueChange={(v) => setProcessMode(v as "complete" | "fast")} disabled={isProcessing} className="flex flex-col gap-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="fast" id="mode-fast" />
                    <Label htmlFor="mode-fast" className="flex flex-col cursor-pointer">
                      <span>Expresso (Recomendado para Lote)</span>
                      <span className="text-xs text-muted-foreground font-normal">Apenas dados de contato e faturamento. Maior velocidade (~3s/lead).</span>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="complete" id="mode-complete" />
                    <Label htmlFor="mode-complete" className="flex flex-col cursor-pointer">
                      <span>Profundo (Com Inteligência Artificial)</span>
                      <span className="text-xs text-muted-foreground font-normal">Scraping completo e redação por IA. Mais lento (~40s/lead).</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="pt-4 space-y-2">
                <Button 
                    className="w-full gap-2" 
                    onClick={startProcessing} 
                    disabled={isProcessing || items.length === 0}
                >
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Iniciar Processamento
                </Button>
                <Button 
                    variant="secondary" 
                    className="w-full gap-2" 
                    onClick={startMassDownload}
                    disabled={!items.some(i => i.status === "completed")}
                >
                    <FileText className="h-4 w-4" /> Baixar PDFs (Massa)
                </Button>
                <Button 
                    variant="outline" 
                    className="w-full gap-2 opacity-70" 
                    onClick={exportResults}
                    disabled={!items.some(i => i.status === "completed")}
                >
                    <Download className="h-4 w-4" /> Exportar Planilha (CSV)
                </Button>
                <Button 
                    variant="ghost" 
                    className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10" 
                    onClick={clearList}
                    disabled={isProcessing || items.length === 0}
                >
                    <Trash2 className="h-4 w-4" /> Limpar Lista
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 border-border/50 bg-card overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-heading">Fila de Leads</CardTitle>
                  <CardDescription>{items.length} itens na fila</CardDescription>
                </div>
                {isProcessing && (
                  <Badge variant="outline" className="animate-pulse bg-primary/10 text-primary border-primary/20">
                    Processando...
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
                {items.length > 0 && (
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <div className="flex justify-between text-xs mb-1">
                                <span>Progresso Geral</span>
                                <span>{progress}%</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                        </div>
                        
                        <div className="rounded-md border border-border/50 max-h-[500px] overflow-y-auto">
                            <Table>
                                <TableHeader className="sticky top-0 bg-card z-10">
                                    <TableRow>
                                        <TableHead className="w-[200px]">Lead</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Empresa / Score</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.map((item, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell className="font-medium text-xs break-all">{item.input}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[10px] capitalize">{item.type}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                {item.status === "pending" && <span className="text-xs text-muted-foreground italic">Pendente</span>}
                                                {item.status === "processing" && (
                                                    <span className="text-xs text-primary flex items-center gap-1">
                                                        <Loader2 className="h-3 w-3 animate-spin" /> Processando
                                                    </span>
                                                )}
                                                {item.status === "completed" && (
                                                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                                                        <CheckCircle2 className="h-3 w-3" /> Concluído
                                                    </span>
                                                )}
                                                {item.status === "error" && (
                                                    <span className="text-xs text-destructive flex items-center gap-1" title={item.error}>
                                                        <XCircle className="h-3 w-3" /> Erro
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {item.result && (
                                                        <Button 
                                                            variant="ghost" 
                                                            size="icon" 
                                                            className="h-8 w-8 text-primary"
                                                            onClick={() => setSelectedResult(item.result!)}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {item.result ? (
                                                        <div className="text-xs text-left">
                                                            <div className="font-semibold truncate max-w-[150px] inline-block">
                                                                {item.result.dossier.empresa.nome}
                                                            </div>
                                                            <div className="text-[10px] text-muted-foreground">
                                                                Score: <span className="text-primary font-bold">{item.result.lead_score?.total}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                )}

                {items.length === 0 && (
                    <div className="py-20 text-center space-y-3 opacity-50">
                        <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                        <p className="text-sm">Nenhum arquivo carregado. Use o painel lateral para começar.</p>
                    </div>
                )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* MODAL DE VISUALIZAÇÃO INDIVIDUAL */}
      <Dialog open={!!selectedResult} onOpenChange={(open) => !open && setSelectedResult(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0 border-none bg-transparent">
          <div className="bg-background rounded-lg p-6 shadow-2xl relative">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-2xl font-heading">Dossiê Detalhado</DialogTitle>
            </DialogHeader>
            {selectedResult && (
              <DossierDisplay 
                dossier={selectedResult.dossier} 
                dataSources={selectedResult.data_sources} 
                leadScore={selectedResult.lead_score} 
              />
            )}
            <div className="mt-8 flex justify-end no-print">
               <Button variant="outline" onClick={() => setSelectedResult(null)}>Fechar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL DE SELEÇÃO DE DOWNLOAD EM MASSA */}
      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar Relatório Consolidado</DialogTitle>
          </DialogHeader>
          <div className="py-6 space-y-6">
            <RadioGroup value={printMode} onValueChange={(v: any) => setPrintMode(v)} className="grid gap-4">
              <Label
                htmlFor="estrategico"
                className={`flex items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer ${printMode === 'estrategico' ? 'border-primary' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <RadioGroupItem value="estrategico" id="estrategico" className="sr-only" />
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Modelo Estratégico</p>
                    <p className="text-xs text-muted-foreground">Focado em vendas. Sem logs técnicos.</p>
                  </div>
                </div>
              </Label>
              <Label
                htmlFor="completo"
                className={`flex items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer ${printMode === 'completo' ? 'border-primary' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <RadioGroupItem value="completo" id="completo" className="sr-only" />
                  <div className="h-8 w-8 rounded-full bg-secondary/30 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Modelo Completo</p>
                    <p className="text-xs text-muted-foreground">Inclui origens dos dados e logs de análise.</p>
                  </div>
                </div>
              </Label>
            </RadioGroup>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPrintDialogOpen(false)}>Cancelar</Button>
            <Button onClick={confirmMassPrint} className="gap-2">
              <Printer className="h-4 w-4" /> Baixar Consolidado (PDF)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LAYOUT DE IMPRESSÃO EM MASSA (OCULTO NA TELA) */}
      <div className="hidden print:block absolute inset-0 bg-white text-black p-0 m-0 z-[-1]">
        {/* CAPA DO SUMÁRIO EXECUTIVO */}
        <div className="min-h-screen flex flex-col p-16 relative">
          <div className="border-b-2 border-primary pb-8 mb-12">
            <div className="flex items-center gap-4 mb-4">
              <div className="h-12 w-12 bg-primary rounded-lg flex items-center justify-center">
                <Radar className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-4xl font-bold tracking-tight">Relatório Consolidado de Inteligência</h1>
            </div>
            <p className="text-xl text-muted-foreground">Group Radar Enterprise</p>
          </div>

          <div className="space-y-8 flex-1">
            <div className="bg-secondary/20 p-6 rounded-xl border border-border">
              <h2 className="text-2xl font-bold mb-4 uppercase tracking-wider text-primary">Sumário Executivo</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-6 gap-4 font-bold text-sm border-b pb-2">
                  <div className="col-span-3">EMPRESA</div>
                  <div>CNPJ</div>
                  <div>SCORE</div>
                  <div className="text-right">STATUS</div>
                </div>
                {items.filter(i => i.status === "completed").map((item, idx) => (
                  <div key={idx} className="grid grid-cols-6 gap-4 text-sm py-1 border-b border-border/50">
                    <div className="col-span-3 font-medium">{item.result?.dossier.empresa.nome}</div>
                    <div className="text-xs opacity-70">{item.result?.dossier.empresa.cnpj}</div>
                    <div className="font-bold text-primary">{item.result?.lead_score?.total}</div>
                    <div className="text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary border border-primary/20`}>
                            {item.result?.lead_score?.classificacao}
                        </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-auto pt-10 text-sm text-muted-foreground flex justify-between items-center">
              <span>Gerado em: {new Date().toLocaleString('pt-BR')}</span>
              <span>Total de Leads: {items.filter(i => i.status === "completed").length}</span>
            </div>
          </div>
        </div>

        {/* CADA DOSSIÊ EM UMA NOVA PÁGINA */}
        {items.filter(i => i.status === "completed").map((item, idx) => (
          <div key={idx} className="page-break-before">
            <div className="p-8">
                <DossierDisplay 
                    dossier={item.result!.dossier} 
                    dataSources={item.result!.data_sources} 
                    leadScore={item.result!.lead_score} 
                    forceShowTechnical={printMode === 'completo'}
                />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
