import { useState } from "react";
import { Search, Mail, Hash, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InputType } from "@/lib/dossier-api";

interface DossierFormProps {
  onSubmit: (input: string, inputType: InputType) => void;
  isLoading: boolean;
}

const inputConfig: Record<InputType, { icon: typeof Mail; placeholder: string; label: string }> = {
  email: { icon: Mail, placeholder: "contato@empresa.com.br", label: "E-mail" },
  cnpj: { icon: Hash, placeholder: "00.000.000/0000-00", label: "CNPJ" },
  nome: { icon: User, placeholder: "Nome da Empresa ou Sócio", label: "Nome" },
};

export function DossierForm({ onSubmit, isLoading }: DossierFormProps) {
  const [inputType, setInputType] = useState<InputType>("cnpj");
  const [value, setValue] = useState("");

  const config = inputConfig[inputType];
  const Icon = config.icon;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim(), inputType);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto space-y-6">
      <Tabs value={inputType} onValueChange={(v) => setInputType(v as InputType)} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-secondary">
          <TabsTrigger value="cnpj" className="font-heading text-sm">CNPJ</TabsTrigger>
          <TabsTrigger value="email" className="font-heading text-sm">E-mail</TabsTrigger>
          <TabsTrigger value="nome" className="font-heading text-sm">Nome</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative">
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={config.placeholder}
          className="pl-12 h-14 text-base bg-card border-border focus:border-primary"
          disabled={isLoading}
        />
      </div>

      <Button
        type="submit"
        disabled={isLoading || !value.trim()}
        className="w-full h-12 text-base font-heading bg-primary hover:bg-primary/90"
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            Gerando Dossiê...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Gerar Dossiê Estratégico
          </span>
        )}
      </Button>
    </form>
  );
}
