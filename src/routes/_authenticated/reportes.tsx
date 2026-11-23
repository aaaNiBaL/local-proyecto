import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDownWideNarrow,
  CalendarDays,
  ChartNoAxesCombined,
  CreditCard,
  Download,
  FileText,
  PackageSearch,
  ReceiptText,
  ShoppingBag,
  Star,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { productsQuery, profilesQuery } from "@/lib/queries";
import {
  money,
  pct,
  qtyLabel,
  type Movement,
  type Product,
  type SalePayment,
} from "@/lib/inventory";
import { AdminOnly, Kpi } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addPdfPageChrome, addPdfSectionHeading, addPdfSummaryCards, pdfColors } from "@/lib/pdf";
import { createExcelSheet, excelGeneratedAt } from "@/lib/excel";

export const Route = createFileRoute("/_authenticated/reportes")({
  head: () => ({ meta: [{ title: "Reportes — Invenco" }] }),
  component: () => (
    <AdminOnly permission="reports">
      <ReportsPage />
    </AdminOnly>
  ),
});

const dateValue = (date: Date) => {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
};

function ReportDatePicker({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const selectedDate = value ? new Date(`${value}T00:00:00`) : undefined;
  const minDate = min ? new Date(`${min}T00:00:00`) : undefined;
  const maxDate = max ? new Date(`${max}T00:00:00`) : undefined;
  const displayDate = selectedDate
    ? new Intl.DateTimeFormat("es-CL", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(selectedDate)
    : "Selecciona una fecha";

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
      >
        <CalendarDays className="size-3.5" /> {label}
      </label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "h-11 w-full justify-start gap-3 bg-background px-3 text-left font-normal sm:w-52",
              !selectedDate && "text-muted-foreground",
            )}
            aria-label={`${label}: ${displayDate}`}
          >
            <CalendarDays className="size-4 text-primary" />
            <span className="flex-1 truncate capitalize">{displayDate}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto rounded-xl border bg-popover p-2 shadow-xl" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={(date) => {
              if (date) onChange(dateValue(date));
            }}
            disabled={(date) => Boolean((minDate && date < minDate) || (maxDate && date > maxDate))}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

type ProductSales = {
  id: string;
  name: string;
  qty: number;
  amount: number;
  profit: number;
  unit: Product["unit"];
  transactions: number;
};

type CashierSales = {
  id: string;
  name: string;
  sales: number;
  amount: number;
};

function ReportMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: ReactNode;
  icon: LucideIcon;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  return <Kpi label={label} value={value} sub={detail} icon={Icon} tone={tone} />;
}

function ReportsPage() {
  const today = new Date();
  const [fromDate, setFromDate] = useState(dateValue(startOfMonth(today)));
  const [toDate, setToDate] = useState(dateValue(today));
  const productsQueryResult = useQuery(productsQuery);
  const profilesQueryResult = useQuery(profilesQuery);
  const products = useMemo(() => productsQueryResult.data ?? [], [productsQueryResult.data]);
  const profiles = useMemo(() => profilesQueryResult.data ?? [], [profilesQueryResult.data]);
  const from = useMemo(() => new Date(`${fromDate}T00:00:00`), [fromDate]);
  const toExclusive = useMemo(() => addDays(new Date(`${toDate}T00:00:00`), 1), [toDate]);
  const validDates =
    Number.isFinite(from.getTime()) && Number.isFinite(toExclusive.getTime()) && from < toExclusive;
  const durationDays = validDates
    ? Math.ceil((toExclusive.getTime() - from.getTime()) / 86400000)
    : 1;
  const previousFrom = useMemo(() => addDays(from, -durationDays), [from, durationDays]);
  const reportMonthDate = useMemo(() => new Date(`${toDate}T00:00:00`), [toDate]);
  const monthFrom = useMemo(() => startOfMonth(reportMonthDate), [reportMonthDate]);
  const previousMonthFrom = useMemo(
    () => new Date(reportMonthDate.getFullYear(), reportMonthDate.getMonth() - 1, 1),
    [reportMonthDate],
  );
  const previousMonthEnd = useMemo(
    () =>
      new Date(
        previousMonthFrom.getFullYear(),
        previousMonthFrom.getMonth(),
        Math.min(
          reportMonthDate.getDate() + 1,
          new Date(previousMonthFrom.getFullYear(), previousMonthFrom.getMonth() + 1, 0).getDate() +
            1,
        ),
      ),
    [previousMonthFrom, reportMonthDate],
  );
  const fetchFrom = useMemo(
    () => new Date(Math.min(from.getTime(), previousFrom.getTime(), previousMonthFrom.getTime())),
    [from, previousFrom, previousMonthFrom],
  );
  const reportQuery = useQuery({
    queryKey: ["report-data", fromDate, toDate],
    enabled: validDates,
    queryFn: async () => {
      const startIso = fetchFrom.toISOString();
      const endIso = toExclusive.toISOString();
      const movementRows: Movement[] = [];
      const paymentRows: SalePayment[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const [movementResult, paymentResult] = await Promise.all([
          supabase
            .from("movements")
            .select("*")
            .gte("ts", startIso)
            .lt("ts", endIso)
            .order("ts", { ascending: false })
            .range(offset, offset + pageSize - 1),
          supabase
            .from("sale_payments")
            .select("*")
            .gte("created_at", startIso)
            .lt("created_at", endIso)
            .order("created_at", { ascending: false })
            .range(offset, offset + pageSize - 1),
        ]);
        if (movementResult.error) throw new Error(movementResult.error.message);
        if (paymentResult.error) throw new Error(paymentResult.error.message);
        movementRows.push(...movementResult.data);
        paymentRows.push(...paymentResult.data);
        if (movementResult.data.length < pageSize && paymentResult.data.length < pageSize) break;
      }
      return { movements: movementRows, payments: paymentRows };
    },
  });
  const movements = useMemo(() => reportQuery.data?.movements ?? [], [reportQuery.data?.movements]);
  const payments = useMemo(() => reportQuery.data?.payments ?? [], [reportQuery.data?.payments]);

  const r = useMemo(() => {
    const fromMs = from.getTime();
    const toMs = toExclusive.getTime();
    const prevFromMs = previousFrom.getTime();
    const inRange = movements.filter((m) => {
      const t = new Date(m.ts).getTime();
      return t >= fromMs && t < toMs;
    });
    const inPrev = movements.filter((m) => {
      const t = new Date(m.ts).getTime();
      return t >= prevFromMs && t < fromMs;
    });
    const monthStartMs = monthFrom.getTime();
    const previousMonthStartMs = previousMonthFrom.getTime();
    const monthSales = movements.filter((m) => {
      const t = new Date(m.ts).getTime();
      return m.type === "out" && t >= monthStartMs && t < toMs;
    });
    const previousMonthSales = movements.filter((m) => {
      const t = new Date(m.ts).getTime();
      return m.type === "out" && t >= previousMonthStartMs && t < previousMonthEnd.getTime();
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
    const thisMonthSales = monthSales.reduce((total, m) => total + Number(m.amount), 0);
    const lastMonthSales = previousMonthSales.reduce((total, m) => total + Number(m.amount), 0);
    const monthChange =
      lastMonthSales > 0
        ? ((thisMonthSales - lastMonthSales) / lastMonthSales) * 100
        : thisMonthSales > 0
          ? 100
          : 0;

    const byProduct = new Map<string, ProductSales>();
    const transactionsByProduct = new Map<string, Set<string>>();
    for (const m of inRange.filter((x) => x.type === "out")) {
      const k = m.product_id ?? m.product_name;
      const cur = byProduct.get(k) ?? {
        id: k,
        name: m.product_name,
        qty: 0,
        amount: 0,
        profit: 0,
        unit: m.unit,
        transactions: 0,
      };
      cur.qty += Number(m.qty);
      cur.amount += Number(m.amount);
      cur.profit += Number(m.amount) - Number(m.cost_amount);
      const transactionIds = transactionsByProduct.get(k) ?? new Set<string>();
      transactionIds.add(m.sale_id ?? m.id);
      transactionsByProduct.set(k, transactionIds);
      byProduct.set(k, cur);
    }
    for (const [id, productSales] of byProduct) {
      productSales.transactions = transactionsByProduct.get(id)?.size ?? 0;
    }
    const top = [...byProduct.values()].sort((a, b) => b.qty - a.qty);
    const lowRotation = products
      .filter((product) => product.active)
      .map(
        (product) =>
          byProduct.get(product.id) ?? {
            id: product.id,
            name: product.name,
            qty: 0,
            amount: 0,
            profit: 0,
            unit: product.unit,
            transactions: 0,
          },
      )
      .sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));

    const paymentTotals = new Map<string, { count: number; amount: number }>();
    for (const payment of payments) {
      const saleTime = new Date(payment.created_at).getTime();
      if (saleTime < fromMs || saleTime >= toMs) continue;
      const current = paymentTotals.get(payment.payment_method) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += Number(payment.total);
      paymentTotals.set(payment.payment_method, current);
    }

    const cashierMap = new Map<string, CashierSales>();
    const saleIdsByCashier = new Map<string, Set<string>>();
    for (const movement of inRange.filter((item) => item.type === "out")) {
      const id = movement.user_id ?? "unknown";
      const profile = profiles.find((item) => item.id === id);
      const cashier = cashierMap.get(id) ?? {
        id,
        name: profile?.full_name || profile?.email || (id === "unknown" ? "Sin responsable" : id),
        sales: 0,
        amount: 0,
      };
      cashier.amount += Number(movement.amount);
      const saleId = movement.sale_id ?? movement.id;
      const saleIds = saleIdsByCashier.get(id) ?? new Set<string>();
      saleIds.add(saleId);
      saleIdsByCashier.set(id, saleIds);
      cashierMap.set(id, cashier);
    }
    for (const [id, cashier] of cashierMap) cashier.sales = saleIdsByCashier.get(id)?.size ?? 0;

    const series: { day: string; ventas: number; utilidad: number }[] = [];
    const dailyBuckets = durationDays <= 62;
    const bucketStarts: Date[] = [];
    if (dailyBuckets) {
      for (
        let date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
        date < toExclusive;
        date = addDays(date, 1)
      ) {
        bucketStarts.push(new Date(date));
      }
    } else {
      for (
        let date = startOfMonth(from);
        date < toExclusive;
        date = new Date(date.getFullYear(), date.getMonth() + 1, 1)
      ) {
        bucketStarts.push(new Date(date));
      }
    }
    for (const d of bucketStarts) {
      const next = dailyBuckets ? addDays(d, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const bucket = inRange.filter((m) => {
        const t = new Date(m.ts).getTime();
        return t >= d.getTime() && t < next.getTime() && m.type === "out";
      });
      series.push({
        day: new Intl.DateTimeFormat(
          "es-CL",
          dailyBuckets ? { day: "2-digit", month: "short" } : { month: "short", year: "2-digit" },
        ).format(d),
        ventas: bucket.reduce((s, m) => s + Number(m.amount), 0),
        utilidad: bucket.reduce((s, m) => s + Number(m.amount) - Number(m.cost_amount), 0),
      });
    }
    const cashierSales = [...cashierMap.values()].sort((a, b) => b.amount - a.amount);
    const paymentsByMethod = [...paymentTotals.entries()].map(([method, totals]) => ({
      method,
      ...totals,
    }));
    return {
      sales,
      cogs,
      merma,
      entradas,
      profit,
      change,
      top,
      lowRotation,
      series,
      count: new Set(inRange.filter((m) => m.type === "out").map((m) => m.sale_id ?? m.id)).size,
      thisMonthSales,
      lastMonthSales,
      monthChange,
      cashierSales,
      paymentsByMethod,
    };
  }, [
    movements,
    payments,
    products,
    profiles,
    from,
    toExclusive,
    previousFrom,
    monthFrom,
    previousMonthFrom,
    previousMonthEnd,
    durationDays,
  ]);

  const star = r.top[0];
  const monthLabel = new Intl.DateTimeFormat("es-CL", { month: "long" }).format(reportMonthDate);

  const exportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const generatedAt = excelGeneratedAt();
    const amountFormat = "#,##0;[Red]-#,##0";
    const summary = [
      { Indicador: "Período desde", Valor: from.toLocaleDateString("es-CL") },
      {
        Indicador: "Período hasta",
        Valor: new Date(`${toDate}T00:00:00`).toLocaleDateString("es-CL"),
      },
      { Indicador: "Ventas del período", Valor: r.sales },
      { Indicador: "Costo de ventas", Valor: r.cogs },
      { Indicador: "Ganancia estimada", Valor: r.profit },
      { Indicador: "Transacciones", Valor: r.count },
      { Indicador: `Ventas de ${monthLabel}`, Valor: r.thisMonthSales },
      { Indicador: "Ventas del mes anterior", Valor: r.lastMonthSales },
      { Indicador: "Variación mensual (%)", Valor: r.monthChange },
      { Indicador: "Generado el", Valor: generatedAt },
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Resumen de ventas",
        `Período ${fromDate} al ${toDate} · Generado ${generatedAt}`,
        summary,
        [
          { key: "Indicador", label: "Indicador", width: 34 },
          { key: "Valor", label: "Resultado", width: 24, format: amountFormat },
        ],
      ),
      "Resumen",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Productos más vendidos",
        "Ordenados por cantidad vendida en el período seleccionado.",
        r.top.map((p) => ({
          Producto: p.name,
          Cantidad: p.qty,
          Transacciones: p.transactions,
          Ingresos: p.amount,
          Ganancia: p.profit,
        })),
        [
          { key: "Producto", label: "Producto", width: 32 },
          { key: "Cantidad", label: "Cantidad", width: 16, format: "0.###" },
          { key: "Transacciones", label: "Transacciones", width: 18, format: "0" },
          { key: "Ingresos", label: "Ingresos (CLP)", width: 20, format: amountFormat },
          { key: "Ganancia", label: "Ganancia (CLP)", width: 20, format: amountFormat },
        ],
      ),
      "Más vendidos",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Productos con menor rotación",
        "Productos activos ordenados desde la menor cantidad vendida.",
        r.lowRotation.map((p) => ({
          Producto: p.name,
          Cantidad: p.qty,
          Ingresos: p.amount,
          Ganancia: p.profit,
        })),
        [
          { key: "Producto", label: "Producto", width: 32 },
          { key: "Cantidad", label: "Cantidad vendida", width: 20, format: "0.###" },
          { key: "Ingresos", label: "Ingresos (CLP)", width: 20, format: amountFormat },
          { key: "Ganancia", label: "Ganancia (CLP)", width: 20, format: amountFormat },
        ],
      ),
      "Menor rotacion",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Ventas por cajero",
        "Cantidad de ventas e ingresos por responsable.",
        r.cashierSales.map((c) => ({
          Cajero: c.name,
          Ventas: c.sales,
          Ingresos: c.amount,
        })),
        [
          { key: "Cajero", label: "Cajero", width: 32 },
          { key: "Ventas", label: "Ventas", width: 16, format: "0" },
          { key: "Ingresos", label: "Ingresos (CLP)", width: 22, format: amountFormat },
        ],
      ),
      "Por cajero",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      createExcelSheet(
        "Métodos de pago",
        "Distribución de pagos registrados por medio.",
        r.paymentsByMethod.map((p) => ({
          Metodo: p.method,
          Transacciones: p.count,
          Total: p.amount,
        })),
        [
          { key: "Metodo", label: "Método de pago", width: 28 },
          { key: "Transacciones", label: "Transacciones", width: 18, format: "0" },
          { key: "Total", label: "Total (CLP)", width: 22, format: amountFormat },
        ],
      ),
      "Metodos de pago",
    );
    XLSX.writeFile(workbook, `reportes-${fromDate}-${toDate}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    const reportPeriod = `${from.toLocaleDateString("es-CL")} al ${new Date(`${toDate}T00:00:00`).toLocaleDateString("es-CL")}`;
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
      { label: "Ventas del período", value: money(r.sales) },
      { label: "Ganancia estimada", value: money(r.profit) },
      { label: "Transacciones", value: String(r.count) },
      { label: monthLabel, value: money(r.thisMonthSales) },
    ]);
    let y = addPdfSectionHeading(
      doc,
      "Productos más vendidos",
      "Ordenados por cantidad vendida durante el período seleccionado.",
      72,
    );
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Producto", "Cantidad", "Transacciones", "Ingresos", "Ganancia"]],
      body: r.top.length
        ? r.top
            .slice(0, 15)
            .map((p) => [
              p.name,
              qtyLabel(p.qty, p.unit),
              String(p.transactions),
              money(p.amount),
              money(p.profit),
            ])
        : [["Sin ventas registradas en este período.", "", "", "", ""]],
    });

    doc.addPage();
    y = addPdfSectionHeading(
      doc,
      "Métodos de pago",
      "Distribución de las transacciones registradas por medio de pago.",
      42,
    );
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Método de pago", "Transacciones", "Total"]],
      body: r.paymentsByMethod.length
        ? r.paymentsByMethod.map((p) => [p.method, String(p.count), money(p.amount)])
        : [["Sin pagos registrados en este período.", "", ""]],
    });

    y = doc.lastAutoTable.finalY + 12;
    if (y > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 42;
    }
    y = addPdfSectionHeading(
      doc,
      "Ventas por cajero",
      "Cantidad de ventas e ingresos por responsable.",
      y,
    );
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Cajero", "Ventas", "Ingresos"]],
      body: r.cashierSales.length
        ? r.cashierSales.map((c) => [c.name, String(c.sales), money(c.amount)])
        : [["Sin ventas asignadas a cajeros en este período.", "", ""]],
    });

    doc.addPage();
    y = addPdfSectionHeading(
      doc,
      "Productos con menor rotación",
      "Productos activos ordenados desde la menor cantidad vendida.",
      42,
    );
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Producto", "Cantidad vendida", "Ingresos", "Ganancia"]],
      body: r.lowRotation.length
        ? r.lowRotation
            .slice(0, 20)
            .map((p) => [p.name, qtyLabel(p.qty, p.unit), money(p.amount), money(p.profit)])
        : [["No hay productos activos para comparar.", "", "", ""]],
    });

    addPdfPageChrome(doc, "Reporte de ventas", `Período: ${reportPeriod}`);
    doc.save(`reportes-${fromDate}-${toDate}.pdf`);
  };

  const selectPreset = (days: number | "month") => {
    const end = new Date();
    const start = days === "month" ? startOfMonth(end) : addDays(end, -(days - 1));
    setFromDate(dateValue(start));
    setToDate(dateValue(end));
  };

  const setFullMonth = () => {
    const end = new Date();
    setFromDate(dateValue(startOfMonth(end)));
    setToDate(dateValue(end));
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
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={!validDates || reportQuery.isLoading}
            >
              <Download className="size-4" /> Exportar Excel
            </Button>
            <Button
              variant="outline"
              onClick={exportPdf}
              disabled={!validDates || reportQuery.isLoading}
            >
              <FileText className="size-4" /> Exportar PDF
            </Button>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <ReportDatePicker
              id="report-from"
              label="Desde"
              value={fromDate}
              max={toDate}
              onChange={setFromDate}
            />
            <ReportDatePicker
              id="report-to"
              label="Hasta"
              value={toDate}
              min={fromDate}
              onChange={setToDate}
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => selectPreset(1)}>
              Hoy
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => selectPreset(7)}>
              7 días
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={setFullMonth}>
              Este mes
            </Button>
          </div>
        </CardContent>
      </Card>

      {!validDates && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Selecciona un período válido: la fecha inicial debe ser anterior o igual a la fecha final.
        </p>
      )}
      {reportQuery.isError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          No se pudieron cargar los datos del reporte: {reportQuery.error.message}
        </p>
      )}
      {(productsQueryResult.isError || profilesQueryResult.isError) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          No se pudo cargar el catálogo o los responsables:
          {productsQueryResult.isError ? ` ${productsQueryResult.error.message}` : ""}
          {profilesQueryResult.isError ? ` ${profilesQueryResult.error.message}` : ""}
        </p>
      )}
      {reportQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          Actualizando el reporte para las fechas seleccionadas…
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <ReportMetric
          label="Ventas del período"
          value={money(r.sales)}
          icon={ShoppingBag}
          detail={
            <span className={r.change >= 0 ? "text-primary" : "text-destructive"}>
              {pct(r.change)} vs. período anterior · {r.count} ventas
            </span>
          }
          tone="default"
        />
        <ReportMetric
          label="Costo de ventas"
          value={money(r.cogs)}
          icon={ReceiptText}
          detail="Costo de los productos vendidos"
        />
        <ReportMetric
          label="Mermas"
          value={money(r.merma)}
          detail="Pérdida registrada por vencimiento"
          icon={PackageSearch}
          tone={r.merma ? "warn" : "default"}
        />
        <ReportMetric
          label="Ganancia estimada"
          value={money(r.profit)}
          detail={
            r.sales > 0
              ? `Margen estimado ${((r.profit / r.sales) * 100).toFixed(0)}%`
              : "Sin ventas"
          }
          icon={TrendingUp}
          tone={r.profit >= 0 ? "good" : "danger"}
        />
        <ReportMetric
          label={`Ventas de ${monthLabel}`}
          value={money(r.thisMonthSales)}
          detail={
            <>
              {pct(r.monthChange)} vs. mes anterior · {money(r.lastMonthSales)}
            </>
          }
          icon={ChartNoAxesCombined}
          tone={r.monthChange >= 0 ? "good" : "danger"}
        />
      </div>

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="summary" className="gap-2">
            <ChartNoAxesCombined className="size-4" /> Resumen
          </TabsTrigger>
          <TabsTrigger value="products" className="gap-2">
            <ShoppingBag className="size-4" /> Productos
          </TabsTrigger>
          <TabsTrigger value="operation" className="gap-2">
            <UsersRound className="size-4" /> Operación
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-muted/20 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ChartNoAxesCombined className="size-4" />
                  </span>
                  Ventas y ganancia en el período
                </CardTitle>
                <p className="pl-10 text-xs text-muted-foreground">
                  Ingresos y utilidad estimada por fecha.
                </p>
              </CardHeader>
              <CardContent className="h-72 p-4 pt-5 sm:h-80 sm:p-5">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.series} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                      width={36}
                    />
                    <Tooltip
                      formatter={(v: number, n: string) => [
                        money(v),
                        n === "ventas" ? "Ventas" : "Utilidad",
                      ]}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--foreground)",
                      }}
                      cursor={{ fill: "var(--muted)" }}
                    />
                    <Bar dataKey="ventas" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="utilidad" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-accent/40 bg-gradient-to-br from-accent/10 via-card to-card">
              <div className="pointer-events-none absolute -right-8 -top-8 size-36 rounded-full bg-accent/10 blur-2xl" />
              <CardHeader className="relative border-b border-accent/15 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
                    <Star className="size-4 fill-current" />
                  </span>
                  Producto estrella
                </CardTitle>
              </CardHeader>
              <CardContent className="relative p-5">
                {star ? (
                  <>
                    <p className="text-2xl font-bold tracking-tight">{star.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {qtyLabel(+star.qty.toFixed(3), star.unit)} en {star.transactions}{" "}
                      transacciones
                    </p>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Ingresos
                        </p>
                        <p className="mt-1 font-bold">{money(star.amount)}</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Ganancia
                        </p>
                        <p className="mt-1 font-bold">{money(star.profit)}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin ventas en este período.</p>
                )}
                <div className="mt-5 border-t border-accent/20 pt-3 text-xs text-muted-foreground">
                  Entradas registradas: {money(r.entradas)} a costo · {products.length} productos en
                  catálogo
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="products" className="space-y-5">
          <Card>
            <CardHeader className="border-b bg-muted/20 px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShoppingBag className="size-4" />
                </span>
                Productos más vendidos
              </CardTitle>
              <p className="pl-10 text-xs text-muted-foreground">
                Ordenados por cantidad vendida en las fechas seleccionadas.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
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
                      <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                        <span className="mx-auto flex max-w-xs flex-col items-center gap-2">
                          <ShoppingBag className="size-6 opacity-40" />
                          Sin datos de ventas en el período seleccionado.
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                  {r.top.slice(0, 15).map((p, i) => (
                    <TableRow key={p.id} className="transition-colors hover:bg-muted/30">
                      <TableCell>
                        <span
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                            i === 0
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold">{p.name}</TableCell>
                      <TableCell className="text-right">
                        {qtyLabel(+p.qty.toFixed(3), p.unit)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.transactions}
                      </TableCell>
                      <TableCell className="text-right">{money(p.amount)}</TableCell>
                      <TableCell className={cn("text-right", p.profit < 0 && "text-destructive")}>
                        {money(p.profit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-muted/20 px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
                  <ArrowDownWideNarrow className="size-4" />
                </span>
                Productos con menor rotación
              </CardTitle>
              <p className="pl-10 text-xs text-muted-foreground">
                Ordenados por cantidad vendida en las fechas seleccionadas.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cantidad vendida</TableHead>
                    <TableHead className="text-right">Ingresos</TableHead>
                    <TableHead className="text-right">Ganancia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.lowRotation.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                        No hay productos activos para comparar.
                      </TableCell>
                    </TableRow>
                  ) : (
                    r.lowRotation.slice(0, 15).map((product) => (
                      <TableRow key={product.id} className="transition-colors hover:bg-muted/30">
                        <TableCell className="font-semibold">{product.name}</TableCell>
                        <TableCell className="text-right">
                          {qtyLabel(product.qty, product.unit)}
                        </TableCell>
                        <TableCell className="text-right">{money(product.amount)}</TableCell>
                        <TableCell
                          className={cn("text-right", product.profit < 0 && "text-destructive")}
                        >
                          {money(product.profit)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operation">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b bg-muted/20 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <UsersRound className="size-4" />
                  </span>
                  Ventas por cajero
                </CardTitle>
                <p className="pl-10 text-xs text-muted-foreground">
                  Actividad e ingresos por responsable.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead>Cajero</TableHead>
                      <TableHead className="text-right">Ventas</TableHead>
                      <TableHead className="text-right">Ingresos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.cashierSales.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                          Sin ventas en este período.
                        </TableCell>
                      </TableRow>
                    ) : (
                      r.cashierSales.map((cashier) => (
                        <TableRow key={cashier.id} className="transition-colors hover:bg-muted/30">
                          <TableCell className="font-semibold">{cashier.name}</TableCell>
                          <TableCell className="text-right">{cashier.sales}</TableCell>
                          <TableCell className="text-right">{money(cashier.amount)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b bg-muted/20 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CreditCard className="size-4" />
                  </span>
                  Métodos de pago
                </CardTitle>
                <p className="pl-10 text-xs text-muted-foreground">
                  Distribución de pagos registrados por medio.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Transacciones</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.paymentsByMethod.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                          No hay métodos de pago registrados en este período.
                        </TableCell>
                      </TableRow>
                    ) : (
                      r.paymentsByMethod.map((payment) => (
                        <TableRow
                          key={payment.method}
                          className="transition-colors hover:bg-muted/30"
                        >
                          <TableCell>
                            <span className="inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize">
                              <CreditCard className="size-3.5 text-muted-foreground" />
                              {payment.method}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{payment.count}</TableCell>
                          <TableCell className="text-right">{money(payment.amount)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
