import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AppNavLinkProps {
  to: string;
  icon: React.ElementType;
  label: string;
  active?: boolean;
}

export function AppNavLink({ to, icon: Icon, label, active: forcedActive }: AppNavLinkProps) {
  const location = useLocation();
  const isActive = forcedActive ?? location.pathname === to;

  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className={cn(
        "text-muted-foreground",
        isActive && "bg-secondary text-foreground"
      )}
    >
      <Link to={to}>
        <Icon className="h-4 w-4 mr-1" />
        {label}
      </Link>
    </Button>
  );
}
