
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

UPDATE public.user_roles SET approved = true;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role public.user_role;
  is_approved boolean;
BEGIN
  IF NEW.email = 'iara.oliveira@partnerbank.com.br' THEN
    assigned_role := 'admin'::public.user_role;
    is_approved := true;
  ELSE
    assigned_role := 'comercial'::public.user_role;
    is_approved := false;
  END IF;

  INSERT INTO public.user_roles (id, email, role, approved)
  VALUES (NEW.id, NEW.email, assigned_role, is_approved)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

UPDATE auth.users
   SET email_confirmed_at = now()
 WHERE email = 'deboragroupsoftware@gmail.com'
   AND email_confirmed_at IS NULL;

INSERT INTO public.user_roles (id, email, role, approved)
SELECT id, email, 'comercial'::public.user_role, false
  FROM auth.users
 WHERE email = 'deboragroupsoftware@gmail.com'
ON CONFLICT (id) DO UPDATE SET approved = false;
