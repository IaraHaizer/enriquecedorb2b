CREATE TABLE public.firecrawl_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  source_name text NOT NULL,
  query text NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX idx_firecrawl_cache_key ON public.firecrawl_cache(cache_key);
CREATE INDEX idx_firecrawl_cache_expires ON public.firecrawl_cache(expires_at);

ALTER TABLE public.firecrawl_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on firecrawl_cache"
ON public.firecrawl_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can read cache"
ON public.firecrawl_cache
FOR SELECT
TO authenticated
USING (true);