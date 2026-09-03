import type { Database, Tables } from "@/integrations/supabase/types";

export type Product = Tables<"products">;
export type Lot = Tables<"lots">;
export type Movement = Tables<"movements">;
export type Category = Tables<"categories">;
export type Settings = Tables<"settings">;
export type Profile = Tables<"profiles">;
export type AppRole = Database["public"]["Enums"]["app_role"];
export type Unit = Database["public"]["Enums"]["product_unit"];
export type Nature = Database["public"]["Enums"]["product_nature"];

export const NATURES: { value: Nature; label: string; hint: string }[] = [
  { value: "consumible", label: "Consumible / Venta directa", hint: "Abarrotes, bebidas, panadería…" },
  { value: "empaque", label: "Empaques / Insumos", hint: "Bolsas, cajas de embalaje" },
  { value: "herramienta", label: "Herramientas", hint: "Equipamiento del local" },
  { value: "repuesto", label: "Repuestos / Mantenimiento", hint: "Elementos de reparación" },
];

export const natureLabel = (n: Nature) => NATURES.find((x) => x.value === n)?.label ?? n;

export const money = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(
    Math.round(n),
  );

export const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(0)}%`;

export const qtyLabel = (qty: number, unit: Unit) =>
  unit === "kilo"
    ? `${Number(qty).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} kg`
    : `${Number(qty)} un`;

/** Precio efectivo con descuento flash aplicado */
export const effectivePrice = (p: Pick<Product, "price" | "discount_pct">) =>
  Number(p.price) * (1 - (p.discount_pct ?? 0) / 100);

export function findByCode(products: Product[], code: string) {
  const c = code.trim().toLowerCase();
  if (!c) return undefined;
  return products.find(
    (p) => (p.code && p.code.toLowerCase() === c) || (p.keyword && p.keyword.toLowerCase() === c),
  );
}

export type ParsedSale =
  | { ok: true; product: Product; qty: number; amount: number }
  | { ok: false; error: string; unknownCode?: string };

/**
 * "7801234567890"     -> código, 1 unidad
 * "7801234567890 x3"  -> código, 3 unidades
 * "p 1500"            -> clave "p" por $1500 (por kilo => calcula kilos)
 * "pa 4"              -> clave "pa", 4 unidades
 */
export function parseSale(input: string, products: Product[]): ParsedSale {
  const raw = input.trim().replace(/\s+/g, " ");
  if (!raw) return { ok: false, error: "Escribe un código de barras o una palabra clave." };

  const parts = raw.split(/[\s*x×]+/i).filter(Boolean);
  const code = parts[0]!;
  const valueStr = parts[1]?.replace(",", ".");
  const value = valueStr ? Number(valueStr) : undefined;
  if (valueStr && (!Number.isFinite(value!) || value! <= 0))
    return { ok: false, error: `Cantidad o precio inválido: "${valueStr}".` };

  const product = findByCode(products, code);
  if (!product)
    return { ok: false, error: `No existe un producto con el código o clave "${code}".`, unknownCode: code };
  if (!product.active) return { ok: false, error: `${product.name} está inactivo.` };

  const unitPrice = effectivePrice(product);
  let qty: number;
  let amount: number;

  if (product.unit === "kilo") {
    if (value === undefined)
      return { ok: false, error: `${product.name} se vende por peso: escribe "${code} <monto>".` };
    amount = value;
    qty = unitPrice > 0 ? +(value / unitPrice).toFixed(3) : 0;
  } else {
    qty = value ?? 1;
    amount = Math.round(qty * unitPrice);
  }

  const stock = Number(product.stock);
  if (qty > stock)
    return { ok: false, error: `Stock insuficiente de ${product.name}: quedan ${qtyLabel(stock, product.unit)}.` };

  return { ok: true, product, qty, amount };
}

export type Range = "day" | "week" | "month";

export function rangeStart(range: Range, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (range === "week") d.setDate(d.getDate() - 6);
  if (range === "month") d.setDate(d.getDate() - 29);
  return d;
}

export function previousRange(range: Range, now = new Date()) {
  const end = rangeStart(range, now);
  const days = range === "day" ? 1 : range === "week" ? 7 : 30;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start, end };
}

/** Semáforo de vencimiento */
export type ExpiryStatus = "vencido" | "critico" | "proximo" | "ok" | "sin-fecha";

export function daysUntil(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export function expiryStatus(date: string | null | undefined, now = new Date()): ExpiryStatus {
  const days = daysUntil(date, now);
  if (days === null) return "sin-fecha";
  if (days < 0) return "vencido";
  if (days <= 3) return "critico";
  if (days <= 10) return "proximo";
  return "ok";
}

export const fmtDate = (d: string | Date) =>
  new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(
    typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00" : d) : d,
  );

export const fmtDateTime = (d: string | Date) =>
  new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    typeof d === "string" ? new Date(d) : d,
  );

export const num = (v: string) => Number(String(v).replace(",", "."));
