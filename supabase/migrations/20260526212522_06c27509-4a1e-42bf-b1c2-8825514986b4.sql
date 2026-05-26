CREATE TABLE public.linkedin_scrape_cache (
  url TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX idx_linkedin_scrape_cache_expires ON public.linkedin_scrape_cache(expires_at);

GRANT ALL ON public.linkedin_scrape_cache TO service_role;

ALTER TABLE public.linkedin_scrape_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on linkedin_scrape_cache"
ON public.linkedin_scrape_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);