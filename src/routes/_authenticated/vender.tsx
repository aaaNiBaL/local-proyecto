import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ScanLine, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { movementsQuery, productsQuery, qk } from "@/lib/queries";
import { effectivePrice, findByCode, money, parseSale, qtyLabel, rangeStart } from "@/lib/inventory";
import { Kpi } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/vender")({
  head: () => ({ meta: [{ title: "Vender — Invenco" }] }),
  component: SellPage,
});

function SellPage() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery(productsQuery);
  const { data: movements = [] } = useQuery(movementsQuery(2));
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => {
    const code = value.trim().split(/[\s*x×]+/i)[0] ?? "";
    return code ? findByCode(products, code) : undefined;
  }, [value, products]);

  const today = useMemo(() => {
    const from = rangeStart("day").getTime();
    const sales = movements.filter((m) => m.type === "out" && new Date(m.ts).getTime() >= from);
    return { count: sales.length, total: sales.reduce((s, m) => s + Number(m.amount), 0) };
  }, [movements]);

  const sell = useMutation({
    mutationFn: async () => {
      const res = parseSale(value, products);
      if (!res.ok) throw new Error(res.error);
      const { error } = await supabase.rpc("register_sale", {
        _product_id: res.product.id,
        _qty: res.qty,
        _amount: res.amount,
      });
      if (error) throw new Error(error.message);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Vendido: ${res.product.name} — ${qtyLabel(res.qty, res.product.unit)} por ${money(res.amount)}`);
      setValue("");
      qc.invalidateQueries({ queryKey: qk.products });
      qc.invalidateQueries({ queryKey: qk.lots });
      qc.invalidateQueries({ queryKey: ["movements"] });
      inputRef.current?.focus();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      inputRef.current?.select();
    },
  });

  const recent = movements.filter((m) => m.type === "out").slice(0, 15);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <Kpi label="Ventas de hoy" value={money(today.total)} sub={`${today.count} transacciones`} tone="good" />
          <Kpi label="Productos activos" value={products.filter((p) => p.active).length} sub="en catálogo" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="size-4" /> Pasar producto
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sell.mutate();
              }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Escanea el código o escribe clave + monto (ej: p 1500)"
                className="h-12 text-lg"
                autoComplete="off"
              />
              <Button type="submit" size="lg" disabled={sell.isPending}>
                Vender
              </Button>
            </form>

            <div className="min-h-12 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              {preview ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold">{preview.name}</span>
                  <span className="text-muted-foreground">
                    {money(effectivePrice(preview))} / {preview.unit === "kilo" ? "kg" : "un"}
                  </span>
                  <span className="text-muted-foreground">Stock: {qtyLabel(Number(preview.stock), preview.unit)}</span>
                  {preview.discount_pct > 0 && (
                    <Badge className="gap-1 bg-accent text-accent-foreground hover:bg-accent">
                      <Tag className="size-3" /> -{preview.discount_pct}% flash
                    </Badge>
                  )}
                </div>
              ) : value.trim() ? (
                <span className="text-muted-foreground">Sin coincidencias todavía…</span>
              ) : (
                <span className="text-muted-foreground">El producto aparecerá aquí al escanear.</span>
              )}
            </div>

            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              <p className="mb-2 font-medium text-foreground">Cómo se usa</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Escanea el código de barras: descuenta 1 unidad.</li>
                <li>
                  Varias unidades: <code className="rounded bg-muted px-1">7801234567890 x3</code>
                </li>
                <li>
                  A granel (pan, frutas): clave + monto cobrado, ej. <code className="rounded bg-muted px-1">p 1500</code>.
                  Los kilos se calculan con el precio por kilo.
                </li>
                <li>
                  Si dos productos parten con la misma letra, usa 2 letras: <code className="rounded bg-muted px-1">pa 4</code>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Últimas transacciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Aún no hay ventas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.product_name}
                      {m.discount_pct > 0 && (
                        <span className="ml-2 text-xs text-accent-foreground/80">-{m.discount_pct}%</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{qtyLabel(Number(m.qty), m.unit)}</TableCell>
                    <TableCell className="text-right">{money(Number(m.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
