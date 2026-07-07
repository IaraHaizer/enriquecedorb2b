
CREATE TABLE public.password_reset_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  target_email text NOT NULL,
  admin_user_id uuid NOT NULL,
  admin_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.password_reset_audit TO authenticated;
GRANT ALL ON public.password_reset_audit TO service_role;

ALTER TABLE public.password_reset_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view password reset audit"
  ON public.password_reset_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.user_role));

CREATE INDEX idx_password_reset_audit_created_at ON public.password_reset_audit (created_at DESC);
