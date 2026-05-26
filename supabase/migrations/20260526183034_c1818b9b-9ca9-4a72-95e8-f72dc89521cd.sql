
CREATE TABLE public.dossier_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input text NOT NULL,
  input_type text NOT NULL,
  skip_cache boolean NOT NULL DEFAULT false,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dossier_jobs TO authenticated;
GRANT ALL ON public.dossier_jobs TO service_role;

ALTER TABLE public.dossier_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own jobs" ON public.dossier_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Users insert own jobs" ON public.dossier_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own jobs" ON public.dossier_jobs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Users delete own jobs" ON public.dossier_jobs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::user_role));

CREATE INDEX idx_dossier_jobs_user_status ON public.dossier_jobs(user_id, status, created_at DESC);

CREATE TRIGGER update_dossier_jobs_updated_at
BEFORE UPDATE ON public.dossier_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
