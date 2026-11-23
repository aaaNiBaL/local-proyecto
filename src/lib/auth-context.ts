import { useRouteContext } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import type { AppRole } from "./inventory";

export type AuthCtx = { user: User; role: AppRole; permissions: string[] };

export function useAuth() {
  const ctx = useRouteContext({ from: "/_authenticated" }) as AuthCtx;
  return {
    user: ctx.user,
    role: ctx.role,
    isAdmin: ctx.role === "admin",
    permissions: ctx.permissions,
    hasPermission: (permission: string) =>
      ctx.role === "admin" || ctx.permissions.includes(permission),
  };
}

export const ROUTE_PERMISSIONS: Record<string, string> = {
  "/vender": "sales",
  "/dashboard": "dashboard",
  "/inventarios": "inventory_view",
  "/movimientos": "movements_view",
  "/vencimientos": "expiry_manage",
  "/reportes": "reports",
  "/buscar": "search",
  "/configuracion": "settings_manage",
};
