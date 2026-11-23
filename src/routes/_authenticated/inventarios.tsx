import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  ChartNoAxesCombined,
  Download,
  FileText,
  Pencil,
  Plus,
  ScanBarcode,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import {
  categoriesQuery,
  inventoryAdjustmentsQuery,
  lotsQuery,
  productsQuery,
  qk,
} from "@/lib/queries";
import { expiryStatus, money, NATURES, natureLabel, qtyLabel, type Product } from "@/lib/inventory";
import { addPdfPageChrome, addPdfSectionHeading, addPdfSummaryCards, pdfColors } from "@/lib/pdf";
import { useAuth } from "@/lib/auth-context";
import { ProductForm } from "@/components/ProductForm";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Kpi } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/inventarios")({
  head: () => ({ meta: [{ title: "Inventarios — Invenco" }] }),
  component: InventoryPage,
});

function InventoryPage() {
  const { hasPermission, isAdmin } = useAuth();
  const canManageProducts = hasPermission("products_manage");
  const canManageStock = hasPermission("stock_manage");
  const canViewAdjustments = hasPermission("movements_view");
  const qc = useQueryClient();
  const { data: products = [] } = useQuery(productsQuery);
  const { data: lots = [] } = useQuery(lotsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: adjustments = [] } = useQuery({
    ...inventoryAdjustmentsQuery(),
    enabled: canViewAdjustments,
  });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [nature, setNature] = useState("all");
  const [avail, setAvail] = useState("all");
  const [form, setForm] = useState<{ open: boolean; product?: Product | null; initialCode?: string }>(
    { open: false },
  );
  const [scannerOpen, setScannerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [adjustmentQty, setAdjustmentQty] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");

  const discountEligibleProductIds = useMemo(() => {
    const expiredProductIds = new Set(
      lots
        .filter((lot) => Number(lot.qty) > 0 && expiryStatus(lot.expires_at) === "vencido")
        .map((lot) => lot.product_id),
    );
    return new Set(
      lots
        .filter(
          (lot) =>
            Number(lot.qty) > 0 &&
            ["critico", "proximo"].includes(expiryStatus(lot.expires_at)) &&
            !expiredProductIds.has(lot.product_id),
        )
        .map((lot) => lot.product_id),
    );
  }, [lots]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => {
      if (
        s &&
        !`${p.name} ${p.code ?? ""} ${p.keyword ?? ""} ${p.supplier ?? ""} ${p.location ?? ""}`
          .toLowerCase()
          .includes(s)
      )
        return false;
      if (cat !== "all" && p.category_id !== cat) return false;
      if (nature !== "all" && p.nature !== nature) return false;
      const low = Number(p.stock) <= Number(p.min_stock);
      if (avail === "low" && !low) return false;
      if (avail === "out" && Number(p.stock) > 0) return false;
      if (avail === "ok" && low) return false;
      return true;
    });
  }, [products, q, cat, nature, avail]);

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedList = useMemo(
    () => list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [list, currentPage],
  );
  const resetPage = (s: string) => {
    setQ(s);
    setPage(1);
  };

  /** Flujo de escaneo: busca el código en Supabase y decide editar o crear. */
  const handleScanDetect = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    setScannerOpen(false);
    const { data: found, error } = await supabase
      .from("products")
      .select("*")
      .or(`code.eq.${code},keyword.eq.${code.toLowerCase()}`)
      .limit(1)
      .maybeSingle();
    if (error) {
      toast.error("No se pudo buscar el código en Supabase.");
      return;
    }
    if (found) {
      toast.info(`PRODUCTO EXISTENTE: ${found.name}`);
      setForm({ open: true, product: found as Product });
    } else {
      toast.info(`PRODUCTO NUEVO — código ${code} precargado.`);
      setForm({ open: true, product: null, initialCode: code });
    }
  };

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

  const adjustStock = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error("Solo administradores pueden ajustar el inventario.");
      if (!adjusting) throw new Error("Selecciona un producto.");
      const delta = Number(adjustmentQty.replace(",", "."));
      if (!Number.isFinite(delta) || delta === 0)
        throw new Error("Ingresa una cantidad distinta de cero.");
      if (!adjustmentReason.trim()) throw new Error("La razón del ajuste es obligatoria.");
      if (adjusting.stock + delta < 0)
        throw new Error("El ajuste no puede dejar el stock negativo.");
      const { error } = await supabase.rpc("adjust_inventory", {
        _product_id: adjusting.id,
        _quantity_delta: delta,
        _reason: adjustmentReason.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Ajuste de inventario registrado.");
      setAdjusting(null);
      setAdjustmentQty("");
      setAdjustmentReason("");
      qc.invalidateQueries({ queryKey: qk.products });
      qc.invalidateQueries({ queryKey: qk.lots });
      qc.invalidateQueries({ queryKey: qk.inventoryAdjustments });
      qc.invalidateQueries({ queryKey: qk.inventoryStockAudit });
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
      CostoCompra: Number(p.cost),
      MargenGanancia:
        Number(p.price) > 0
          ? `${(((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100).toFixed(1)}%`
          : "",
      Proveedor: p.supplier ?? "",
      Ubicacion: p.location ?? "",
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

  const exportInventoryPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const lowStock = list.filter((product) => Number(product.stock) <= Number(product.min_stock));

    addPdfSummaryCards(doc, 40, [
      { label: "Productos", value: String(list.length) },
      { label: "Activos", value: String(list.filter((product) => product.active).length) },
      { label: "Bajo mínimo", value: String(lowStock.length) },
      {
        label: "Valor a precio venta",
        value: money(
          list.reduce((total, product) => total + Number(product.stock) * Number(product.price), 0),
        ),
      },
    ]);

    const startY = addPdfSectionHeading(
      doc,
      "Listado de inventario",
      "Productos según los filtros aplicados en pantalla.",
      70,
    );

    autoTable(doc, {
      startY,
      margin: { top: 40, bottom: 20, left: 14, right: 14 },
      head: [
        [
          "Producto",
          "Categoría",
          "Precio venta",
          "Costo / margen",
          "Proveedor / ubicación",
          "Stock disponible",
        ],
      ],
      body: list.length
        ? list.map((product) => {
            const price = Number(product.price);
            const margin = price > 0 ? ((price - Number(product.cost)) / price) * 100 : null;
            const stock = Number(product.stock);
            const minimum = Number(product.min_stock);
            const status = !product.active
              ? "Inactivo"
              : stock <= 0
                ? "Agotado"
                : stock <= minimum
                  ? "Reponer"
                  : "Disponible";

            return [
              `${product.name}\nCódigo: ${product.code || product.keyword || "Sin código"}`,
              `${catName(product.category_id)}\n${natureLabel(product.nature)}`,
              `${money(price)} /${product.unit === "kilo" ? "kg" : "un"}`,
              `${money(Number(product.cost))}\n${margin === null ? "Sin margen" : margin < 0 ? "Pérdida" : `Margen ${margin.toFixed(1)}%`}`,
              `${product.supplier || "Sin proveedor"}\n${product.location || "Sin ubicación"}`,
              `${qtyLabel(stock, product.unit)}\nMínimo: ${qtyLabel(minimum, product.unit)}\n${status}`,
            ];
          })
        : [["No hay productos para exportar", "", "", "", "", ""]],
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 7,
        cellPadding: 2,
        textColor: pdfColors.text,
        lineColor: pdfColors.border,
        lineWidth: 0.15,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: pdfColors.primary,
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: pdfColors.alternate },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 37 },
        2: { cellWidth: 28 },
        3: { cellWidth: 35 },
        4: { cellWidth: 48 },
        5: { cellWidth: 73 },
      },
    });

    addPdfPageChrome(doc, "Inventario", `Productos incluidos: ${list.length}`);
    doc.save("inventario.pdf");
    toast.success("PDF exportado");
  };

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";
  const lowCount = products.filter((p) => Number(p.stock) <= Number(p.min_stock)).length;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold uppercase tracking-tight sm:text-3xl">
              Gestión de productos
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Escanea, registra y edita tu inventario.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            {canManageProducts && (
              <Button size="lg" className="h-12 px-6 text-base font-bold uppercase" onClick={() => setScannerOpen(true)}>
                <ScanBarcode className="size-5" /> Escanear producto
              </Button>
            )}
            <Button variant="outline" onClick={exportInventory}>
              <Download className="size-4" /> Excel
            </Button>
            <Button variant="outline" onClick={exportInventoryPdf}>
              <FileText className="size-4" /> PDF
            </Button>
            {canManageProducts && (
              <Button variant="secondary" size="lg" className="h-12 px-5 font-semibold" onClick={() => setForm({ open: true, product: null })}>
                <Plus className="size-5" /> Nuevo
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi
          label="Productos"
          value={products.length}
          icon={Boxes}
          sub={`${products.filter((p) => p.active).length} activos`}
        />
        <Kpi
          label="Bajo mínimo"
          value={lowCount}
          icon={AlertTriangle}
          tone={lowCount ? "warn" : "default"}
          sub="requieren reposición"
        />
        <Kpi
          label="Valor a precio venta"
          value={money(products.reduce((s, p) => s + Number(p.stock) * Number(p.price), 0))}
          icon={ChartNoAxesCombined}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Input
            value={q}
            onChange={(e) => resetPage(e.target.value)}
            placeholder="Buscar por nombre o código…"
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[1040px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="uppercase">Producto</TableHead>
                  <TableHead className="uppercase">Categoría</TableHead>
                  <TableHead className="text-right uppercase">Precio venta</TableHead>
                  <TableHead className="text-right uppercase">Costo / margen</TableHead>
                  <TableHead className="uppercase">Proveedor / ubicación</TableHead>
                  <TableHead className="uppercase">Stock disponible</TableHead>
                  {(canManageProducts || canManageStock) && (
                    <TableHead className="w-32 text-right uppercase">Acciones</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={canManageProducts || canManageStock ? 7 : 6}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No hay productos que coincidan.
                    </TableCell>
                  </TableRow>
                )}
                {pagedList.map((p) => {
                  const low = Number(p.stock) <= Number(p.min_stock);
                  const out = Number(p.stock) <= 0;
                  const margin =
                    Number(p.price) > 0
                      ? ((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100
                      : null;
                  return (
                    <TableRow key={p.id} className={!p.active ? "opacity-50" : "hover:bg-muted/40"}>
                      <TableCell className="max-w-56 py-4">
                        <p className="truncate font-semibold text-foreground" title={p.name}>
                          {p.name}
                        </p>
                        <p
                          className="mt-1 truncate font-mono text-xs text-muted-foreground"
                          title={p.code || p.keyword || undefined}
                        >
                          {p.code || p.keyword || "Sin código"}
                        </p>
                        {p.discount_pct > 0 && discountEligibleProductIds.has(p.id) && (
                          <Badge className="mt-1 bg-accent text-accent-foreground hover:bg-accent">
                            -{p.discount_pct}%
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="min-w-36">
                        <p className="font-medium">{catName(p.category_id)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {natureLabel(p.nature)}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="whitespace-nowrap font-medium">
                          {money(Number(p.price))}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          /{p.unit === "kilo" ? "kg" : "un"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="whitespace-nowrap font-medium">{money(Number(p.cost))}</p>
                        {margin === null ? (
                          <p className="mt-1 text-xs text-muted-foreground">Sin margen</p>
                        ) : margin < 0 ? (
                          <Badge
                            variant="destructive"
                            className="mt-1 rounded-full"
                            title={`Margen: ${margin.toFixed(1)}%`}
                          >
                            Pérdida
                          </Badge>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Margen {margin.toFixed(1)}%
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="min-w-48">
                        <p className="truncate text-sm font-medium" title={p.supplier || undefined}>
                          {p.supplier || "Sin proveedor"}
                        </p>
                        <p
                          className="mt-1 truncate text-xs text-muted-foreground"
                          title={p.location || undefined}
                        >
                          {p.location || "Sin ubicación"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <Badge
                            variant={out ? "destructive" : "outline"}
                            className="whitespace-nowrap rounded-full"
                          >
                            {qtyLabel(Number(p.stock), p.unit)}
                          </Badge>
                          {low && (
                            <Badge variant="destructive" className="rounded-full">
                              {out ? "Agotado" : "Reponer"}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            Mínimo: {qtyLabel(Number(p.min_stock), p.unit)}
                          </span>
                        </div>
                      </TableCell>
                      {(canManageProducts || isAdmin) && (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Ajustar stock de ${p.name}`}
                                title="Ajustar stock"
                                onClick={() => {
                                  setAdjusting(p);
                                  setAdjustmentQty("");
                                  setAdjustmentReason("");
                                }}
                              >
                                <SlidersHorizontal className="size-4" />
                              </Button>
                            )}
                            {canManageProducts && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setForm({ open: true, product: p })}
                                >
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
                              </>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {list.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {currentPage} de {pageCount} · {list.length} productos
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(Math.max(1, currentPage - 1));
                  }}
                  className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <PaginationItem key={n}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setPage(n);
                    }}
                    className={
                      n === currentPage
                        ? "rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground"
                        : "rounded-md px-3.5 py-2 text-sm hover:bg-muted"
                    }
                  >
                    {n}
                  </a>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(Math.min(pageCount, currentPage + 1));
                  }}
                  className={currentPage >= pageCount ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
      {canViewAdjustments && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4" /> Historial de ajustes de inventario
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {adjustments.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                Aún no hay ajustes registrados.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cambio</TableHead>
                    <TableHead className="text-right">Stock anterior → nuevo</TableHead>
                    <TableHead>Razón</TableHead>
                    <TableHead>Usuario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.map((adjustment) => {
                    const product = products.find((item) => item.id === adjustment.product_id);
                    const unit = product?.unit ?? "unidad";
                    return (
                      <TableRow key={adjustment.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(adjustment.created_at).toLocaleString("es-CL")}
                        </TableCell>
                        <TableCell className="font-medium">{adjustment.product_name}</TableCell>
                        <TableCell
                          className={`text-right ${adjustment.quantity_delta < 0 ? "text-destructive" : "text-primary"}`}
                        >
                          {adjustment.quantity_delta > 0 ? "+" : ""}
                          {qtyLabel(adjustment.quantity_delta, unit)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {qtyLabel(adjustment.previous_stock, unit)} →{" "}
                          {qtyLabel(adjustment.new_stock, unit)}
                        </TableCell>
                        <TableCell>{adjustment.reason}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {adjustment.user_email ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {canManageProducts && (
        <ProductForm
          open={form.open}
          onOpenChange={(o) => setForm((s) => ({ ...s, open: o }))}
          product={form.product ?? null}
          initialCode={form.initialCode}
          onSaved={() => setPage(1)}
        />
      )}
      {canManageProducts && (
        <BarcodeScanner open={scannerOpen} onOpenChange={setScannerOpen} onDetect={handleScanDetect} />
      )}
      <Dialog open={isAdmin && !!adjusting} onOpenChange={(open) => !open && setAdjusting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar inventario</DialogTitle>
            <DialogDescription>
              {adjusting && (
                <>
                  {adjusting.name} · stock actual{" "}
                  {qtyLabel(Number(adjusting.stock), adjusting.unit)}. Usa un valor positivo para
                  sumar o negativo para descontar.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              adjustStock.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="adjustment-quantity">
                Cantidad a ajustar ({adjusting?.unit === "kilo" ? "kg" : "unidades"})
              </Label>
              <Input
                id="adjustment-quantity"
                inputMode="decimal"
                value={adjustmentQty}
                onChange={(event) => setAdjustmentQty(event.target.value)}
                placeholder="Ej: 5 o -2"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjustment-reason">Razón (obligatoria)</Label>
              <Textarea
                id="adjustment-reason"
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                maxLength={500}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdjusting(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={adjustStock.isPending}>
                {adjustStock.isPending ? "Guardando…" : "Registrar ajuste"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
