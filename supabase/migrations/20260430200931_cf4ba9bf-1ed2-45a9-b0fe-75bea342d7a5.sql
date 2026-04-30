
-- Recreate view with security_invoker to respect querying user's RLS
DROP VIEW IF EXISTS public.vw_api_usage_stats;
CREATE VIEW public.vw_api_usage_stats
WITH (security_invoker = true) AS
SELECT
  date_trunc('month', created_at) AS month,
  api_name,
  COUNT(*) AS total_calls,
  SUM(credits_used) AS total_credits,
  SUM(cost_usd) AS total_cost_usd
FROM public.api_usage_logs
GROUP BY 1, 2;

-- Restrict has_role execution; policies still call it via SECURITY DEFINER context internally
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) FROM authenticated;
