import { useRouteContext } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import type { AppRole } from "./inventory";

export type AuthCtx = { user: User; role: AppRole };

export function useAuth() {
  const ctx = useRouteContext({ from: "/_authenticated" }) as AuthCtx;
  return { user: ctx.user, role: ctx.role, isAdmin: ctx.role === "admin" };
}

export const ADMIN_ONLY = new Set(["/inventarios", "/movimientos", "/vencimientos", "/reportes", "/configuracion"]);
