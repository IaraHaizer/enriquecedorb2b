-- Drop old public policies
DROP POLICY IF EXISTS "Anyone can insert dossier history" ON public.dossier_history;
DROP POLICY IF EXISTS "Anyone can read dossier history" ON public.dossier_history;

-- Create authenticated-only policies
CREATE POLICY "Authenticated users can insert dossier history"
ON public.dossier_history
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can read dossier history"
ON public.dossier_history
FOR SELECT
TO authenticated
USING (true);