import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  BarChart3,
  Boxes,
  CalendarClock,
  LayoutDashboard,
  LogOut,
  ScanLine,
  Search,
  Settings,
  Store,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ADMIN_ONLY } from "@/lib/auth-context";
import { settingsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const NAV = [
  { to: "/vender", label: "Vender", icon: ScanLine, hint: "Punto de venta" },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Panel general" },
  { to: "/inventarios", label: "Inventarios", icon: Boxes, hint: "Catálogo y stock" },
  { to: "/movimientos", label: "Movimientos", icon: ArrowDownToLine, hint: "Entradas de mercadería" },
  { to: "/vencimientos", label: "Vencimientos & Mermas", icon: CalendarClock, hint: "Prevención de pérdidas" },
  { to: "/reportes", label: "Reportes", icon: BarChart3, hint: "Rendimiento" },
  { to: "/buscar", label: "Buscar", icon: Search, hint: "Buscador global" },
  { to: "/configuracion", label: "Configuración", icon: Settings, hint: "Local y usuarios" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, role, isAdmin } = useAuth();
  const { data: settings } = useQuery(settingsQuery);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const items = NAV.filter((n) => isAdmin || !ADMIN_ONLY.has(n.to));
  const current = NAV.find((n) => path.startsWith(n.to));

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-muted/40">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Store className="size-5" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate font-bold tracking-tight">Invenco</p>
            <p className="truncate text-xs text-muted-foreground">{settings?.store_name ?? "Minimarket"}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              )}
              activeProps={{ className: "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary" }}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.user_metadata?.full_name ?? user.email}</p>
              <Badge variant={isAdmin ? "default" : "secondary"} className="mt-0.5 text-[10px] uppercase">
                {role === "admin" ? "Administrador" : "Cajero"}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} title="Cerrar sesión">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b bg-card">
          <div className="flex items-center gap-3 px-4 py-3 md:px-6">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground md:hidden">
              <Store className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight md:text-xl">{current?.label ?? "Invenco"}</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">{current?.hint}</p>
            </div>
            <div className="ml-auto hidden text-right text-xs text-muted-foreground sm:block">
              <p className="font-medium text-foreground">{settings?.store_name}</p>
              <p>
                {settings?.address}, {settings?.city}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} className="md:hidden" title="Cerrar sesión">
              <LogOut className="size-4" />
            </Button>
          </div>
          <div className="flex gap-1 overflow-x-auto border-t px-2 py-2 md:hidden">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted-foreground"
                activeProps={{ className: "bg-primary/10 text-primary" }}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (isAdmin) return <>{children}</>;
  return (
    <div className="rounded-xl border bg-card p-8 text-center">
      <p className="font-semibold">Sección solo para administradores</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Tu perfil de cajero tiene acceso a Vender, Dashboard y Buscar.
      </p>
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4",
        tone === "warn" && "border-accent/60 bg-accent/10",
        tone === "danger" && "border-destructive/50 bg-destructive/5",
        tone === "good" && "border-primary/40 bg-primary/5",
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
