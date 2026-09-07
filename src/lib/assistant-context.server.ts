import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}

/** Cliente con el token del usuario (RLS aplica como el usuario). */
export function userClient(token: string) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Falta la configuración del backend");
  return createClient<Database>(url, key, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const q = (qty: number, unit: string) => (unit === "kilo" ? `${Number(qty).toFixed(2)} kg` : `${Number(qty)} un`);

/** Resumen compacto del negocio para el asistente. */
export async function buildBusinessSnapshot(supabase: ReturnType<typeof userClient>, isAdmin: boolean) {
  const now = new Date();
  const from7 = new Date(now);
  from7.setDate(from7.getDate() - 7);
  const from30 = new Date(now);
  from30.setDate(from30.getDate() - 30);

  const [settings, products, categories, lots, movements] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("products").select("*").order("name"),
    supabase.from("categories").select("*"),
    supabase.from("lots").select("*").gt("qty", 0),
    supabase.from("movements").select("*").gte("ts", from30.toISOString()).order("ts", { ascending: false }).limit(3000),
  ]);

  const ps = products.data ?? [];
  const cats = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const mv = movements.data ?? [];
  const pName = (id: string | null) => ps.find((p) => p.id === id)?.name ?? "?";

  const todayKey = now.toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
  const isToday = (ts: string) => new Date(ts).toLocaleDateString("es-CL", { timeZone: "America/Santiago" }) === todayKey;

  const sales = mv.filter((m) => m.type === "venta");
  const salesToday = sales.filter((m) => isToday(m.ts));
  const sales7 = sales.filter((m) => new Date(m.ts) >= from7);
  const sum = (arr: typeof mv, f: (m: (typeof mv)[number]) => number) => arr.reduce((a, m) => a + f(m), 0);

  const rank = new Map<string, { qty: number; amount: number; unit: string }>();
  for (const m of sales7) {
    const p = ps.find((x) => x.id === m.product_id);
    const r = rank.get(m.product_id ?? "") ?? { qty: 0, amount: 0, unit: p?.unit ?? "unidad" };
    r.qty += Number(m.qty);
    r.amount += Number(m.amount ?? 0);
    rank.set(m.product_id ?? "", r);
  }
  const top = [...rank.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 8)
    .map(([id, r]) => `- ${pName(id)}: ${q(r.qty, r.unit)}, ${clp(r.amount)}`);

  const soldIds = new Set(sales.map((m) => m.product_id));
  const noSales30 = ps.filter((p) => !soldIds.has(p.id) && Number(p.stock) > 0).slice(0, 10);

  const low = ps.filter((p) => Number(p.stock) <= Number(p.min_stock ?? 0));
  const inDays = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - now.getTime()) / 86400000) : null);
  const expiring = (lots.data ?? [])
    .map((l) => ({ l, d: inDays(l.expires_at) }))
    .filter((x) => x.d !== null && x.d <= 7)
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
    .slice(0, 12);

  const waste30 = mv.filter((m) => m.type === "merma");
  const inventoryValue = ps.reduce((a, p) => a + Number(p.stock) * Number(p.cost ?? 0), 0);

  const lines: string[] = [];
  lines.push(`Local: ${settings.data?.store_name ?? "Minimarket"} (${settings.data?.address ?? ""}, ${settings.data?.city ?? ""}).`);
  lines.push(`Fecha/hora local: ${now.toLocaleString("es-CL", { timeZone: "America/Santiago" })}. Rol del usuario: ${isAdmin ? "administrador" : "cajero"}.`);
  lines.push(`Catálogo: ${ps.length} productos en ${cats.size} categorías. Valor de inventario a costo: ${clp(inventoryValue)}.`);
  lines.push(`Ventas HOY: ${salesToday.length} transacciones, ${clp(sum(salesToday, (m) => Number(m.amount ?? 0)))}.`);
  lines.push(
    `Ventas últimos 7 días: ${sales7.length} transacciones, ${clp(sum(sales7, (m) => Number(m.amount ?? 0)))}; costo ${clp(sum(sales7, (m) => Number(m.cost ?? 0)))}.`,
  );
  lines.push(`Mermas últimos 30 días: ${waste30.length} registros, ${clp(sum(waste30, (m) => Number(m.cost ?? 0)))}.`);
  lines.push("", "Top productos por venta (7 días):", ...(top.length ? top : ["- (sin ventas)"]));
  lines.push(
    "",
    `Bajo stock mínimo (${low.length}):`,
    ...low.slice(0, 15).map((p) => `- ${p.name} [${cats.get(p.category_id ?? "") ?? "-"}]: ${q(Number(p.stock), p.unit)} (mín ${q(Number(p.min_stock ?? 0), p.unit)})`),
  );
  lines.push(
    "",
    `Lotes que vencen en ≤7 días o vencidos (${expiring.length}):`,
    ...expiring.map(({ l, d }) => `- ${pName(l.product_id)}: ${q(Number(l.qty), ps.find((p) => p.id === l.product_id)?.unit ?? "unidad")}, ${d! < 0 ? `VENCIDO hace ${-d!} días` : d === 0 ? "vence HOY" : `vence en ${d} días`}`),
  );
  if (noSales30.length)
    lines.push("", "Con stock pero sin ventas en 30 días:", ...noSales30.map((p) => `- ${p.name}: ${q(Number(p.stock), p.unit)}`));
  lines.push(
    "",
    "Productos (nombre | código | clave | precio | stock | desc. flash):",
    ...ps.slice(0, 150).map(
      (p) => `${p.name} | ${p.code ?? "-"} | ${p.keyword ?? "-"} | ${clp(Number(p.price))}${p.unit === "kilo" ? "/kg" : ""} | ${q(Number(p.stock), p.unit)} | ${p.discount_pct ? `${p.discount_pct}%` : "-"}`,
    ),
  );
  return lines.join("\n");
}
