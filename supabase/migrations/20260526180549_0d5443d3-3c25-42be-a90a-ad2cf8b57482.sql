
-- Add user_id ownership to dossier_history
ALTER TABLE public.dossier_history ADD COLUMN IF NOT EXISTS user_id uuid;

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can read dossier history" ON public.dossier_history;
DROP POLICY IF EXISTS "Authenticated users can insert dossier history" ON public.dossier_history;

-- Owner-scoped policies, admins can read all
CREATE POLICY "Users read own dossier history"
ON public.dossier_history FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.user_role));

CREATE POLICY "Users insert own dossier history"
ON public.dossier_history FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own dossier history"
ON public.dossier_history FOR DELETE TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.user_role));

-- Restrict firecrawl_cache reads to service_role only (edge functions)
DROP POLICY IF EXISTS "Authenticated users can read cache" ON public.firecrawl_cache;

-- Restrict has_role function execution
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) TO authenticated, service_role;
