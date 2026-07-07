import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<'admin' | 'comercial' | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const checkApprovalAndSet = async (newSession: Session | null) => {
      if (!newSession?.user) {
        if (cancelled) return;
        setSession(null);
        setRole(null);
        setMustChangePassword(false);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_roles')
        .select('role, approved')
        .eq('id', newSession.user.id)
        .single();

      if (cancelled) return;

      if (error || !data || !data.approved) {
        await supabase.auth.signOut();
        setSession(null);
        setRole(null);
        setMustChangePassword(false);
        setLoading(false);
        toast.error(
          "Sua conta ainda não foi aprovada por um administrador. Você receberá acesso assim que a liberação for feita."
        );
        return;
      }

      setSession(newSession);
      setRole(data.role);
      setMustChangePassword(
        Boolean((newSession.user.user_metadata as Record<string, unknown> | null)?.must_change_password)
      );
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        checkApprovalAndSet(newSession);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      checkApprovalAndSet(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = () => supabase.auth.signOut();

  return { session, role, mustChangePassword, loading, signOut };
}
