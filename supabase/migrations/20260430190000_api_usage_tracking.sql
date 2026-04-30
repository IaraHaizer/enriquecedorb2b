-- Create custom types
CREATE TYPE user_role AS ENUM ('admin', 'comercial');
CREATE TYPE api_source_name AS ENUM ('gemini', 'firecrawl', 'seekloc', 'google_places', 'brasilapi');

-- Create user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'comercial',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Policies for user_roles
CREATE POLICY "Users can read their own role"
    ON public.user_roles
    FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Admins can read all roles"
    ON public.user_roles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur 
            WHERE ur.id = auth.uid() AND ur.role = 'admin'
        )
    );

CREATE POLICY "Admins can update roles"
    ON public.user_roles
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur 
            WHERE ur.id = auth.uid() AND ur.role = 'admin'
        )
    );

-- Trigger to automatically create a user_role entry when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (id, email, role)
  VALUES (
    NEW.id, 
    NEW.email, 
    -- Se for o primeiro usuário do sistema, ou tiver e-mail específico, você pode alterar aqui. 
    -- Por padrão, todos começam como comercial.
    'comercial'::user_role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if trigger exists before creating
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
        CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    END IF;
END
$$;

-- Create api_usage_logs table
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    api_name api_source_name NOT NULL,
    credits_used NUMERIC NOT NULL DEFAULT 0,
    cost_usd NUMERIC NOT NULL DEFAULT 0,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;

-- Policies for api_usage_logs
CREATE POLICY "Users can read their own usage"
    ON public.api_usage_logs
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all usage"
    ON public.api_usage_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur 
            WHERE ur.id = auth.uid() AND ur.role = 'admin'
        )
    );

-- Allow inserting usage from edge functions (Edge functions use service_role which bypasses RLS, but we can allow authenticated users to insert their own logs if needed. For safety, we keep it restricted).
CREATE POLICY "Users can insert their own usage"
    ON public.api_usage_logs
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Create a view for easy analytics
CREATE OR REPLACE VIEW public.vw_api_usage_stats AS
SELECT 
    date_trunc('month', created_at) as month,
    api_name,
    COUNT(*) as total_calls,
    SUM(credits_used) as total_credits,
    SUM(cost_usd) as total_cost_usd
FROM public.api_usage_logs
GROUP BY 1, 2;
