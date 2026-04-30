import { Radar, LogOut, Search, BarChart3, History, Layers, LayoutDashboard, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppNavLink } from "@/components/AppNavLink";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "react-router-dom";
import React from "react";

interface AppHeaderProps {
  children?: React.ReactNode;
}

export function AppHeader({ children }: AppHeaderProps) {
  const { signOut, role } = useAuth();
  const location = useLocation();

  return (
    <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container max-w-6xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Radar className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-bold tracking-tight">Group Radar</h1>
            <p className="text-xs text-muted-foreground">Inteligência Estratégica · Group Software</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-center md:justify-end w-full md:w-auto">
          <AppNavLink to="/" icon={Search} label="Pesquisa" active={location.pathname === '/'} />
          <AppNavLink to="/ranking" icon={BarChart3} label="Ranking" active={location.pathname === '/ranking'} />
          <AppNavLink to="/historico" icon={History} label="Histórico" active={location.pathname === '/historico'} />
          <AppNavLink to="/massa" icon={Layers} label="Massa" active={location.pathname === '/massa'} />
          
          {role === 'admin' && (
            <>
              <AppNavLink to="/admin/metrics" icon={LayoutDashboard} label="Métricas" active={location.pathname === '/admin/metrics'} />
              <AppNavLink to="/admin/users" icon={Users} label="Acessos" active={location.pathname === '/admin/users'} />
            </>
          )}

          {children}

          <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
            <LogOut className="h-4 w-4 mr-1" /> Sair
          </Button>
        </div>
      </div>
    </header>
  );
}
