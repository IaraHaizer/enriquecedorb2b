import { useState, useMemo } from "react";
import { Search, Mail, Hash, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { InputType } from "@/lib/dossier-api";

interface DossierFormProps {
  onSubmit: (input: string, inputType: InputType) => void;
  isLoading: boolean;
}

function detectInputType(value: string): InputType {
  const cleaned = value.replace(/[\s.\-/]/g, "");
  if (value.includes("@")) return "email";
  if (/^\d{14}$/.test(cleaned) || /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(value.trim())) return "cnpj";
  return "nome";
}

const typeConfig: Record<InputType, { icon: typeof Mail; label: string; color: string }> = {
  cnpj: { icon: Hash, label: "CNPJ", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  email: { icon: Mail, label: "E-mail", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  nome: { icon: User, label: "Nome", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
};

export function DossierForm({ onSubmit, isLoading }: DossierFormProps) {
  const [value, setValue] = useState("");

  const detectedType = useMemo(() => detectInputType(value), [value]);
  const config = typeConfig[detectedType];
  const Icon = config.icon;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim(), detectedType);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto space-y-4">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Digite um CNPJ, e-mail ou nome de empresa/sócio..."
          className="pl-12 pr-28 h-14 text-base bg-card border-border focus:border-primary"
          disabled={isLoading}
        />
        {value.trim() && (
          <Badge
            variant="outline"
            className={`absolute right-3 top-1/2 -translate-y-1/2 ${config.color} text-xs font-medium`}
          >
            <Icon className="h-3 w-3 mr-1" />
            {config.label}
          </Badge>
        )}
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
