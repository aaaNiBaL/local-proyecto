import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Star } from "lucide-react";
import { movementsQuery, productsQuery } from "@/lib/queries";
import { money, pct, previousRange, qtyLabel, rangeStart, type Range } from "@/lib/inventory";
import { AdminOnly, Kpi } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reportes")({
  head: () => ({ meta: [{ title: "Reportes — Invenco" }] }),
  component: () => (
    <AdminOnly>
      <ReportsPage />
    </AdminOnly>
  ),
});

const RANGES: { id: Range; label: string }[] = [
  { id: "day", label: "Hoy" },
  { id: "week", label: "7 días" },
  { id: "month", label: "30 días" },
];

function ReportsPage() {
  const [range, setRange] = useState<Range>("week");
  const { data: movements = [] } = useQuery(movementsQuery(61));
  const { data: products = [] } = useQuery(productsQuery);

  const r = useMemo(() => {
    const from = rangeStart(range).getTime();
    const prev = previousRange(range);
    const inRange = movements.filter((m) => new Date(m.ts).getTime() >= from);
    const inPrev = movements.filter((m) => {
      const t = new Date(m.ts).getTime();
      return t >= prev.start.getTime() && t < prev.end.getTime();
    });
    const sum = (arr: typeof movements, type: string, key: "amount" | "cost_amount") =>
      arr.filter((m) => m.type === type).reduce((s, m) => s + Number(m[key]), 0);

    const sales = sum(inRange, "out", "amount");
    const cogs = sum(inRange, "out", "cost_amount");
    const merma = sum(inRange, "merma", "cost_amount");
    const entradas = sum(inRange, "in", "cost_amount");
    const profit = sales - cogs - merma;
    const prevSales = sum(inPrev, "out", "amount");
    const change = prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : sales > 0 ? 100 : 0;

    const byProduct = new Map<string, { name: string; qty: number; amount: number; profit: number; unit: "unidad" | "kilo"; n: number }>();
    for (const m of inRange.filter((x) => x.type === "out")) {
      const k = m.product_id ?? m.product_name;
      const cur = byProduct.get(k) ?? { name: m.product_name, qty: 0, amount: 0, profit: 0, unit: m.unit, n: 0 };
      cur.qty += Number(m.qty);
      cur.amount += Number(m.amount);
      cur.profit += Number(m.amount) - Number(m.cost_amount);
      cur.n += 1;
      byProduct.set(k, cur);
    }
    const top = [...byProduct.values()].sort((a, b) => b.amount - a.amount);

    const days = range === "day" ? 1 : range === "week" ? 7 : 30;
    const series: { day: string; ventas: number; utilidad: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const dayMs = inRange.filter((m) => {
        const t = new Date(m.ts).getTime();
        return t >= d.getTime() && t < next.getTime() && m.type === "out";
      });
      series.push({
        day: new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(d),
        ventas: dayMs.reduce((s, m) => s + Number(m.amount), 0),
        utilidad: dayMs.reduce((s, m) => s + Number(m.amount) - Number(m.cost_amount), 0),
      });
    }
    return { sales, cogs, merma, entradas, profit, change, top, series, count: inRange.filter((m) => m.type === "out").length };
  }, [movements, range]);

  const star = r.top[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Rendimiento financiero del local</p>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {RANGES.map((x) => (
            <button
              key={x.id}
              onClick={() => setRange(x.id)}
              className={cn("rounded-md px-3 py-1 text-sm", range === x.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Ventas"
          value={money(r.sales)}
          sub={
            <span className={r.change >= 0 ? "text-primary" : "text-destructive"}>
              {pct(r.change)} vs. período anterior · {r.count} ventas
            </span>
          }
        />
        <Kpi label="Costo de reposición" value={money(r.cogs)} sub="de lo vendido" />
        <Kpi label="Mermas" value={money(r.merma)} sub="pérdida por vencimiento" tone={r.merma ? "warn" : "default"} />
        <Kpi
          label="Utilidad neta estimada"
          value={money(r.profit)}
          sub={r.sales > 0 ? `margen ${((r.profit / r.sales) * 100).toFixed(0)}%` : "sin ventas"}
          tone={r.profit >= 0 ? "good" : "danger"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ventas y utilidad por día</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.series} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={36} />
                <Tooltip
                  formatter={(v: number, n: string) => [money(v), n === "ventas" ? "Ventas" : "Utilidad"]}
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                  cursor={{ fill: "var(--muted)" }}
                />
                <Bar dataKey="ventas" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="utilidad" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-accent/50 bg-accent/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="size-4 fill-accent text-accent" /> Producto estrella
            </CardTitle>
          </CardHeader>
          <CardContent>
            {star ? (
              <>
                <p className="text-2xl font-bold">{star.name}</p>
                <p className="text-sm text-muted-foreground">
                  {qtyLabel(+star.qty.toFixed(3), star.unit)} en {star.n} ventas
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Ingresos</p>
                    <p className="font-semibold">{money(star.amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Utilidad</p>
                    <p className="font-semibold">{money(star.profit)}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin ventas en este período.</p>
            )}
            <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Entradas registradas: {money(r.entradas)} a costo · {products.length} productos en catálogo
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranking de rotación</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Utilidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.top.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Sin datos en el período.
                  </TableCell>
                </TableRow>
              )}
              {r.top.slice(0, 15).map((p, i) => (
                <TableRow key={p.name + i}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right">{qtyLabel(+p.qty.toFixed(3), p.unit)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{p.n}</TableCell>
                  <TableCell className="text-right">{money(p.amount)}</TableCell>
                  <TableCell className={cn("text-right", p.profit < 0 && "text-destructive")}>{money(p.profit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
