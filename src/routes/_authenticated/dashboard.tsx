import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Download,
  FileText,
  Package,
  ShoppingBag,
  Tags,
} from "lucide-react";
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { categoriesQuery, lotsQuery, movementsQuery, productsQuery } from "@/lib/queries";
import {
  daysUntil,
  expiryStatus,
  fmtDate,
  money,
  pct,
  previousRange,
  qtyLabel,
  rangeStart,
} from "@/lib/inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kpi } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { addPdfPageChrome, addPdfSectionHeading, addPdfSummaryCards, pdfColors } from "@/lib/pdf";
import { createExcelSheet, excelGeneratedAt } from "@/lib/excel";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Invenco" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { isAdmin, hasPermission } = useAuth();
  const { data: products = [] } = useQuery(productsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: lots = [] } = useQuery(lotsQuery);
  const { data: movements = [] } = useQuery(movementsQuery(3));

  const stats = useMemo(() => {
    const todayFrom = rangeStart("day").getTime();
    const prev = previousRange("day");
    const sales = movements.filter((m) => m.type === "out");
    const today = sales.filter((m) => new Date(m.ts).getTime() >= todayFrom);
    const yesterday = sales.filter((m) => {
      const t = new Date(m.ts).getTime();
      return t >= prev.start.getTime() && t < prev.end.getTime();
    });
    const tTotal = today.reduce((s, m) => s + Number(m.amount), 0);
    const yTotal = yesterday.reduce((s, m) => s + Number(m.amount), 0);
    const change = yTotal > 0 ? ((tTotal - yTotal) / yTotal) * 100 : tTotal > 0 ? 100 : 0;
    const active = products.filter((p) => p.active);
    const low = active
      .filter((p) => Number(p.stock) <= Number(p.min_stock))
      .sort((a, b) => Number(a.stock) - Number(b.stock));
    const activeCats = new Set(active.map((p) => p.category_id).filter(Boolean)).size;
    const expiring = lots.filter((l) =>
      ["critico", "proximo", "vencido"].includes(expiryStatus(l.expires_at)),
    );
    return { tTotal, tCount: today.length, change, low, activeCats, expiring };
  }, [movements, products, lots]);

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";

  const exportDashboardExcel = () => {
    const workbook = XLSX.utils.book_new();
    const generatedAt = excelGeneratedAt();
    const summary = [
      { Indicador: "Fecha del reporte", Valor: new Date().toLocaleDateString("es-CL") },
      { Indicador: "Ventas de hoy (CLP)", Valor: stats.tTotal },
      { Indicador: "Transacciones de hoy", Valor: stats.tCount },
      { Indicador: "Variación frente a ayer (%)", Valor: stats.change },
      { Indicador: "Productos con stock bajo", Valor: stats.low.length },
      { Indicador: "Lotes próximos a vencer", Valor: stats.expiring.length },
      { Indicador: "Generado el", Valor: generatedAt },
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Resumen del día",
        `Indicadores del negocio · Generado ${generatedAt}`,
        summary,
        [
          { key: "Indicador", label: "Indicador", width: 34 },
          { key: "Valor", label: "Resultado", width: 24, format: "#,##0;[Red]-#,##0" },
        ],
      ),
      "Resumen",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Reposición urgente",
        "Productos cuyo stock actual alcanzó o está bajo el mínimo definido.",
        stats.low.map((p) => ({
          Producto: p.name,
          Stock: Number(p.stock),
          Minimo: Number(p.min_stock),
          Precio: Number(p.price),
          Categoria: categories.find((c) => c.id === p.category_id)?.name ?? "—",
        })),
        [
          { key: "Producto", label: "Producto", width: 32 },
          { key: "Stock", label: "Stock actual", width: 16, format: "0.###" },
          { key: "Minimo", label: "Stock mínimo", width: 16, format: "0.###" },
          { key: "Precio", label: "Precio (CLP)", width: 18, format: "#,##0;[Red]-#,##0" },
          { key: "Categoria", label: "Categoría", width: 24 },
        ],
      ),
      "Reposición",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Vencimientos cercanos",
        "Lotes vencidos o próximos a vencer.",
        stats.expiring.map((lot) => ({
          Producto: productName(lot.product_id),
          Vencimiento: lot.expires_at ? fmtDate(lot.expires_at) : "Sin fecha",
          Estado: expiryStatus(lot.expires_at),
        })),
        [
          { key: "Producto", label: "Producto", width: 32 },
          { key: "Vencimiento", label: "Fecha de vencimiento", width: 24 },
          { key: "Estado", label: "Estado", width: 20 },
        ],
      ),
      "Vencimientos",
    );
    XLSX.writeFile(workbook, "dashboard-reposicion.xlsx");
  };

  const exportDailyPdf = () => {
    const doc = new jsPDF();
    const reportDate = new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date());
    const tableStyles = {
      theme: "grid" as const,
      margin: { top: 40, bottom: 20, left: 14, right: 14 },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 3,
        textColor: pdfColors.text,
        lineColor: pdfColors.border,
        lineWidth: 0.15,
      },
      headStyles: {
        fillColor: pdfColors.primary,
        textColor: [255, 255, 255] as [number, number, number],
        fontStyle: "bold" as const,
      },
      alternateRowStyles: { fillColor: pdfColors.alternate },
    };

    addPdfSummaryCards(doc, 40, [
      { label: "Ventas de hoy", value: money(stats.tTotal) },
      { label: "Transacciones", value: String(stats.tCount) },
      { label: "Variación vs. ayer", value: pct(stats.change) },
      { label: "Productos con stock bajo", value: String(stats.low.length) },
    ]);

    let y = addPdfSectionHeading(
      doc,
      "Reposición urgente",
      "Productos cuyo stock actual alcanzó o está bajo el mínimo definido.",
      72,
    );

    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Producto", "Stock", "Mínimo"]],
      body: stats.low.length
        ? stats.low
            .slice(0, 10)
            .map((p) => [
              p.name,
              qtyLabel(Number(p.stock), p.unit),
              qtyLabel(Number(p.min_stock), p.unit),
            ])
        : [["No hay productos que requieran reposición.", "", ""]],
    });

    y = doc.lastAutoTable.finalY + 12;
    if (y > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 42;
    }
    y = addPdfSectionHeading(
      doc,
      "Vencimientos cercanos",
      "Lotes vencidos o próximos a vencer.",
      y,
    );
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Lote", "Vence", "Estado"]],
      body: stats.expiring.length
        ? stats.expiring
            .slice(0, 10)
            .map((l) => [
              productName(l.product_id),
              l.expires_at ? fmtDate(l.expires_at) : "—",
              expiryStatus(l.expires_at),
            ])
        : [["No hay lotes vencidos ni próximos a vencer.", "", ""]],
    });

    addPdfPageChrome(doc, "Cierre diario", `Resumen del ${reportDate}`);
    doc.save("cierre-diario.pdf");
  };

  return (
    <div className="w-full space-y-6 pb-6">
      <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Resumen de ventas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Revisa ingresos, ganancias y movimiento de productos en un solo lugar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportDashboardExcel}>
              <Download className="size-4" /> Exportar Excel
            </Button>
            <Button variant="outline" onClick={exportDailyPdf}>
              <FileText className="size-4" /> Exportar PDF
            </Button>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Ventas de hoy"
          value={money(stats.tTotal)}
          icon={ShoppingBag}
          sub={
            <span className={stats.change >= 0 ? "text-primary" : "text-destructive"}>
              {pct(stats.change)} vs. ayer · {stats.tCount} ventas
            </span>
          }
          tone="good"
        />
        <Kpi
          label="Productos registrados"
          value={products.length}
          icon={Package}
          sub={`${stats.activeCats} de ${categories.length} categorías activas`}
        />
        <Kpi
          label="Stock mínimo"
          value={stats.low.length}
          icon={AlertTriangle}
          tone={stats.low.length > 0 ? "warn" : "default"}
          sub="requieren reposición"
        />
        <Kpi
          label="Próximos a vencer"
          value={stats.expiring.length}
          icon={CalendarClock}
          tone={stats.expiring.length > 0 ? "danger" : "default"}
          sub="lotes en alerta"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-accent" /> Reposición urgente
            </CardTitle>
            {hasPermission("stock_manage") && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/movimientos">Registrar entrada</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {stats.low.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todo el stock está sobre el mínimo.</p>
            ) : (
              <ul className="divide-y">
                {stats.low.slice(0, 8).map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        mín. {qtyLabel(Number(p.min_stock), p.unit)}
                      </p>
                    </div>
                    <Badge variant={Number(p.stock) <= 0 ? "destructive" : "secondary"}>
                      {qtyLabel(Number(p.stock), p.unit)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-destructive" /> Vencimientos cercanos
            </CardTitle>
            {hasPermission("expiry_manage") && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/vencimientos">Gestionar</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {stats.expiring.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin lotes próximos a vencer.</p>
            ) : (
              <ul className="divide-y">
                {stats.expiring.slice(0, 8).map((l) => {
                  const d = daysUntil(l.expires_at) ?? 0;
                  const st = expiryStatus(l.expires_at);
                  return (
                    <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="font-medium">{productName(l.product_id)}</p>
                        <p className="text-xs text-muted-foreground">
                          {Number(l.qty)} restantes · vence{" "}
                          {l.expires_at ? fmtDate(l.expires_at) : "—"}
                        </p>
                      </div>
                      <Badge variant={st === "proximo" ? "secondary" : "destructive"}>
                        {d < 0 ? "Vencido" : d === 0 ? "Hoy" : `${d} d`}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tags className="size-4" /> Categorías
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const n = products.filter((p) => p.category_id === c.id).length;
              return (
                <Badge key={c.id} variant={n > 0 ? "default" : "outline"}>
                  {c.name} · {n}
                </Badge>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="size-4" /> Valor del inventario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {money(products.reduce((s, p) => s + Number(p.stock) * Number(p.price), 0))}
            </p>
            <p className="text-xs text-muted-foreground">
              a precio de venta · costo estimado{" "}
              {money(products.reduce((s, p) => s + Number(p.stock) * Number(p.cost), 0))}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
