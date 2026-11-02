import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { categoriesQuery, productsQuery, qk } from "@/lib/queries";
import { money, NATURES, natureLabel, qtyLabel, type Product } from "@/lib/inventory";
import { useAuth } from "@/lib/auth-context";
import { ProductForm } from "@/components/ProductForm";
import { Kpi } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/inventarios")({
  head: () => ({ meta: [{ title: "Inventarios — Invenco" }] }),
  component: InventoryPage,
});

function InventoryPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: products = [] } = useQuery(productsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [nature, setNature] = useState("all");
  const [avail, setAvail] = useState("all");
  const [form, setForm] = useState<{ open: boolean; product?: Product | null }>({ open: false });

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => {
      if (s && !`${p.name} ${p.code ?? ""} ${p.keyword ?? ""}`.toLowerCase().includes(s)) return false;
      if (cat !== "all" && p.category_id !== cat) return false;
      if (nature !== "all" && p.nature !== nature) return false;
      const low = Number(p.stock) <= Number(p.min_stock);
      if (avail === "low" && !low) return false;
      if (avail === "out" && Number(p.stock) > 0) return false;
      if (avail === "ok" && low) return false;
      return true;
    });
  }, [products, q, cat, nature, avail]);

  const remove = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase.from("products").delete().eq("id", p.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Producto eliminado");
      qc.invalidateQueries({ queryKey: qk.products });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportInventory = () => {
    const rows = list.map((p) => ({
      Producto: p.name,
      Codigo: p.code ?? "",
      Categoria: catName(p.category_id),
      Naturaleza: natureLabel(p.nature),
      Precio: Number(p.price),
      Stock: Number(p.stock),
      Minimo: Number(p.min_stock),
      Unidad: p.unit,
      Activo: p.active ? "Sí" : "No",
      "Valor total": Number(p.stock) * Number(p.price),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
    XLSX.writeFile(workbook, "inventario.xlsx");
    toast.success("Excel exportado");
  };

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";
  const lowCount = products.filter((p) => Number(p.stock) <= Number(p.min_stock)).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Productos" value={products.length} sub={`${products.filter((p) => p.active).length} activos`} />
        <Kpi label="Bajo mínimo" value={lowCount} tone={lowCount ? "warn" : "default"} sub="con alerta" />
        <Kpi
          label="Valor a precio venta"
          value={money(products.reduce((s, p) => s + Number(p.stock) * Number(p.price), 0))}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre, código o clave"
            className="w-full sm:w-64"
          />
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={nature} onValueChange={setNature}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda naturaleza</SelectItem>
              {NATURES.map((n) => (
                <SelectItem key={n.value} value={n.value}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={avail} onValueChange={setAvail}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo el stock</SelectItem>
              <SelectItem value="ok">Disponible</SelectItem>
              <SelectItem value="low">Bajo mínimo</SelectItem>
              <SelectItem value="out">Agotado</SelectItem>
            </SelectContent>
          </Select>
          <Button className="ml-auto" variant="outline" onClick={exportInventory}>
            <Download className="size-4" /> Exportar Excel
          </Button>
          {isAdmin && (
            <Button onClick={() => setForm({ open: true, product: null })}>
              <Plus className="size-4" /> Nuevo producto
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Código / clave</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Naturaleza</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                {isAdmin && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    No hay productos que coincidan.
                  </TableCell>
                </TableRow>
              )}
              {list.map((p) => {
                const low = Number(p.stock) <= Number(p.min_stock);
                return (
                  <TableRow key={p.id} className={!p.active ? "opacity-50" : ""}>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.discount_pct > 0 && (
                        <Badge className="ml-2 bg-accent text-accent-foreground hover:bg-accent">-{p.discount_pct}%</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.code || "—"}
                      {p.keyword && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans">{p.keyword}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{catName(p.category_id)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{natureLabel(p.nature)}</TableCell>
                    <TableCell className="text-right">
                      {money(Number(p.price))}
                      <span className="text-xs text-muted-foreground">/{p.unit === "kilo" ? "kg" : "un"}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={Number(p.stock) <= 0 ? "destructive" : low ? "secondary" : "outline"}>
                        {qtyLabel(Number(p.stock), p.unit)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {qtyLabel(Number(p.min_stock), p.unit)}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setForm({ open: true, product: p })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm(`¿Eliminar ${p.name}?`)) remove.mutate(p);
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductForm open={form.open} onOpenChange={(o) => setForm((s) => ({ ...s, open: o }))} product={form.product ?? null} />
    </div>
  );
}
