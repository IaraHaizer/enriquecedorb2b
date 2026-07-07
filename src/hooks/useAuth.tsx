import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<'admin' | 'comercial' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRoleAndApproval = async (userId: string) => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role, approved')
        .eq('id', userId)
        .single();

      if (error || !data) {
        // Sem linha em user_roles: trata como não aprovado por segurança
        await supabase.auth.signOut();
        toast.error("Sua conta ainda não foi aprovada por um administrador.");
        setSession(null);
        setRole(null);
        return;
      }

      if (!data.approved) {
        await supabase.auth.signOut();
        toast.error(
          "Sua conta ainda não foi aprovada por um administrador. Você receberá acesso assim que a liberação for feita."
        );
        setSession(null);
        setRole(null);
        return;
      }

      setRole(data.role);
    };

    const handleSession = async (newSession: Session | null) => {
      if (newSession?.user) {
        await fetchRoleAndApproval(newSession.user.id);
        // Só define a sessão após aprovação confirmada
        setSession((current) => {
          // Se fetchRoleAndApproval já deslogou, mantém null
          return current === null && role === null ? current : newSession;
        });
        // Definir a sessão de forma direta funciona porque signOut disparará outro evento se necessário
        setSession(newSession);
        setLoading(false);
      } else {
        setSession(null);
        setRole(null);
        setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        handleSession(session);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = () => supabase.auth.signOut();

  return { session, role, loading, signOut };
}
