import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Download, FileText, Package, Tags } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { categoriesQuery, lotsQuery, movementsQuery, productsQuery } from "@/lib/queries";
import { daysUntil, expiryStatus, fmtDate, money, pct, previousRange, qtyLabel, rangeStart } from "@/lib/inventory";
import { Kpi } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Invenco" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { isAdmin } = useAuth();
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
    const low = active.filter((p) => Number(p.stock) <= Number(p.min_stock)).sort((a, b) => Number(a.stock) - Number(b.stock));
    const activeCats = new Set(active.map((p) => p.category_id).filter(Boolean)).size;
    const expiring = lots.filter((l) => ["critico", "proximo", "vencido"].includes(expiryStatus(l.expires_at)));
    return { tTotal, tCount: today.length, change, low, activeCats, expiring };
  }, [movements, products, lots]);

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";

  const exportDashboardExcel = () => {
    const rows = stats.low.map((p) => ({
      Producto: p.name,
      Stock: Number(p.stock),
      Minimo: Number(p.min_stock),
      Precio: Number(p.price),
      Categoria: categories.find((c) => c.id === p.category_id)?.name ?? "—",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reposicion");
    XLSX.writeFile(workbook, "dashboard-reposicion.xlsx");
  };

  const exportDailyPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Cierre diario", 14, 18);
    doc.setFontSize(10);
    doc.text(`Ventas: ${money(stats.tTotal)} · ${stats.tCount} ventas`, 14, 30);
    doc.text(`Cambio vs ayer: ${pct(stats.change)}`, 14, 37);

    autoTable(doc, {
      startY: 46,
      head: [["Producto", "Stock", "Mínimo"]],
      body: stats.low.slice(0, 10).map((p) => [p.name, qtyLabel(Number(p.stock), p.unit), qtyLabel(Number(p.min_stock), p.unit)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [25, 118, 210] },
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      head: [["Lote", "Vence", "Estado"]],
      body: stats.expiring.slice(0, 10).map((l) => [productName(l.product_id), l.expires_at ? fmtDate(l.expires_at) : "—", expiryStatus(l.expires_at)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [220, 53, 69] },
    });

    doc.save("cierre-diario.pdf");
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={exportDashboardExcel}>
          <Download className="size-4" /> Excel
        </Button>
        <Button variant="outline" onClick={exportDailyPdf}>
          <FileText className="size-4" /> PDF diario
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Ventas de hoy"
          value={money(stats.tTotal)}
          sub={
            <span className={stats.change >= 0 ? "text-primary" : "text-destructive"}>
              {pct(stats.change)} vs. ayer · {stats.tCount} ventas
            </span>
          }
          tone="good"
        />
        <Kpi label="Productos registrados" value={products.length} sub={`${stats.activeCats} de ${categories.length} categorías activas`} />
        <Kpi
          label="Stock mínimo"
          value={stats.low.length}
          sub="requieren reposición"
          tone={stats.low.length > 0 ? "warn" : "default"}
        />
        <Kpi
          label="Próximos a vencer"
          value={stats.expiring.length}
          sub="lotes en alerta"
          tone={stats.expiring.length > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-accent" /> Reposición urgente
            </CardTitle>
            {isAdmin && (
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
                      <p className="text-xs text-muted-foreground">mín. {qtyLabel(Number(p.min_stock), p.unit)}</p>
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
            {isAdmin && (
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
                          {Number(l.qty)} restantes · vence {l.expires_at ? fmtDate(l.expires_at) : "—"}
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
