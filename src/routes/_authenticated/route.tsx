import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import type { AppRole } from "@/lib/inventory";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: role, error: rErr } = await supabase.rpc("ensure_profile");
    if (rErr) throw new Error(rErr.message);
    return { user: data.user, role: (role ?? "cajero") as AppRole };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
