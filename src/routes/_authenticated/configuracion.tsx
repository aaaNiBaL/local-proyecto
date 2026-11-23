import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  BellRing,
  Building2,
  Clock3,
  KeyRound,
  MessageCircle,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserRoundX,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { qk, settingsQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth-context";
import type { AppRole } from "@/lib/inventory";
import { PERMISSIONS, ROLE_LABELS, type Permission, type PermissionRow } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ManagedUser = {
  id: string;
  full_name: string | null;
  email: string;
  is_active: boolean;
  role: AppRole;
  created_at: string;
  last_sign_in_at: string | null;
};

type UserActivity = {
  id: number;
  actor_id: string | null;
  target_user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

type WhatsAppNotification = Database["public"]["Tables"]["whatsapp_notifications"]["Row"];
type BusinessSettingsForm = Pick<
  Database["public"]["Tables"]["settings"]["Row"],
  | "store_name"
  | "business_description"
  | "address"
  | "city"
  | "region"
  | "opening_time"
  | "closing_time"
  | "operating_days"
  | "currency"
  | "timezone"
  | "business_status"
>;
type WhatsAppActionResult = {
  error?: string;
  message?: string;
  connected?: boolean;
  alreadySent?: boolean;
};

type AdminData = {
  users: ManagedUser[];
  permissions: PermissionRow[];
  activity: UserActivity[];
};

type UserForm = { full_name: string; email: string; role: AppRole; is_active: boolean };
const emptyForm: UserForm = { full_name: "", email: "", role: "cajero", is_active: true };
const adminUsersKey = ["admin-users"] as const;
const whatsAppHistoryKey = ["whatsapp-notifications"] as const;
const OPERATING_DAYS = [
  { value: "lunes", label: "Lunes" },
  { value: "martes", label: "Martes" },
  { value: "miércoles", label: "Miércoles" },
  { value: "jueves", label: "Jueves" },
  { value: "viernes", label: "Viernes" },
  { value: "sábado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
] as const;

async function invokeWhatsAppAction(
  action: string,
  extra?: Record<string, string>,
): Promise<WhatsAppActionResult> {
  const { data, error } = await supabase.functions.invoke<WhatsAppActionResult>(
    "whatsapp-notifications",
    { body: { action, ...extra } },
  );
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data) throw new Error("El servidor no devolvió una respuesta.");
  return data;
}

function notificationTypeLabel(type: string) {
  switch (type) {
    case "daily_report":
      return "Reporte diario";
    case "low_stock":
      return "Stock bajo";
    case "out_of_stock":
      return "Producto agotado";
    case "expiry_alert":
      return "Vencimiento";
    case "inventory_adjustment":
      return "Ajuste de inventario";
    case "waste":
      return "Merma";
    case "return":
      return "Devolución";
    case "supplier_return":
      return "Devolución a proveedor";
    case "manual_out":
      return "Salida manual";
    case "test":
      return "Prueba";
    default:
      return type;
  }
}

function notificationStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "sending":
      return "Enviando";
    case "sent":
      return "Enviado";
    case "failed":
      return "Fallido";
    default:
      return status;
  }
}

export const Route = createFileRoute("/_authenticated/configuracion")({
  head: () => ({ meta: [{ title: "Configuración — Invenco" }] }),
  component: SettingsPage,
});

async function adminRequest(method: "GET" | "POST" | "PATCH", body?: UserForm & { id?: string }) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  const response = await fetch("/api/admin/users", {
    method,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const responseText = await response.text();
  let result: { error?: string } & Partial<AdminData>;
  try {
    result = JSON.parse(responseText) as { error?: string } & Partial<AdminData>;
  } catch {
    throw new Error(
      `El servidor devolvió una respuesta inválida (HTTP ${response.status}). Verifica la configuración de SUPABASE_SERVICE_ROLE_KEY en el servidor y reinicia la aplicación.`,
    );
  }
  if (!response.ok) throw new Error(result.error ?? "No se pudo completar la solicitud.");
  return result as AdminData;
}

function SettingsPage() {
  const { user, isAdmin, hasPermission } = useAuth();
  const canManageSettings = hasPermission("settings_manage");
  const qc = useQueryClient();
  const router = useRouter();
  const { data: settings } = useQuery(settingsQuery);
  const usersQuery = useQuery({
    queryKey: adminUsersKey,
    queryFn: () => adminRequest("GET"),
    enabled: isAdmin,
  });
  const whatsappHistoryQuery = useQuery({
    queryKey: whatsAppHistoryKey,
    queryFn: async (): Promise<WhatsAppNotification[]> => {
      const { data, error } = await supabase
        .from("whatsapp_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: isAdmin,
  });
  const adminData = usersQuery.data;
  const users = useMemo(() => adminData?.users ?? [], [adminData?.users]);
  const [f, setF] = useState<BusinessSettingsForm>({
    store_name: "",
    business_description: "",
    address: "",
    city: "",
    region: "",
    opening_time: "09:00",
    closing_time: "21:00",
    operating_days: [],
    currency: "CLP",
    timezone: "America/Santiago",
    business_status: "abierto",
  });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>(emptyForm);
  const [whatsappForm, setWhatsappForm] = useState({
    owner_whatsapp: "",
    whatsapp_notifications_enabled: false,
    daily_report_enabled: true,
    daily_report_hour: 22,
    inventory_alerts_enabled: false,
    expiry_alert_days: 7,
  });

  useEffect(() => {
    if (settings) {
      setF({
        store_name: settings.store_name,
        business_description: settings.business_description,
        address: settings.address,
        city: settings.city,
        region: settings.region,
        opening_time: settings.opening_time.slice(0, 5),
        closing_time: settings.closing_time.slice(0, 5),
        operating_days: settings.operating_days,
        currency: settings.currency,
        timezone: settings.timezone,
        business_status: settings.business_status,
      });
    }
  }, [settings]);

  useEffect(() => {
    if (settings) {
      setWhatsappForm({
        owner_whatsapp: settings.owner_whatsapp,
        whatsapp_notifications_enabled: settings.whatsapp_notifications_enabled,
        daily_report_enabled: settings.daily_report_enabled,
        daily_report_hour: settings.daily_report_hour,
        inventory_alerts_enabled: settings.inventory_alerts_enabled,
        expiry_alert_days: settings.expiry_alert_days,
      });
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      if (!f.store_name.trim()) throw new Error("El nombre del establecimiento es obligatorio.");
      if (!f.address.trim() || !f.city.trim() || !f.region.trim()) {
        throw new Error("Completa la dirección, ciudad y región.");
      }
      if (f.store_name.trim().length > 120 || f.business_description.length > 500) {
        throw new Error("El nombre admite hasta 120 caracteres y la descripción hasta 500.");
      }
      if (f.operating_days.length > 7 || !f.opening_time || !f.closing_time) {
        throw new Error("Revisa el horario y los días de funcionamiento.");
      }
      if (!["abierto", "cerrado", "temporalmente_inactivo"].includes(f.business_status)) {
        throw new Error("Selecciona un estado válido para el establecimiento.");
      }
      const { error } = await supabase.from("settings").update(f).eq("id", 1);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Datos del local guardados");
      qc.invalidateQueries({ queryKey: qk.settings });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveWhatsApp = useMutation({
    mutationFn: async () => {
      const phone = whatsappForm.owner_whatsapp.trim();
      if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
        throw new Error("Ingresa el número en formato internacional, por ejemplo +56912345678.");
      }
      const { error } = await supabase
        .from("settings")
        .update({ ...whatsappForm, owner_whatsapp: phone })
        .eq("id", 1);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Configuración de WhatsApp guardada");
      await qc.invalidateQueries({ queryKey: qk.settings });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const checkWhatsApp = useMutation({
    mutationFn: () => invokeWhatsAppAction("check_connection"),
    onSuccess: async () => {
      toast.success("Conexión con WhatsApp verificada");
      await qc.invalidateQueries({ queryKey: qk.settings });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: qk.settings });
    },
  });

  const sendReport = useMutation({
    mutationFn: () => invokeWhatsAppAction("send_report_now"),
    onSuccess: async (result) => {
      toast.success(
        result.alreadySent
          ? (result.message ?? "El reporte diario ya fue enviado.")
          : "Reporte enviado por WhatsApp",
      );
      await qc.invalidateQueries({ queryKey: whatsAppHistoryKey });
    },
    onError: async (error: Error) => {
      toast.error(error.message);
      await qc.invalidateQueries({ queryKey: whatsAppHistoryKey });
    },
  });

  const retryWhatsApp = useMutation({
    mutationFn: (id: string) => invokeWhatsAppAction("retry", { id }),
    onSuccess: async () => {
      toast.success("Mensaje reenviado");
      await qc.invalidateQueries({ queryKey: whatsAppHistoryKey });
    },
    onError: async (error: Error) => {
      toast.error(error.message);
      await qc.invalidateQueries({ queryKey: whatsAppHistoryKey });
    },
  });

  const visibleUsers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-CL");
    if (!needle) return users;
    return users.filter((item) =>
      `${item.full_name ?? ""} ${item.email} ${ROLE_LABELS[item.role]}`
        .toLocaleLowerCase("es-CL")
        .includes(needle),
    );
  }, [users, search]);

  const createUser = () => {
    setEditing(null);
    setUserForm(emptyForm);
    setUserDialogOpen(true);
  };

  const editUser = (managedUser: ManagedUser) => {
    setEditing(managedUser);
    setUserForm({
      full_name: managedUser.full_name ?? "",
      email: managedUser.email,
      role: managedUser.role,
      is_active: managedUser.is_active,
    });
    setUserDialogOpen(true);
  };

  const saveUser = useMutation({
    mutationFn: async () => {
      if (!userForm.full_name.trim() || !userForm.email.trim())
        throw new Error("Completa el nombre y el correo.");
      if (editing) {
        const roleChanged = userForm.role !== editing.role;
        const statusChanged = userForm.is_active !== editing.is_active;
        if (
          (roleChanged || statusChanged) &&
          !confirm(
            `¿Confirmas ${!userForm.is_active ? "desactivar" : "actualizar"} la cuenta de ${editing.full_name || editing.email}?`,
          )
        )
          return false;
        await adminRequest("PATCH", { ...userForm, id: editing.id });
      } else {
        if (
          userForm.role === "admin" &&
          !confirm("¿Enviar una invitación con acceso completo de administrador?")
        )
          return false;
        await adminRequest("POST", userForm);
      }
      return true;
    },
    onSuccess: async (saved) => {
      if (saved === false) return;
      toast.success(editing ? "Usuario actualizado" : "Invitación enviada por correo");
      setUserDialogOpen(false);
      await qc.invalidateQueries({ queryKey: adminUsersKey });
      await qc.invalidateQueries({ queryKey: qk.profiles });
      router.invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPassword = useMutation({
    mutationFn: async (managedUser: ManagedUser) => {
      if (!confirm(`¿Enviar un enlace para restablecer la contraseña a ${managedUser.email}?`))
        return false;
      const { error } = await supabase.auth.resetPasswordForEmail(managedUser.email, {
        redirectTo: `${window.location.origin}/auth?mode=reset`,
      });
      if (error) throw new Error(error.message);
      return true;
    },
    onSuccess: (sent) => sent && toast.success("Se envió el enlace de recuperación."),
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePermission = useMutation({
    mutationFn: async ({
      role: targetRole,
      permission,
      allowed,
    }: {
      role: AppRole;
      permission: Permission;
      allowed: boolean;
    }) => {
      if (
        !confirm(
          `${allowed ? "Conceder" : "Revocar"} el permiso «${PERMISSIONS.find((item) => item.key === permission)?.label ?? permission}» para el rol ${ROLE_LABELS[targetRole]}?`,
        )
      )
        return false;
      const { error } = await supabase
        .from("role_permissions")
        .update({ allowed, updated_at: new Date().toISOString() })
        .eq("role", targetRole)
        .eq("permission", permission);
      if (error) throw new Error(error.message);
      return true;
    },
    onSuccess: async (changed) => {
      if (!changed) return;
      toast.success("Permisos actualizados");
      await qc.invalidateQueries({ queryKey: adminUsersKey });
      router.invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeUsers = users.filter((managedUser) => managedUser.is_active);
  const countRole = (target: AppRole) =>
    users.filter((managedUser) => managedUser.role === target).length;
  const permissionAllowed = (targetRole: AppRole, permission: string) =>
    adminData?.permissions.some(
      (row) => row.role === targetRole && row.permission === permission && row.allowed,
    ) ?? false;
  const profilesById = new Map(users.map((item) => [item.id, item.full_name || item.email]));

  return (
    <div className="space-y-6">
      <Tabs defaultValue="local" className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="local" className="gap-2">
            <Building2 className="size-4" /> Local
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="whatsapp" className="gap-2">
                <MessageCircle className="size-4" /> WhatsApp
              </TabsTrigger>
              <TabsTrigger value="users" className="gap-2">
                <Users className="size-4" /> Usuarios
              </TabsTrigger>
              <TabsTrigger value="permissions" className="gap-2">
                <ShieldCheck className="size-4" /> Permisos
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="local" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4" /> Datos del establecimiento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  save.mutate();
                }}
                className="space-y-4"
              >
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Identidad y ubicación</h3>
                    <p className="text-sm text-muted-foreground">
                      Información que identifica al negocio en Invenco.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="business-name">Nombre del establecimiento</Label>
                      <Input
                        id="business-name"
                        maxLength={120}
                        value={f.store_name}
                        onChange={(event) => setF({ ...f, store_name: event.target.value })}
                        disabled={!canManageSettings}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="business-address">Dirección</Label>
                      <Input
                        id="business-address"
                        value={f.address}
                        onChange={(event) => setF({ ...f, address: event.target.value })}
                        disabled={!canManageSettings}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="business-city">Ciudad</Label>
                      <Input
                        id="business-city"
                        value={f.city}
                        onChange={(event) => setF({ ...f, city: event.target.value })}
                        disabled={!canManageSettings}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="business-region">Región</Label>
                      <Input
                        id="business-region"
                        value={f.region}
                        onChange={(event) => setF({ ...f, region: event.target.value })}
                        disabled={!canManageSettings}
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <div>
                    <h3 className="text-sm font-semibold">Horario de atención</h3>
                    <p className="text-sm text-muted-foreground">
                      Define el horario habitual y los días en que abre el establecimiento.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="opening-time">Hora de apertura</Label>
                      <Input
                        id="opening-time"
                        type="time"
                        value={f.opening_time}
                        onChange={(event) => setF({ ...f, opening_time: event.target.value })}
                        disabled={!canManageSettings}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="closing-time">Hora de cierre</Label>
                      <Input
                        id="closing-time"
                        type="time"
                        value={f.closing_time}
                        onChange={(event) => setF({ ...f, closing_time: event.target.value })}
                        disabled={!canManageSettings}
                      />
                    </div>
                  </div>
                  <fieldset className="space-y-2 border-t pt-3">
                    <legend className="text-sm font-medium">Días de funcionamiento</legend>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                      {OPERATING_DAYS.map((day) => {
                        const checked = f.operating_days.includes(day.value);
                        return (
                          <label
                            key={day.value}
                            htmlFor={`operating-day-${day.value}`}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                          >
                            <Checkbox
                              id={`operating-day-${day.value}`}
                              checked={checked}
                              onCheckedChange={(value) =>
                                setF({
                                  ...f,
                                  operating_days: value
                                    ? [...f.operating_days, day.value]
                                    : f.operating_days.filter((item) => item !== day.value),
                                })
                              }
                              disabled={!canManageSettings}
                            />
                            {day.label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <div>
                    <h3 className="text-sm font-semibold">Preferencias del establecimiento</h3>
                    <p className="text-sm text-muted-foreground">
                      Configuración regional y estado operativo actual.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="business-currency">Moneda</Label>
                      <Input
                        id="business-currency"
                        value={`${f.currency} · Peso chileno`}
                        disabled
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="business-timezone">Zona horaria</Label>
                      <Input id="business-timezone" value={f.timezone} disabled />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="business-status">Estado del establecimiento</Label>
                      <Select
                        value={f.business_status}
                        onValueChange={(business_status) => setF({ ...f, business_status })}
                        disabled={!canManageSettings}
                      >
                        <SelectTrigger id="business-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="abierto">Abierto</SelectItem>
                          <SelectItem value="cerrado">Cerrado</SelectItem>
                          <SelectItem value="temporalmente_inactivo">
                            Temporalmente inactivo
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </section>
                {canManageSettings ? (
                  <div className="flex justify-end border-t pt-4">
                    <Button type="submit" disabled={save.isPending}>
                      {save.isPending ? "Guardando..." : "Guardar cambios"}
                    </Button>
                  </div>
                ) : (
                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      No tienes permiso para editar estos datos.
                    </p>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <>
            <TabsContent value="whatsapp" className="space-y-6">
              <section className="space-y-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <MessageCircle className="size-5 text-primary" /> Notificaciones WhatsApp
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Configura los reportes y alertas que recibe el propietario del establecimiento.
                  </p>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BellRing className="size-4" /> Preferencias y conexión
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-6"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveWhatsApp.mutate();
                      }}
                    >
                      <div className="grid gap-5 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="owner-whatsapp">WhatsApp del propietario</Label>
                          <Input
                            id="owner-whatsapp"
                            type="tel"
                            inputMode="tel"
                            placeholder="+56912345678"
                            value={whatsappForm.owner_whatsapp}
                            onChange={(event) =>
                              setWhatsappForm({
                                ...whatsappForm,
                                owner_whatsapp: event.target.value,
                              })
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            Incluye el código de país; por ejemplo, +56 para Chile.
                          </p>
                        </div>
                        <div className="flex flex-col justify-end gap-3 sm:flex-row sm:items-end">
                          <div className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                            <span
                              className={`size-2.5 rounded-full ${settings?.whatsapp_connected ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
                            />
                            <span>
                              {settings?.whatsapp_connected
                                ? "WhatsApp conectado"
                                : "Sin verificar"}
                            </span>
                            {settings?.whatsapp_last_check_at && (
                              <span className="text-xs text-muted-foreground">
                                ·{" "}
                                {new Date(settings.whatsapp_last_check_at).toLocaleString("es-CL")}
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={checkWhatsApp.isPending}
                            onClick={() => checkWhatsApp.mutate()}
                          >
                            <RefreshCw
                              className={`size-4 ${checkWhatsApp.isPending ? "animate-spin" : ""}`}
                            />
                            Verificar conexión
                          </Button>
                        </div>
                      </div>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-primary"
                          checked={whatsappForm.whatsapp_notifications_enabled}
                          onChange={(event) =>
                            setWhatsappForm({
                              ...whatsappForm,
                              whatsapp_notifications_enabled: event.target.checked,
                            })
                          }
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            Activar notificaciones WhatsApp
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Control general para los reportes automáticos y las alertas de
                            inventario.
                          </span>
                        </span>
                      </label>
                      {settings?.whatsapp_last_error && (
                        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          {settings.whatsapp_last_error}
                        </p>
                      )}

                      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-primary"
                            checked={whatsappForm.daily_report_enabled}
                            disabled={!whatsappForm.whatsapp_notifications_enabled}
                            onChange={(event) =>
                              setWhatsappForm({
                                ...whatsappForm,
                                daily_report_enabled: event.target.checked,
                              })
                            }
                          />
                          <span>
                            <span className="block text-sm font-medium">
                              Reporte diario automático
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Ventas, transacciones, ganancia estimada, productos destacados, mermas
                              y stock bajo.
                            </span>
                          </span>
                        </label>
                        <div className="space-y-2">
                          <Label htmlFor="daily-report-hour">Hora de envío (Chile)</Label>
                          <Select
                            value={String(whatsappForm.daily_report_hour)}
                            onValueChange={(value) =>
                              setWhatsappForm({ ...whatsappForm, daily_report_hour: Number(value) })
                            }
                          >
                            <SelectTrigger id="daily-report-hour" className="w-full sm:max-w-52">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, hour) => (
                                <SelectItem key={hour} value={String(hour)}>
                                  {String(hour).padStart(2, "0")}:00
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-primary"
                            checked={whatsappForm.inventory_alerts_enabled}
                            disabled={!whatsappForm.whatsapp_notifications_enabled}
                            onChange={(event) =>
                              setWhatsappForm({
                                ...whatsappForm,
                                inventory_alerts_enabled: event.target.checked,
                              })
                            }
                          />
                          <span>
                            <span className="block text-sm font-medium">Alertas de inventario</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Avisa una sola vez cuando un producto llega al mínimo o se agota.
                            </span>
                          </span>
                        </label>
                        <div className="space-y-2">
                          <Label htmlFor="expiry-alert-days">
                            Avisar vencimientos con anticipación
                          </Label>
                          <Select
                            value={String(whatsappForm.expiry_alert_days)}
                            onValueChange={(value) =>
                              setWhatsappForm({ ...whatsappForm, expiry_alert_days: Number(value) })
                            }
                          >
                            <SelectTrigger id="expiry-alert-days" className="w-full sm:max-w-52">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="3">3 días</SelectItem>
                              <SelectItem value="7">7 días</SelectItem>
                              <SelectItem value="15">15 días</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            sendReport.isPending ||
                            !whatsappForm.whatsapp_notifications_enabled ||
                            !whatsappForm.owner_whatsapp.trim()
                          }
                          onClick={() => sendReport.mutate()}
                        >
                          <Send className="size-4" />
                          {sendReport.isPending ? "Enviando reporte..." : "Enviar reporte ahora"}
                        </Button>
                        <Button type="submit" disabled={saveWhatsApp.isPending}>
                          {saveWhatsApp.isPending ? "Guardando..." : "Guardar configuración"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Clock3 className="size-4" /> Historial de notificaciones
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {whatsappHistoryQuery.isError && (
                      <p className="px-6 py-3 text-sm text-destructive">
                        No se pudo cargar el historial: {whatsappHistoryQuery.error.message}
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <Table className="min-w-[760px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fecha y hora</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Destinatario</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Mensaje</TableHead>
                            <TableHead className="text-right">Acción</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(whatsappHistoryQuery.data ?? []).map((notification) => (
                            <TableRow key={notification.id}>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {new Date(notification.created_at).toLocaleString("es-CL")}
                              </TableCell>
                              <TableCell className="text-sm font-medium">
                                {notificationTypeLabel(notification.notification_type)}
                              </TableCell>
                              <TableCell className="text-sm">{notification.recipient}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    notification.status === "sent"
                                      ? "outline"
                                      : notification.status === "failed"
                                        ? "destructive"
                                        : "secondary"
                                  }
                                >
                                  {notificationStatusLabel(notification.status)}
                                </Badge>
                                {notification.last_error && (
                                  <p className="mt-1 max-w-48 text-xs text-destructive">
                                    {notification.last_error}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell
                                className="max-w-72 truncate text-sm text-muted-foreground"
                                title={notification.message}
                              >
                                {notification.message}
                              </TableCell>
                              <TableCell className="text-right">
                                {notification.status === "failed" && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={retryWhatsApp.isPending}
                                    onClick={() => retryWhatsApp.mutate(notification.id)}
                                  >
                                    <RefreshCw className="size-3.5" /> Reintentar
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                          {!whatsappHistoryQuery.isLoading &&
                            !whatsappHistoryQuery.isError &&
                            !whatsappHistoryQuery.data?.length && (
                              <TableRow>
                                <TableCell
                                  colSpan={6}
                                  className="py-8 text-center text-sm text-muted-foreground"
                                >
                                  Aún no hay notificaciones registradas.
                                </TableCell>
                              </TableRow>
                            )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </section>
            </TabsContent>

            <TabsContent value="users" className="space-y-6">
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <Users className="size-5" /> Usuarios y roles
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Administra el acceso del equipo. Las invitaciones se envían al correo
                      indicado.
                    </p>
                  </div>
                  <Button onClick={createUser}>
                    <UserPlus className="size-4" /> Crear usuario
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <UserSummary
                    icon={<Users className="size-4" />}
                    label="Usuarios registrados"
                    value={users.length}
                  />
                  <UserSummary
                    icon={<UserCheck className="size-4" />}
                    label="Cuentas activas"
                    value={activeUsers.length}
                  />
                  <UserSummary
                    icon={<UserRoundX className="size-4" />}
                    label="Cuentas inactivas"
                    value={users.length - activeUsers.length}
                  />
                  <UserSummary
                    icon={<ShieldCheck className="size-4" />}
                    label="Administradores"
                    value={countRole("admin")}
                  />
                  <UserSummary
                    icon={<Users className="size-4" />}
                    label="Cajeros"
                    value={countRole("cajero")}
                  />
                  <UserSummary
                    icon={<Users className="size-4" />}
                    label="Consulta"
                    value={countRole("consulta")}
                  />
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Equipo del establecimiento</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="relative max-w-md">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="Buscar por nombre, correo o rol"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>
                    {usersQuery.isError && (
                      <p className="text-sm text-destructive">{usersQuery.error.message}</p>
                    )}
                    <div className="overflow-x-auto">
                      <Table className="min-w-[760px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Usuario</TableHead>
                            <TableHead>Rol</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Último acceso</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleUsers.map((managedUser) => (
                            <TableRow key={managedUser.id}>
                              <TableCell>
                                <p className="font-medium">
                                  {managedUser.full_name || "Sin nombre"}
                                  {managedUser.id === user.id && (
                                    <span className="ml-2 text-xs text-muted-foreground">(tú)</span>
                                  )}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {managedUser.email}
                                </p>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={managedUser.role === "admin" ? "default" : "secondary"}
                                >
                                  {ROLE_LABELS[managedUser.role]}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={managedUser.is_active ? "outline" : "destructive"}>
                                  {managedUser.is_active ? "Activo" : "Inactivo"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {managedUser.last_sign_in_at
                                  ? new Date(managedUser.last_sign_in_at).toLocaleString("es-CL")
                                  : "Sin acceso registrado"}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Editar usuario"
                                    onClick={() => editUser(managedUser)}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Enviar restablecimiento de contraseña"
                                    disabled={!managedUser.is_active || resetPassword.isPending}
                                    onClick={() => resetPassword.mutate(managedUser)}
                                  >
                                    <KeyRound className="size-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          {!usersQuery.isLoading && visibleUsers.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="py-10 text-center text-sm text-muted-foreground"
                              >
                                No se encontraron usuarios.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </section>
            </TabsContent>

            <TabsContent value="permissions" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="size-4" /> Permisos por rol
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    El administrador conserva acceso completo. Los cambios se verifican también en
                    Supabase.
                  </p>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Función</TableHead>
                        <TableHead className="text-center">Administrador</TableHead>
                        <TableHead className="text-center">Cajero</TableHead>
                        <TableHead className="text-center">Consulta</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PERMISSIONS.map((permission) => (
                        <TableRow key={permission.key}>
                          <TableCell>
                            <p className="font-medium">{permission.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {permission.description}
                            </p>
                          </TableCell>
                          {(["admin", "cajero", "consulta"] as AppRole[]).map((targetRole) => (
                            <TableCell key={targetRole} className="text-center">
                              <input
                                type="checkbox"
                                aria-label={`${permission.label}: ${ROLE_LABELS[targetRole]}`}
                                checked={
                                  targetRole === "admin" ||
                                  permissionAllowed(targetRole, permission.key)
                                }
                                disabled={
                                  targetRole === "admin" ||
                                  permission.key === "user_manage" ||
                                  togglePermission.isPending
                                }
                                onChange={(event) =>
                                  togglePermission.mutate({
                                    role: targetRole,
                                    permission: permission.key,
                                    allowed: event.target.checked,
                                  })
                                }
                                className="size-4 accent-primary disabled:cursor-not-allowed"
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="size-4" /> Historial de actividad
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[680px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha y hora</TableHead>
                          <TableHead>Responsable</TableHead>
                          <TableHead>Actividad</TableHead>
                          <TableHead>Detalle</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(adminData?.activity ?? []).map((activity) => (
                          <TableRow key={activity.id}>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="size-3" />{" "}
                                {new Date(activity.created_at).toLocaleString("es-CL")}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">
                              {activity.actor_id
                                ? (profilesById.get(activity.actor_id) ?? "Usuario")
                                : "Sistema"}
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {activityLabel(activity.action)}
                            </TableCell>
                            <TableCell
                              className="max-w-72 truncate text-sm text-muted-foreground"
                              title={activitySummary(activity.details)}
                            >
                              {activitySummary(activity.details)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {!adminData?.activity.length && (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="py-8 text-center text-sm text-muted-foreground"
                            >
                              Aún no hay actividad registrada.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar usuario" : "Invitar usuario"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Actualiza los datos, el rol o el estado de la cuenta."
                : "La persona recibirá un correo para activar su acceso."}
            </DialogDescription>
          </DialogHeader>
          <form
            id="managed-user-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveUser.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="managed-user-name">Nombre</Label>
              <Input
                id="managed-user-name"
                value={userForm.full_name}
                maxLength={120}
                required
                onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="managed-user-email">Correo electrónico</Label>
              <Input
                id="managed-user-email"
                type="email"
                value={userForm.email}
                required
                onChange={(event) => setUserForm({ ...userForm, email: event.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <Select
                  value={userForm.role}
                  disabled={editing?.id === user.id}
                  onValueChange={(value) => setUserForm({ ...userForm, role: value as AppRole })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="cajero">Cajero</SelectItem>
                    <SelectItem value="consulta">Consulta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing && (
                <div className="space-y-1.5">
                  <Label>Estado de cuenta</Label>
                  <Select
                    value={userForm.is_active ? "active" : "inactive"}
                    disabled={editing.id === user.id}
                    onValueChange={(value) =>
                      setUserForm({ ...userForm, is_active: value === "active" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Activo</SelectItem>
                      <SelectItem value="inactive">Inactivo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUserDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="managed-user-form" disabled={saveUser.isPending}>
              {saveUser.isPending
                ? "Guardando…"
                : editing
                  ? "Guardar cambios"
                  : "Enviar invitación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserSummary({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function activityLabel(action: string) {
  const labels: Record<string, string> = {
    user_invited: "Usuario invitado",
    user_updated: "Usuario actualizado",
    product_created: "Producto creado",
    product_updated: "Producto modificado",
    inventory_adjusted: "Ajuste de inventario",
    movement_in: "Entrada de inventario",
    movement_out: "Venta",
    movement_merma: "Merma registrada",
    movement_devolucion: "Devolución registrada",
  };
  return labels[action] ?? action.replaceAll("_", " ");
}

function activitySummary(details: Record<string, unknown>) {
  const product = typeof details["product_name"] === "string" ? details["product_name"] : "";
  const quantity =
    typeof details["quantity"] === "number" ? ` · Cantidad: ${details["quantity"]}` : "";
  const reason =
    typeof details["reason"] === "string" && details["reason"] ? ` · ${details["reason"]}` : "";
  const email = typeof details["email"] === "string" ? details["email"] : "";
  const role =
    typeof details["role"] === "string"
      ? ` · Rol: ${ROLE_LABELS[details["role"] as AppRole] ?? details["role"]}`
      : "";
  return `${product}${quantity}${reason}${email}${role}` || "—";
}
