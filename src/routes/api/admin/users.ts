import { createFileRoute } from "@tanstack/react-router";
import type { AppRole } from "@/lib/inventory";
import { userClient } from "@/lib/assistant-context.server";

type UserInput = {
  id?: string;
  email?: string;
  full_name?: string;
  role?: AppRole;
  is_active?: boolean;
};

const validRoles: AppRole[] = ["admin", "cajero", "consulta"];

function withApiErrors(handler: (context: { request: Request }) => Promise<Response>) {
  return async (context: { request: Request }) => {
    try {
      return await handler(context);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error interno al administrar usuarios.";
      console.error("[Admin users API]", message);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

async function authorize(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || token.split(".").length !== 3) {
    return { response: Response.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const client = userClient(token);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return { response: Response.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const { data: isAdmin, error: permissionError } = await client.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (permissionError) {
    return { response: Response.json({ error: permissionError.message }, { status: 500 }) };
  }
  if (!isAdmin) {
    return { response: Response.json({ error: "Solo administradores" }, { status: 403 }) };
  }
  return { client, userId: userData.user.id };
}

function isValidUserInput(
  body: UserInput,
): body is UserInput & { email: string; full_name: string; role: AppRole } {
  return (
    typeof body.email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) &&
    typeof body.full_name === "string" &&
    body.full_name.trim().length > 0 &&
    body.full_name.trim().length <= 120 &&
    validRoles.includes(body.role as AppRole)
  );
}

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      GET: withApiErrors(async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [profilesResult, rolesResult, permissionsResult, activityResult] = await Promise.all([
          supabaseAdmin.from("profiles").select("id, full_name, email, is_active, created_at"),
          supabaseAdmin.from("user_roles").select("user_id, role"),
          supabaseAdmin
            .from("role_permissions")
            .select("role, permission, allowed")
            .order("permission"),
          supabaseAdmin
            .from("activity_log")
            .select("id, actor_id, target_user_id, action, details, created_at")
            .order("created_at", { ascending: false })
            .limit(100),
        ]);
        const queryError =
          profilesResult.error ??
          rolesResult.error ??
          permissionsResult.error ??
          activityResult.error;
        if (queryError) return Response.json({ error: queryError.message }, { status: 500 });

        const users: { id: string; email: string; last_sign_in_at: string | null }[] = [];
        for (let page = 1; ; page += 1) {
          const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) return Response.json({ error: error.message }, { status: 500 });
          users.push(
            ...data.users.map((user) => ({
              id: user.id,
              email: user.email ?? "",
              last_sign_in_at: user.last_sign_in_at ?? null,
            })),
          );
          if (data.users.length < 1000) break;
        }

        const authUsers = new Map(users.map((user) => [user.id, user]));
        const roles = new Map((rolesResult.data ?? []).map((row) => [row.user_id, row.role]));
        const managedUsers = (profilesResult.data ?? []).map((profile) => ({
          ...profile,
          email: profile.email ?? authUsers.get(profile.id)?.email ?? "",
          role: roles.get(profile.id) ?? "cajero",
          last_sign_in_at: authUsers.get(profile.id)?.last_sign_in_at ?? null,
        }));

        return Response.json({
          users: managedUsers,
          permissions: permissionsResult.data ?? [],
          activity: activityResult.data ?? [],
        });
      }),
      POST: withApiErrors(async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;

        let body: UserInput;
        try {
          body = (await request.json()) as UserInput;
        } catch {
          return Response.json({ error: "Solicitud inválida" }, { status: 400 });
        }
        if (!isValidUserInput(body)) {
          return Response.json(
            { error: "Nombre, correo y rol son obligatorios; revisa los datos ingresados." },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          body.email.trim().toLowerCase(),
          {
            data: { full_name: body.full_name.trim() },
            redirectTo: new URL("/auth", request.url).toString(),
          },
        );
        if (error) return Response.json({ error: error.message }, { status: 400 });
        if (!data.user)
          return Response.json(
            { error: "Supabase no devolvió el usuario invitado." },
            { status: 502 },
          );

        const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
          id: data.user.id,
          full_name: body.full_name.trim(),
          email: body.email.trim().toLowerCase(),
          is_active: true,
        });
        if (profileError) {
          const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(data.user.id);
          if (cleanupError)
            console.error(
              "No se pudo limpiar el usuario invitado tras fallar su perfil:",
              cleanupError.message,
            );
          return Response.json({ error: profileError.message }, { status: 500 });
        }

        const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
          user_id: data.user.id,
          role: body.role,
        });
        if (roleError) {
          const { error: profileCleanupError } = await supabaseAdmin
            .from("profiles")
            .delete()
            .eq("id", data.user.id);
          if (profileCleanupError)
            console.error(
              "No se pudo limpiar el perfil de la invitación fallida:",
              profileCleanupError.message,
            );
          const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(data.user.id);
          if (cleanupError)
            console.error(
              "No se pudo limpiar el usuario invitado tras fallar su rol:",
              cleanupError.message,
            );
          return Response.json({ error: roleError.message }, { status: 500 });
        }

        const { error: activityError } = await supabaseAdmin.from("activity_log").insert({
          actor_id: auth.userId,
          target_user_id: data.user.id,
          action: "user_invited",
          details: { email: body.email.trim().toLowerCase(), role: body.role },
        });
        if (activityError) return Response.json({ error: activityError.message }, { status: 500 });
        return Response.json({ ok: true }, { status: 201 });
      }),
      PATCH: withApiErrors(async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;

        let body: UserInput;
        try {
          body = (await request.json()) as UserInput;
        } catch {
          return Response.json({ error: "Solicitud inválida" }, { status: 400 });
        }
        if (!body.id || !isValidUserInput(body) || typeof body.is_active !== "boolean") {
          return Response.json(
            { error: "Datos de usuario incompletos o inválidos." },
            { status: 400 },
          );
        }
        if (body.id === auth.userId && (!body.is_active || body.role !== "admin")) {
          return Response.json(
            { error: "No puedes desactivar ni cambiar el rol de tu propia cuenta." },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: currentAuthUser, error: currentUserError } =
          await supabaseAdmin.auth.admin.getUserById(body.id);
        if (currentUserError || !currentAuthUser.user) {
          return Response.json(
            { error: currentUserError?.message ?? "Usuario no encontrado." },
            { status: 404 },
          );
        }
        if (!currentAuthUser.user.email) {
          return Response.json(
            {
              error:
                "No se puede actualizar el correo de esta cuenta porque no tiene uno registrado.",
            },
            { status: 400 },
          );
        }
        const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(body.id, {
          email: body.email.trim().toLowerCase(),
          user_metadata: { full_name: body.full_name.trim() },
        });
        if (authUpdateError)
          return Response.json({ error: authUpdateError.message }, { status: 400 });

        const { error: updateError } = await auth.client.rpc("admin_update_user", {
          _user_id: body.id,
          _role: body.role,
          _is_active: body.is_active,
          _full_name: body.full_name.trim(),
          _email: body.email.trim().toLowerCase(),
        });
        if (updateError) {
          const { error: rollbackError } = await supabaseAdmin.auth.admin.updateUserById(body.id, {
            email: currentAuthUser.user.email,
            user_metadata: currentAuthUser.user.user_metadata,
          });
          if (rollbackError) {
            console.error(
              "No se pudo revertir la actualización de autenticación:",
              rollbackError.message,
            );
            return Response.json(
              {
                error: `${updateError.message}. Además, no se pudo revertir el cambio de autenticación; revisa el usuario en Supabase.`,
              },
              { status: 502 },
            );
          }
          return Response.json({ error: updateError.message }, { status: 400 });
        }

        const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(body.id, {
          ban_duration: body.is_active ? "none" : "876000h",
        });
        if (banError) return Response.json({ error: banError.message }, { status: 502 });
        return Response.json({ ok: true });
      }),
    },
  },
});
