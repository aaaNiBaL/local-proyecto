import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag, Trash2, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lotsQuery, movementsQuery, productsQuery, qk } from "@/lib/queries";
import {
  daysUntil,
  effectivePrice,
  expiryStatus,
  fmtDate,
  money,
  num,
  qtyLabel,
  type ExpiryStatus,
  type Lot,
  type Product,
} from "@/lib/inventory";
import { AdminOnly, Kpi } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/vencimientos")({
  head: () => ({ meta: [{ title: "Vencimientos & Mermas — Invenco" }] }),
  component: () => (
    <AdminOnly>
      <ExpiryPage />
    </AdminOnly>
  ),
});

const STATUS: Record<ExpiryStatus, { label: string; cls: string; dot: string }> = {
  vencido: { label: "Vencido", cls: "bg-destructive text-destructive-foreground", dot: "bg-destructive" },
  critico: { label: "Crítico", cls: "bg-destructive/15 text-destructive", dot: "bg-destructive" },
  proximo: { label: "Próximo", cls: "bg-accent/30 text-accent-foreground", dot: "bg-accent" },
  ok: { label: "OK", cls: "bg-primary/10 text-primary", dot: "bg-primary" },
  "sin-fecha": { label: "Sin fecha", cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

function ExpiryPage() {
  const qc = useQueryClient();
  const { data: lots = [] } = useQuery(lotsQuery);
  const { data: products = [] } = useQuery(productsQuery);
  const { data: movements = [] } = useQuery(movementsQuery(30));
  const [filter, setFilter] = useState<"alerta" | "todos">("alerta");
  const [waste, setWaste] = useState<{ lot: Lot; product: Product } | null>(null);
  const [wasteQty, setWasteQty] = useState("");

  const rows = useMemo(() => {
    const withP = lots
      .map((l) => ({ lot: l, product: products.find((p) => p.id === l.product_id), status: expiryStatus(l.expires_at) }))
      .filter((r): r is { lot: Lot; product: Product; status: ExpiryStatus } => !!r.product);
    const order: ExpiryStatus[] = ["vencido", "critico", "proximo", "ok", "sin-fecha"];
    withP.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (daysUntil(a.lot.expires_at) ?? 9e9) - (daysUntil(b.lot.expires_at) ?? 9e9));
    return filter === "alerta" ? withP.filter((r) => ["vencido", "critico", "proximo"].includes(r.status)) : withP;
  }, [lots, products, filter]);

  const counts = useMemo(() => {
    const all = lots.map((l) => expiryStatus(l.expires_at));
    return {
      vencido: all.filter((s) => s === "vencido").length,
      critico: all.filter((s) => s === "critico").length,
      proximo: all.filter((s) => s === "proximo").length,
    };
  }, [lots]);

  const mermaMes = movements.filter((m) => m.type === "merma").reduce((s, m) => s + Number(m.cost_amount), 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.products });
    qc.invalidateQueries({ queryKey: qk.lots });
    qc.invalidateQueries({ queryKey: ["movements"] });
  };

  const discount = useMutation({
    mutationFn: async ({ product, pctValue }: { product: Product; pctValue: number }) => {
      const { error } = await supabase.from("products").update({ discount_pct: pctValue }).eq("id", product.id);
      if (error) throw new Error(error.message);
      return { product, pctValue };
    },
    onSuccess: ({ product, pctValue }) => {
      toast.success(pctValue ? `Descuento flash -${pctValue}% en ${product.name}` : `Descuento quitado de ${product.name}`);
      qc.invalidateQueries({ queryKey: qk.products });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registerWaste = useMutation({
    mutationFn: async () => {
      if (!waste) return;
      const q = num(wasteQty);
      if (!Number.isFinite(q) || q <= 0) throw new Error("Cantidad inválida.");
      const { error } = await supabase.rpc("register_waste", { _lot_id: waste.lot.id, _qty: q, _note: "Merma por vencimiento" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Merma registrada");
      setWaste(null);
      setWasteQty("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Vencidos" value={counts.vencido} tone={counts.vencido ? "danger" : "default"} sub="retirar de venta" />
        <Kpi label="Críticos (≤ 3 días)" value={counts.critico} tone={counts.critico ? "danger" : "default"} sub="liquidar hoy" />
        <Kpi label="Próximos (≤ 10 días)" value={counts.proximo} tone={counts.proximo ? "warn" : "default"} sub="aplicar descuento" />
        <Kpi label="Mermas últimos 30 días" value={money(mermaMes)} sub="costo perdido" />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Lotes</CardTitle>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["alerta", "todos"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  filter === f ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                )}
              >
                {f === "alerta" ? "En alerta" : "Todos"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estado</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead className="text-right">Restante</TableHead>
                <TableHead className="text-right">Precio actual</TableHead>
                <TableHead>Descuento flash</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {filter === "alerta" ? "No hay lotes en alerta. ¡Bien!" : "No hay lotes con stock."}
                  </TableCell>
                </TableRow>
              )}
              {rows.map(({ lot, product, status }) => {
                const d = daysUntil(lot.expires_at);
                const st = STATUS[status];
                return (
                  <TableRow key={lot.id}>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>
                        <span className={cn("size-1.5 rounded-full", st.dot)} /> {st.label}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {product.name}
                      {lot.note && <p className="text-xs font-normal text-muted-foreground">{lot.note}</p>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {lot.expires_at ? fmtDate(lot.expires_at) : "—"}
                      {d !== null && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({d < 0 ? `hace ${-d} d` : d === 0 ? "hoy" : `en ${d} d`})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{qtyLabel(Number(lot.qty), product.unit)}</TableCell>
                    <TableCell className="text-right">
                      {money(effectivePrice(product))}
                      {product.discount_pct > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground line-through">{money(Number(product.price))}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {[20, 30].map((v) => (
                          <Button
                            key={v}
                            size="sm"
                            variant={product.discount_pct === v ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => discount.mutate({ product, pctValue: product.discount_pct === v ? 0 : v })}
                          >
                            <Zap className="size-3" /> -{v}%
                          </Button>
                        ))}
                        {product.discount_pct > 0 && ![20, 30].includes(product.discount_pct) && (
                          <Badge variant="secondary">
                            <Tag className="mr-1 size-3" /> -{product.discount_pct}%
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => {
                          setWaste({ lot, product });
                          setWasteQty(String(Number(lot.qty)));
                        }}
                      >
                        <Trash2 className="size-3" /> Merma
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!waste} onOpenChange={(o) => !o && setWaste(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar merma</DialogTitle>
          </DialogHeader>
          {waste && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                registerWaste.mutate();
              }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                {waste.product.name} · lote con {qtyLabel(Number(waste.lot.qty), waste.product.unit)} restantes.
              </p>
              <div className="space-y-1.5">
                <Label>Cantidad a dar de baja ({waste.product.unit === "kilo" ? "kg" : "un"})</Label>
                <Input inputMode="decimal" value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} autoFocus />
              </div>
              <p className="text-xs text-muted-foreground">
                Costo estimado de la pérdida: {money(num(wasteQty || "0") * Number(waste.product.cost))}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setWaste(null)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={registerWaste.isPending}>
                  Dar de baja
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
