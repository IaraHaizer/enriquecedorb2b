
CREATE TABLE public.dossier_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  input TEXT NOT NULL,
  input_type TEXT NOT NULL CHECK (input_type IN ('email', 'cnpj', 'nome')),
  empresa_nome TEXT,
  empresa_cnpj TEXT,
  dossier_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dossier_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read dossier history"
  ON public.dossier_history FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert dossier history"
  ON public.dossier_history FOR INSERT
  WITH CHECK (true);

CREATE INDEX idx_dossier_history_created_at ON public.dossier_history (created_at DESC);
CREATE INDEX idx_dossier_history_empresa_nome ON public.dossier_history USING GIN (to_tsvector('portuguese', COALESCE(empresa_nome, '')));
