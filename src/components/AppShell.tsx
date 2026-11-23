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
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROUTE_PERMISSIONS } from "@/lib/auth-context";
import { settingsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const NAV = [
  { to: "/vender", label: "Vender", icon: ScanLine, hint: "Punto de venta" },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Panel general" },
  { to: "/inventarios", label: "Inventarios", icon: Boxes, hint: "Catálogo y stock" },
  {
    to: "/movimientos",
    label: "Movimientos",
    icon: ArrowDownToLine,
    hint: "Entradas y salidas de inventario",
  },
  {
    to: "/vencimientos",
    label: "Vencimientos & Mermas",
    icon: CalendarClock,
    hint: "Prevención de pérdidas",
  },
  { to: "/reportes", label: "Reportes", icon: BarChart3, hint: "Rendimiento" },
  { to: "/buscar", label: "Buscar", icon: Search, hint: "Buscador global" },
  { to: "/configuracion", label: "Configuración", icon: Settings, hint: "Local y usuarios" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, role, isAdmin, hasPermission } = useAuth();
  const { data: settings } = useQuery(settingsQuery);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const items = NAV.filter((n) => hasPermission(ROUTE_PERMISSIONS[n.to] ?? ""));
  const current = NAV.find((n) => path.startsWith(n.to));
  const canViewCurrent = !current || hasPermission(ROUTE_PERMISSIONS[current.to] ?? "");

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
            <p className="truncate text-xs text-muted-foreground">
              {settings?.store_name ?? "Minimarket"}
            </p>
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
              activeProps={{
                className: "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
              }}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {(user.user_metadata?.["full_name"] as string | undefined) ?? user.email}
              </p>
              <Badge
                variant={isAdmin ? "default" : "secondary"}
                className="mt-0.5 text-[10px] uppercase"
              >
                {ROLE_LABELS[role]}
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
              <h1 className="truncate text-lg font-bold tracking-tight md:text-xl">
                {current?.label ?? "Invenco"}
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">{current?.hint}</p>
            </div>
            <div className="ml-auto hidden text-right text-xs text-muted-foreground sm:block">
              <p className="font-medium text-foreground">{settings?.store_name}</p>
              <p>
                {[settings?.address, settings?.city, settings?.region].filter(Boolean).join(", ")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              className="md:hidden"
              title="Cerrar sesión"
            >
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
        <main className="flex-1 p-4 md:p-6">
          {canViewCurrent ? (
            children
          ) : (
            <div className="rounded-xl border bg-card p-8 text-center">
              <p className="font-semibold">No tienes permiso para consultar esta sección</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Si necesitas acceso, solicita ayuda al administrador del local.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export function AdminOnly({ children, permission }: { children: ReactNode; permission?: string }) {
  const { isAdmin, hasPermission } = useAuth();
  if (permission ? hasPermission(permission) : isAdmin) return <>{children}</>;
  return (
    <div className="rounded-xl border bg-card p-8 text-center">
      <p className="font-semibold">No tienes permiso para consultar esta sección</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Si necesitas acceso, solicita ayuda al administrador del local.
      </p>
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "warn" | "danger" | "good";
  icon: LucideIcon;
}) {
  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
        tone === "good" && "border-primary/40 bg-primary/5",
        tone === "warn" && "border-accent/40 bg-gradient-to-br from-accent/10 via-card to-card",
        tone === "danger" &&
          "border-destructive/30 bg-gradient-to-br from-destructive/5 via-card to-card",
      )}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 truncate text-2xl font-bold tracking-tight sm:text-[1.7rem]">
              {value}
            </p>
          </div>
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-transform group-hover:scale-105",
              tone === "good" && "bg-primary/10 text-primary",
              tone === "warn" && "bg-accent/20 text-accent-foreground",
              tone === "danger" && "bg-destructive/10 text-destructive",
            )}
          >
            <Icon className="size-5" />
          </span>
        </div>
        <div className="mt-3 min-h-5 text-xs leading-relaxed text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
