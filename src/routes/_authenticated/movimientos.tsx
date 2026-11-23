import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  PackagePlus,
  RefreshCw,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import {
  inventoryAdjustmentsQuery,
  inventoryStockAuditQuery,
  movementsQuery,
  productsQuery,
  profilesQuery,
  qk,
} from "@/lib/queries";
import { findByCode, fmtDateTime, money, num, qtyLabel } from "@/lib/inventory";
import { useAuth } from "@/lib/auth-context";
import { AdminOnly, Kpi } from "@/components/AppShell";
import { ProductForm } from "@/components/ProductForm";
import { addPdfPageChrome, addPdfSectionHeading, addPdfSummaryCards, pdfColors } from "@/lib/pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/movimientos")({
  head: () => ({ meta: [{ title: "Movimientos — Invenco" }] }),
  component: () => (
    <AdminOnly permission="movements_view">
      <EntriesPage />
    </AdminOnly>
  ),
});

function EntriesPage() {
  const { hasPermission, isAdmin, user } = useAuth();
  const canManageStock = hasPermission("stock_manage");
  const canManageProducts = hasPermission("products_manage");
  const qc = useQueryClient();
  const { data: products = [] } = useQuery(productsQuery);
  const movementsQueryResult = useQuery(movementsQuery(30));
  const adjustmentsQueryResult = useQuery(inventoryAdjustmentsQuery(30));
  const stockAuditQueryResult = useQuery(inventoryStockAuditQuery(30));
  const profilesQueryResult = useQuery(profilesQuery);
  const { data: movements = [] } = movementsQueryResult;
  const { data: adjustments = [] } = adjustmentsQueryResult;
  const { data: stockAudit = [] } = stockAuditQueryResult;
  const { data: profiles = [] } = profilesQueryResult;
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementType, setMovementType] = useState<
    "in" | "salida_manual" | "ajuste" | "devolucion_proveedor"
  >("in");
  const [movementCode, setMovementCode] = useState("");
  const [movementQty, setMovementQty] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movementObservations, setMovementObservations] = useState("");
  const [adjustmentDirection, setAdjustmentDirection] = useState<"increase" | "decrease">(
    "increase",
  );
  const [expires, setExpires] = useState("");
  const [newProduct, setNewProduct] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyPage, setHistoryPage] = useState(0);

  const movementProduct = findByCode(products, movementCode);
  const responsibleName =
    (typeof user.user_metadata.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata.name === "string" && user.user_metadata.name) ||
    user.email ||
    "Usuario actual";

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.products });
    qc.invalidateQueries({ queryKey: qk.lots });
    qc.invalidateQueries({ queryKey: ["movements"] });
    qc.invalidateQueries({ queryKey: qk.inventoryAdjustments });
    qc.invalidateQueries({ queryKey: qk.inventoryStockAudit });
  };

  const movementMutation = useMutation({
    mutationFn: async () => {
      if (!movementProduct) throw new Error("Producto no encontrado.");
      const n = num(movementQty);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Ingresa una cantidad válida.");
      if (Math.abs(n * 1000 - Math.round(n * 1000)) > Number.EPSILON * 1000) {
        throw new Error("La cantidad puede tener hasta tres decimales.");
      }
      if (movementProduct.unit === "unidad" && n !== Math.trunc(n)) {
        throw new Error("La cantidad de este producto debe ser un número entero.");
      }
      const reason = movementReason.trim();
      if (!reason) throw new Error("Indica el motivo del movimiento.");
      const note = [
        `Motivo: ${reason}`,
        movementObservations.trim() ? `Observaciones: ${movementObservations.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (note.length > 500)
        throw new Error("El motivo y las observaciones no pueden superar 500 caracteres.");

      let error: { message: string } | null = null;
      if (movementType === "in") {
        ({ error } = await supabase.rpc("register_entry", {
          _product_id: movementProduct.id,
          _qty: n,
          ...(expires ? { _expires_at: expires } : {}),
          _note: note,
        }));
      } else if (movementType === "salida_manual") {
        ({ error } = await supabase.rpc("register_manual_out", {
          _product_id: movementProduct.id,
          _qty: n,
          _note: note,
        }));
      } else if (movementType === "ajuste") {
        if (!isAdmin) throw new Error("Solo administradores pueden realizar ajustes.");
        const delta = adjustmentDirection === "increase" ? n : -n;
        ({ error } = await supabase.rpc("adjust_inventory", {
          _product_id: movementProduct.id,
          _quantity_delta: delta,
          _reason: note,
        }));
      } else {
        ({ error } = await supabase.rpc("register_supplier_return", {
          _product_id: movementProduct.id,
          _qty: n,
          _note: note,
        }));
      }
      if (error) throw new Error(error.message);
      const delta =
        movementType === "in" || (movementType === "ajuste" && adjustmentDirection === "increase")
          ? n
          : -n;
      return { product: movementProduct, quantity: n, type: movementType, delta };
    },
    onSuccess: ({ product, type, delta }) => {
      const verb = {
        in: "Entrada",
        salida_manual: "Salida",
        ajuste: "Ajuste",
        devolucion_proveedor: "Devolución a proveedor",
      }[type];
      toast.success(
        `${verb}: ${product.name} ${delta > 0 ? "+" : ""}${qtyLabel(delta, product.unit)}`,
      );
      setMovementDialogOpen(false);
      setMovementCode("");
      setMovementQty("");
      setMovementReason("");
      setMovementObservations("");
      setExpires("");
      setAdjustmentDirection("increase");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const history = useMemo(() => {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const auditByMovementId = new Map(
      stockAudit
        .filter((record) => record.movement_id)
        .map((record) => [record.movement_id!, record]),
    );
    const movementEntries = movements.map((movement) => {
      const typeLabel = {
        in: "Entrada",
        out: "Venta (POS)",
        devolucion: "Devolución",
        devolucion_proveedor: "Devolución a proveedor",
        merma: "Merma",
        salida_manual: "Salida manual",
      }[movement.type];
      const defaultReason = {
        in: "Recepción de mercadería",
        out: "Venta en caja",
        devolucion: "Devolución de cliente",
        devolucion_proveedor: "Devolución a proveedor",
        merma: "Merma registrada",
        salida_manual: "Salida manual de inventario",
      }[movement.type];
      const delta =
        movement.type === "out" ||
        movement.type === "salida_manual" ||
        movement.type === "merma" ||
        movement.type === "devolucion_proveedor"
          ? -Number(movement.qty)
          : Number(movement.qty);
      const profile = movement.user_id ? profileById.get(movement.user_id) : undefined;

      return {
        id: `movement-${movement.id}`,
        createdAt: movement.ts,
        type: movement.type,
        typeLabel,
        productName: movement.product_name,
        unit: movement.unit,
        quantityDelta: delta,
        reason: movement.note?.trim() || defaultReason,
        responsible: profile?.full_name || profile?.email || "No registrado",
        cost: Number(movement.cost_amount),
        previousStock: auditByMovementId.get(movement.id)?.previous_stock ?? null,
        newStock: auditByMovementId.get(movement.id)?.new_stock ?? null,
      };
    });
    const adjustmentEntries = adjustments.map((adjustment) => {
      const product = products.find((item) => item.id === adjustment.product_id);
      const profile = profileById.get(adjustment.user_id);
      return {
        id: `adjustment-${adjustment.id}`,
        createdAt: adjustment.created_at,
        type: "ajuste",
        typeLabel: "Ajuste",
        productName: adjustment.product_name,
        unit: product?.unit ?? ("unidad" as const),
        quantityDelta: Number(adjustment.quantity_delta),
        reason: adjustment.reason,
        responsible:
          profile?.full_name || profile?.email || adjustment.user_email || "No registrado",
        cost: 0,
        previousStock: adjustment.previous_stock,
        newStock: adjustment.new_stock,
      };
    });

    return [...movementEntries, ...adjustmentEntries]
      .filter((entry) => historyFilter === "all" || entry.type === historyFilter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [movements, adjustments, profiles, products, stockAudit, historyFilter]);

  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(history.length / pageSize));
  const visibleHistory = history.slice(historyPage * pageSize, (historyPage + 1) * pageSize);
  const summary = useMemo(() => {
    const entries = movements.filter((movement) => movement.type === "in").length;
    const exits = movements.filter(
      (movement) =>
        movement.type === "out" ||
        movement.type === "salida_manual" ||
        movement.type === "merma" ||
        movement.type === "devolucion_proveedor",
    ).length;
    const returns = movements.filter(
      (movement) => movement.type === "devolucion" || movement.type === "devolucion_proveedor",
    ).length;
    return {
      total: movements.length + adjustments.length,
      entries,
      exits,
      adjustmentsAndReturns: adjustments.length + returns,
    };
  }, [movements, adjustments]);

  const exportMovements = () => {
    const rows = history.map((entry) => ({
      Fecha: new Date(entry.createdAt).toLocaleString("es-CL"),
      Tipo: entry.typeLabel,
      Producto: entry.productName,
      Cantidad: entry.quantityDelta,
      Unidad: entry.unit,
      Responsable: entry.responsible,
      Motivo: entry.reason,
      Costo: entry.cost,
      "Stock anterior": entry.previousStock ?? "",
      "Stock posterior": entry.newStock ?? "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos");
    XLSX.writeFile(workbook, "movimientos.xlsx");
    toast.success("Excel exportado");
  };

  const exportMovementsPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const filterLabel =
      {
        all: "Todos los movimientos",
        in: "Entradas",
        out: "Salidas",
        devolucion: "Devoluciones",
        devolucion_proveedor: "Devoluciones a proveedor",
        merma: "Mermas",
        salida_manual: "Salidas manuales",
        ajuste: "Ajustes",
      }[historyFilter] ?? "Todos los movimientos";
    const now = new Date();
    const dateLabel = new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(now);
    const rangeLabel =
      history.length > 0
        ? `${new Intl.DateTimeFormat("es-CL").format(new Date(history[history.length - 1].createdAt))} al ${new Intl.DateTimeFormat("es-CL").format(new Date(history[0].createdAt))}`
        : "Sin registros en el período";
    const rowCountByType = (type: string) => history.filter((entry) => entry.type === type).length;

    addPdfSummaryCards(doc, 40, [
      { label: "Movimientos", value: String(history.length) },
      { label: "Entradas", value: String(rowCountByType("in")) },
      {
        label: "Salidas y mermas (incl. proveedor)",
        value: String(
          rowCountByType("out") +
            rowCountByType("salida_manual") +
            rowCountByType("merma") +
            rowCountByType("devolucion_proveedor"),
        ),
      },
      {
        label: "Devoluciones y ajustes",
        value: String(rowCountByType("devolucion") + rowCountByType("ajuste")),
      },
    ]);

    const tableTop = addPdfSectionHeading(
      doc,
      "Detalle de movimientos",
      `${filterLabel} · ${rangeLabel}`,
      72,
    );
    autoTable(doc, {
      startY: tableTop,
      margin: { top: 40, bottom: 20, left: 14, right: 14 },
      head: [
        [
          "Fecha y hora",
          "Tipo",
          "Producto",
          "Cantidad",
          "Motivo",
          "Responsable",
          "Stock antes",
          "Stock después",
        ],
      ],
      body: history.length
        ? history.map((entry) => [
            new Intl.DateTimeFormat("es-CL", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(entry.createdAt)),
            entry.typeLabel,
            entry.productName,
            `${entry.quantityDelta > 0 ? "+" : ""}${qtyLabel(entry.quantityDelta, entry.unit)}`,
            entry.reason,
            entry.responsible,
            entry.previousStock === null ? "—" : qtyLabel(entry.previousStock, entry.unit),
            entry.newStock === null ? "—" : qtyLabel(entry.newStock, entry.unit),
          ])
        : [["No hay movimientos para mostrar en este período.", "", "", "", "", "", "", ""]],
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 7,
        cellPadding: 2.5,
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
        0: { cellWidth: 25 },
        1: { cellWidth: 21 },
        2: { cellWidth: 35 },
        3: { cellWidth: 24 },
        4: { cellWidth: 39 },
        5: { cellWidth: 35 },
        6: { cellWidth: 20 },
        7: { cellWidth: 20 },
      },
    });

    addPdfPageChrome(doc, "Historial de movimientos", `Generado el ${dateLabel}`);
    doc.save("movimientos.pdf");
    toast.success("PDF exportado");
  };

  return (
    <div className="w-full space-y-5 pb-6">
      <section className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Movimientos de inventario
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Revisa y registra entradas, salidas, ajustes y devoluciones en un solo lugar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={exportMovements}>
              <Download className="size-4" /> Exportar Excel
            </Button>
            <Button type="button" variant="outline" onClick={exportMovementsPdf}>
              <FileText className="size-4" /> Exportar PDF
            </Button>
            {canManageStock && (
              <Button onClick={() => setMovementDialogOpen(true)} className="shrink-0 shadow-sm">
                <PackagePlus className="size-4" /> Nuevo movimiento
              </Button>
            )}
          </div>
        </div>
        <Dialog
          open={movementDialogOpen}
          onOpenChange={(open) => {
            setMovementDialogOpen(open);
            if (!open) {
              setMovementCode("");
              setMovementQty("");
              setMovementReason("");
              setMovementObservations("");
              setExpires("");
            }
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Registrar movimiento</DialogTitle>
              <DialogDescription>
                El sistema actualizará el stock, registrará fecha y hora y guardará al usuario
                responsable.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!movementProduct) {
                  if (movementType === "in" && canManageProducts && movementCode.trim()) {
                    setMovementDialogOpen(false);
                    setNewProduct(movementCode.trim());
                    return;
                  }
                  toast.error("No se encontró un producto activo con ese código o palabra clave.");
                  return;
                }
                movementMutation.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="movement-type">Tipo de movimiento</Label>
                <Select
                  value={movementType}
                  onValueChange={(value) =>
                    setMovementType(
                      value as "in" | "salida_manual" | "ajuste" | "devolucion_proveedor",
                    )
                  }
                >
                  <SelectTrigger id="movement-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Entrada</SelectItem>
                    <SelectItem value="salida_manual">Salida</SelectItem>
                    {isAdmin && <SelectItem value="ajuste">Ajuste de inventario</SelectItem>}
                    <SelectItem value="devolucion_proveedor">Devolución a proveedor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="movement-product">
                  Producto y código de barras o palabra clave
                </Label>
                <Input
                  id="movement-product"
                  value={movementCode}
                  onChange={(event) => setMovementCode(event.target.value)}
                  placeholder="Escanea o escribe el código"
                  autoFocus
                />
                {movementCode.trim() && (
                  <p className="text-sm text-muted-foreground">
                    {movementProduct
                      ? `${movementProduct.name} · stock actual ${qtyLabel(Number(movementProduct.stock), movementProduct.unit)}`
                      : movementType === "in" && canManageProducts
                        ? "Producto no encontrado. Podrás crearlo al continuar."
                        : "No se encontró un producto activo."}
                  </p>
                )}
              </div>
              {movementType === "ajuste" && (
                <div className="space-y-1.5">
                  <Label htmlFor="adjustment-direction">Dirección del ajuste</Label>
                  <Select
                    value={adjustmentDirection}
                    onValueChange={(value) =>
                      setAdjustmentDirection(value as "increase" | "decrease")
                    }
                  >
                    <SelectTrigger id="adjustment-direction">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="increase">Aumentar el stock</SelectItem>
                      <SelectItem value="decrease">Disminuir el stock</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="movement-qty">
                    Cantidad {movementProduct?.unit === "kilo" ? "(kg)" : "(unidades)"}
                  </Label>
                  <Input
                    id="movement-qty"
                    inputMode="decimal"
                    min="0"
                    step={movementProduct?.unit === "kilo" ? "0.001" : "1"}
                    value={movementQty}
                    onChange={(event) => setMovementQty(event.target.value)}
                    required
                  />
                </div>
                {movementType === "in" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="movement-expires">Vencimiento del lote (opcional)</Label>
                    <Input
                      id="movement-expires"
                      type="date"
                      value={expires}
                      onChange={(event) => setExpires(event.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="movement-reason">
                  {movementType === "devolucion_proveedor" ? "Motivo / proveedor" : "Motivo"}
                </Label>
                <Input
                  id="movement-reason"
                  maxLength={400}
                  value={movementReason}
                  onChange={(event) => setMovementReason(event.target.value)}
                  placeholder={
                    movementType === "devolucion_proveedor"
                      ? "Ej: Distribuidora Sur · producto defectuoso"
                      : "Indica por qué se registra el movimiento"
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="movement-observations">Observaciones (opcional)</Label>
                <textarea
                  id="movement-observations"
                  maxLength={100}
                  rows={2}
                  value={movementObservations}
                  onChange={(event) => setMovementObservations(event.target.value)}
                  className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm"
                />
              </div>
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                <p>
                  Responsable:{" "}
                  <span className="font-medium text-foreground">{responsibleName}</span>
                </p>
                <p>Fecha y hora: se guardarán automáticamente al registrar el movimiento.</p>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMovementDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={movementMutation.isPending || !movementCode.trim()}>
                  {movementMutation.isPending ? "Guardando…" : "Registrar movimiento"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </section>

      <section aria-label="Resumen de movimientos de los últimos 30 días">
        <div className="mb-4 flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Resumen de actividad</h2>
              <Badge variant="outline" className="rounded-full bg-background px-3 py-1">
                <span className="mr-2 size-1.5 rounded-full bg-primary" />
                últimos 30 días
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Entradas, salidas, ajustes y devoluciones registradas en el período.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Movimientos registrados" value={summary.total} icon={ClipboardList} />
          <Kpi
            label="Entradas"
            value={summary.entries}
            icon={ArrowDownToLine}
            sub="mercadería recibida"
            tone="good"
          />
          <Kpi
            label="Salidas de inventario"
            value={summary.exits}
            icon={ArrowUpFromLine}
            sub="ventas, mermas y retiros"
            tone="warn"
          />
          <Kpi
            label="Ajustes y devoluciones"
            value={summary.adjustmentsAndReturns}
            icon={RefreshCw}
            sub="operaciones registradas"
            tone="danger"
          />
        </div>
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Historial de movimientos</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Entradas, salidas, devoluciones, mermas y ajustes de los últimos 30 días.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">Filtrar por</span>
            <Select
              value={historyFilter}
              onValueChange={(value) => {
                setHistoryFilter(value);
                setHistoryPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los movimientos</SelectItem>
                <SelectItem value="in">Entradas</SelectItem>
                <SelectItem value="salida_manual">Salidas manuales</SelectItem>
                <SelectItem value="out">Ventas del POS</SelectItem>
                <SelectItem value="devolucion">Devoluciones</SelectItem>
                <SelectItem value="devolucion_proveedor">Devoluciones a proveedor</SelectItem>
                <SelectItem value="merma">Mermas</SelectItem>
                <SelectItem value="ajuste">Ajustes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {movementsQueryResult.error ||
          adjustmentsQueryResult.error ||
          stockAuditQueryResult.error ||
          profilesQueryResult.error ? (
            <p className="px-6 pb-6 text-sm text-destructive">
              No se pudo cargar el historial:{" "}
              {movementsQueryResult.error?.message ||
                adjustmentsQueryResult.error?.message ||
                stockAuditQueryResult.error?.message ||
                profilesQueryResult.error?.message}
            </p>
          ) : history.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No hay movimientos para mostrar en este período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Stock antes → después</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Responsable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            entry.type === "out" ||
                            entry.type === "salida_manual" ||
                            entry.type === "merma" ||
                            entry.type === "devolucion_proveedor"
                              ? "destructive"
                              : "secondary"
                          }
                          className="rounded-full whitespace-nowrap"
                        >
                          {entry.typeLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{entry.productName}</TableCell>
                      <TableCell
                        className={`whitespace-nowrap font-medium ${entry.quantityDelta < 0 ? "text-destructive" : "text-primary"}`}
                      >
                        {entry.quantityDelta > 0 ? "+" : ""}
                        {qtyLabel(entry.quantityDelta, entry.unit)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {entry.previousStock === null || entry.newStock === null
                          ? "—"
                          : `${qtyLabel(entry.previousStock, entry.unit)} → ${qtyLabel(entry.newStock, entry.unit)}`}
                      </TableCell>
                      <TableCell className="max-w-64 text-sm">{entry.reason}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.responsible}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {history.length > pageSize && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    {historyPage * pageSize + 1}–
                    {Math.min((historyPage + 1) * pageSize, history.length)} de {history.length}{" "}
                    movimientos
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((page) => Math.max(0, page - 1))}
                      disabled={historyPage === 0}
                    >
                      <ChevronLeft className="size-4" /> Anterior
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((page) => Math.min(pageCount - 1, page + 1))}
                      disabled={historyPage >= pageCount - 1}
                    >
                      Siguiente <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ProductForm
        open={newProduct !== null}
        onOpenChange={(o) => !o && setNewProduct(null)}
        initialCode={newProduct ?? ""}
        hideInitialStock
        onSaved={(product) => {
          setMovementCode(product.code || product.keyword || "");
          setMovementDialogOpen(true);
        }}
      />
    </div>
  );
}
