
-- =========================================
-- Idempotent re-apply of access control & API usage tracking
-- =========================================

-- 1. Types
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'comercial');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_source_name') THEN
    CREATE TYPE public.api_source_name AS ENUM ('gemini', 'firecrawl', 'seekloc', 'google_places', 'brasilapi');
  END IF;
END $$;

-- 2. Tables
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role public.user_role NOT NULL DEFAULT 'comercial',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    api_name public.api_source_name NOT NULL,
    credits_used NUMERIC NOT NULL DEFAULT 0,
    cost_usd NUMERIC NOT NULL DEFAULT 0,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;

-- 3. Security definer function for role checks (avoids recursion in RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.user_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.user_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) TO authenticated, service_role;

-- 4. Policies (drop + recreate — idempotent)
DROP POLICY IF EXISTS "Users can read their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;

CREATE POLICY "Users can read their own role"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.user_role));

CREATE POLICY "Admins can update roles"
  ON public.user_roles FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::public.user_role));

DROP POLICY IF EXISTS "Users can read their own usage" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Admins can read all usage" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Users can insert their own usage" ON public.api_usage_logs;

CREATE POLICY "Users can read their own usage"
  ON public.api_usage_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all usage"
  ON public.api_usage_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.user_role));

CREATE POLICY "Users can insert their own usage"
  ON public.api_usage_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 5. handle_new_user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_role public.user_role;
BEGIN
  IF NEW.email = 'iara.oliveira@partnerbank.com.br' THEN
    assigned_role := 'admin'::public.user_role;
  ELSE
    assigned_role := 'comercial'::public.user_role;
  END IF;

  INSERT INTO public.user_roles (id, email, role)
  VALUES (NEW.id, NEW.email, assigned_role)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. updated_at trigger for user_roles
DROP TRIGGER IF EXISTS update_user_roles_updated_at ON public.user_roles;
CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Analytics view
DROP VIEW IF EXISTS public.vw_api_usage_stats;
CREATE VIEW public.vw_api_usage_stats AS
SELECT
  date_trunc('month', created_at) AS month,
  api_name,
  COUNT(*) AS total_calls,
  SUM(credits_used) AS total_credits,
  SUM(cost_usd) AS total_cost_usd
FROM public.api_usage_logs
GROUP BY 1, 2;

-- 8. Backfill existing users
INSERT INTO public.user_roles (id, email, role)
SELECT
  id,
  email,
  CASE WHEN email = 'iara.oliveira@partnerbank.com.br'
       THEN 'admin'::public.user_role
       ELSE 'comercial'::public.user_role
  END
FROM auth.users
ON CONFLICT (id) DO NOTHING;
