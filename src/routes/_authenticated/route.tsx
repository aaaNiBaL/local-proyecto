import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { AssistantBubble } from "@/components/AssistantBubble";
import type { AppRole } from "@/lib/inventory";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) throw redirect({ to: "/auth" });

    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw redirect({ to: "/auth" });

    const { data: role, error: roleError } = await supabase.rpc("ensure_profile");
    if (roleError) throw roleError;
    const { data: permissions, error: permissionsError } = await supabase.rpc("get_my_permissions");
    if (permissionsError?.code === "PGRST202") {
      throw new Error(
        "La base de datos aún no tiene los permisos nuevos. En Supabase, aplica las migraciones 20261102170000_consultation_role.sql y 20261102171000_user_permissions_and_management.sql, en ese orden, y luego vuelve a cargar la página.",
      );
    }
    if (permissionsError) throw permissionsError;
    return { user: data.user, role: (role ?? "cajero") as AppRole, permissions: permissions ?? [] };
  },
  component: () => (
    <AppShell>
      <Outlet />
      <AssistantBubble />
    </AppShell>
  ),
});
