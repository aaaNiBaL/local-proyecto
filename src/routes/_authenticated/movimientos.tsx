import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, PackagePlus, Sparkles } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { categoriesQuery, movementsQuery, productsQuery, qk } from "@/lib/queries";
import { findByCode, fmtDateTime, money, num, qtyLabel } from "@/lib/inventory";
import { AdminOnly } from "@/components/AppShell";
import { ProductForm } from "@/components/ProductForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/movimientos")({
  head: () => ({ meta: [{ title: "Movimientos — Invenco" }] }),
  component: () => (
    <AdminOnly>
      <EntriesPage />
    </AdminOnly>
  ),
});

function EntriesPage() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery(productsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: movements = [] } = useQuery(movementsQuery(30));
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [newProduct, setNewProduct] = useState<string | null>(null);

  const found = findByCode(products, code);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.products });
    qc.invalidateQueries({ queryKey: qk.lots });
    qc.invalidateQueries({ queryKey: ["movements"] });
  };

  const entry = useMutation({
    mutationFn: async () => {
      if (!found) throw new Error("Producto no encontrado.");
      const n = num(qty);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Ingresa una cantidad válida.");
      const { error } = await supabase.rpc("register_entry", {
        _product_id: found.id,
        _qty: n,
        ...(expires ? { _expires_at: expires } : {}),
        ...(note.trim() ? { _note: note.trim() } : {}),
      });
      if (error) throw new Error(error.message);
      return { name: found.name, n, unit: found.unit };
    },
    onSuccess: (r) => {
      toast.success(`Entrada: ${r.name} +${qtyLabel(r.n, r.unit)}`);
      setCode("");
      setQty("");
      setExpires("");
      setNote("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const demo = useMutation({
    mutationFn: async () => {
      const cat = (n: string) => categories.find((c) => c.name === n)?.id ?? null;
      const d = (days: number) => {
        const x = new Date();
        x.setDate(x.getDate() + days);
        return x.toISOString().slice(0, 10);
      };
      const rows = [
        { name: "Pan batido", unit: "kilo", keyword: "pa", price: 3900, cost: 2400, stock: 8, min_stock: 2, cat: "Panadería", exp: d(1) },
        { name: "Marraqueta", unit: "kilo", keyword: "m", price: 3600, cost: 2200, stock: 6, min_stock: 2, cat: "Panadería", exp: d(1) },
        { name: "Coca Cola 1.5L", unit: "unidad", code: "7801610000561", price: 1800, cost: 1250, stock: 24, min_stock: 6, cat: "Bebidas", exp: d(120) },
        { name: "Leche entera 1L", unit: "unidad", code: "7802200119121", price: 1200, cost: 850, stock: 30, min_stock: 10, cat: "Lácteos", exp: d(6) },
        { name: "Yogurt frutilla", unit: "unidad", code: "7802200550012", price: 650, cost: 420, stock: 12, min_stock: 6, cat: "Lácteos", exp: d(2) },
        { name: "Jamón de pavo 250g", unit: "unidad", code: "7802910011224", price: 2990, cost: 2100, stock: 8, min_stock: 3, cat: "Friver", exp: d(4) },
        { name: "Azúcar 1kg", unit: "unidad", code: "7802200001234", price: 1500, cost: 1100, stock: 12, min_stock: 4, cat: "Abarrotes", exp: d(365) },
        { name: "Aceite 1L", unit: "unidad", code: "7802110000456", price: 2500, cost: 1900, stock: 3, min_stock: 5, cat: "Abarrotes", exp: d(300) },
        { name: "Manzana", unit: "kilo", keyword: "ma", price: 2500, cost: 1500, stock: 5, min_stock: 2, cat: "Friver", exp: d(9) },
        { name: "Naranja", unit: "kilo", keyword: "n", price: 2200, cost: 1300, stock: 6, min_stock: 2, cat: "Friver", exp: d(12) },
        { name: "Cloro 1L", unit: "unidad", code: "7801234000001", price: 1390, cost: 900, stock: 10, min_stock: 3, cat: "Aseo", exp: null },
        { name: "Bolsas camiseta x100", unit: "unidad", code: "INS-001", price: 0, cost: 2500, stock: 5, min_stock: 2, cat: null, exp: null, nature: "empaque" as const },
      ];
      let created = 0;
      for (const r of rows) {
        if (findByCode(products, r.code ?? r.keyword ?? "")) continue;
        const { data, error } = await supabase
          .from("products")
          .insert({
            name: r.name,
            unit: r.unit as "unidad" | "kilo",
            code: r.code ?? null,
            keyword: r.keyword ?? null,
            price: r.price || 1,
            cost: r.cost,
            min_stock: r.min_stock,
            category_id: r.cat ? cat(r.cat) : null,
            nature: r.nature ?? "consumible",
          })
          .select()
          .single();
        if (error) continue;
        await supabase.rpc("register_entry", {
          _product_id: data.id,
          _qty: r.stock,
          ...(r.exp ? { _expires_at: r.exp } : {}),
          _note: "Carga de prueba",
        });
        const saleQty = r.unit === "kilo" ? 1.2 : 2;
        await supabase.rpc("register_sale", {
          _product_id: data.id,
          _qty: saleQty,
          _amount: Math.round(saleQty * (r.price || 1)),
        });
        created++;
      }
      return created;
    },
    onSuccess: (n) => {
      toast[n ? "success" : "info"](n ? `Se cargaron ${n} productos de prueba.` : "Los productos de prueba ya existen.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = movements.filter((m) => m.type === "in").slice(0, 20);

  const exportMovements = () => {
    const rows = movements.map((m) => ({
      Fecha: m.ts ? new Date(m.ts).toLocaleString("es-CL") : "",
      Tipo: m.type === "in" ? "Entrada" : "Salida",
      Producto: m.product_name,
      Cantidad: Number(m.qty),
      Unidad: m.unit,
      Nota: m.note ?? "",
      Monto: Number(m.amount ?? m.cost_amount ?? 0),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos");
    XLSX.writeFile(workbook, "movimientos.xlsx");
    toast.success("Excel exportado");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <PackagePlus className="size-4" /> Recepción de mercadería
            </CardTitle>
            <Button variant="outline" size="sm" onClick={exportMovements}>
              <Download className="size-4" /> Exportar Excel
            </Button>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!found) {
                  setNewProduct(code.trim());
                  return;
                }
                entry.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="code">Código de barras o palabra clave</Label>
                <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Escanea o escribe" autoFocus />
                {code.trim() && (
                  <p className="text-sm text-muted-foreground">
                    {found
                      ? `${found.name} · stock actual ${qtyLabel(Number(found.stock), found.unit)}`
                      : "Producto nuevo: al continuar se pedirán sus datos."}
                  </p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="qty">Cantidad recibida {found?.unit === "kilo" ? "(kg)" : "(unidades)"}</Label>
                  <Input id="qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exp">Fecha de vencimiento del lote</Label>
                  <Input id="exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note">Lote / proveedor (opcional)</Label>
                <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Lote A-23, Distribuidora Sur" />
              </div>
              <Button type="submit" disabled={entry.isPending} className="w-full sm:w-auto">
                {found ? "Registrar entrada" : "Continuar"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Datos de prueba</p>
              <p className="text-xs text-muted-foreground">Crea 12 productos con lotes, vencimientos y ventas de ejemplo.</p>
            </div>
            <Button variant="outline" onClick={() => demo.mutate()} disabled={demo.isPending}>
              <Sparkles className="size-4" /> {demo.isPending ? "Cargando…" : "Cargar productos de prueba"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Últimas entradas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Aún no hay entradas registradas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateTime(m.ts)}</TableCell>
                    <TableCell className="font-medium">
                      {m.product_name}
                      {m.note && <p className="text-xs font-normal text-muted-foreground">{m.note}</p>}
                    </TableCell>
                    <TableCell>{qtyLabel(Number(m.qty), m.unit)}</TableCell>
                    <TableCell className="text-right">{money(Number(m.cost_amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProductForm
        open={newProduct !== null}
        onOpenChange={(o) => !o && setNewProduct(null)}
        initialCode={newProduct ?? ""}
        onSaved={() => {
          setCode("");
          setQty("");
        }}
      />
    </div>
  );
}
