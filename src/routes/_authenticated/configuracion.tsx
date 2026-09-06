import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { profilesQuery, qk, settingsQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth-context";
import type { AppRole } from "@/lib/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/configuracion")({
  head: () => ({ meta: [{ title: "Configuración — Invenco" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: settings } = useQuery(settingsQuery);
  const { data: profiles = [] } = useQuery(profilesQuery);
  const [f, setF] = useState({ store_name: "", address: "", city: "" });

  useEffect(() => {
    if (settings) setF({ store_name: settings.store_name, address: settings.address, city: settings.city });
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("settings").update(f).eq("id", 1);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Datos del local guardados");
      qc.invalidateQueries({ queryKey: qk.settings });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: AppRole }) => {
      const { error } = await supabase.rpc("set_user_role", { _user_id: id, _role: role });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Rol actualizado");
      qc.invalidateQueries({ queryKey: qk.profiles });
      router.invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> Datos del establecimiento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label>Nombre del local</Label>
              <Input value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} disabled={!isAdmin} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Dirección</Label>
                <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} disabled={!isAdmin} />
              </div>
              <div className="space-y-1.5">
                <Label>Ciudad</Label>
                <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} disabled={!isAdmin} />
              </div>
            </div>
            {isAdmin ? (
              <Button type="submit" disabled={save.isPending}>
                Guardar cambios
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Solo el administrador puede editar estos datos.</p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" /> Usuarios y roles
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="px-6 pb-3 text-xs text-muted-foreground">
            Los nuevos usuarios que se registren entran como <b>cajero</b> (Vender, Dashboard y Buscar). El administrador
            puede ascenderlos aquí.
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Rol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">
                      {p.full_name || p.email || "Sin nombre"}
                      {p.id === user.id && <span className="ml-2 text-xs text-muted-foreground">(tú)</span>}
                    </p>
                    {p.full_name && <p className="text-xs text-muted-foreground">{p.email}</p>}
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select
                        value={p.role ?? "cajero"}
                        onValueChange={(v) => setRole.mutate({ id: p.id, role: v as AppRole })}
                        disabled={p.id === user.id}
                      >
                        <SelectTrigger className="h-8 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="cajero">Cajero</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={p.role === "admin" ? "default" : "secondary"}>
                        {p.role === "admin" ? "Administrador" : "Cajero"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
