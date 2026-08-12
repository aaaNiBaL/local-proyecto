import { useCallback, useEffect, useState } from "react";

export type Unit = "unidad" | "kilo";

export type Product = {
  id: string;
  name: string;
  barcode?: string;
  keyword?: string;
  unit: Unit;
  /** Precio por unidad o por kilo */
  price: number;
  /** Existencias en unidades o kilos */
  stock: number;
};

export type Movement = {
  id: string;
  ts: number;
  type: "in" | "out";
  productId: string;
  productName: string;
  qty: number;
  /** Monto en dinero (venta o costo estimado de entrada) */
  amount: number;
  unit: Unit;
};

export type Data = { products: Product[]; movements: Movement[] };

const KEY = "almacen-v1";
const empty: Data = { products: [], movements: [] };

function read(): Data {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Data;
    return {
      products: Array.isArray(parsed.products) ? parsed.products : [],
      movements: Array.isArray(parsed.movements) ? parsed.movements : [],
    };
  } catch {
    return empty;
  }
}

const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const money = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(
    Math.round(n),
  );

export const qtyLabel = (qty: number, unit: Unit) =>
  unit === "kilo" ? `${qty.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} kg` : `${qty} un`;

export function findByCode(products: Product[], code: string) {
  const c = code.trim().toLowerCase();
  return products.find(
    (p) => (p.barcode && p.barcode.toLowerCase() === c) || (p.keyword && p.keyword.toLowerCase() === c),
  );
}

/**
 * Interpreta lo que se escribe en la caja:
 *  - "7801234567890"        -> código de barras, 1 unidad
 *  - "7801234567890 x3"     -> código de barras, 3 unidades
 *  - "p 1500"               -> palabra clave "p" por $1500 (si es por kilo, calcula los kilos)
 *  - "pa 4"                 -> palabra clave "pa", 4 unidades
 */
export type ParsedSale =
  | { ok: true; product: Product; qty: number; amount: number }
  | { ok: false; error: string; unknownCode?: string };

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
    return {
      ok: false,
      error: `No existe un producto con el código o palabra clave "${code}".`,
      unknownCode: code,
    };

  let qty: number;
  let amount: number;

  if (product.unit === "kilo") {
    if (value === undefined)
      return { ok: false, error: `${product.name} se vende por peso: escribe "${code} <precio>".` };
    // El valor ingresado es el monto cobrado; se deducen los kilos con el precio por kilo.
    amount = value;
    qty = product.price > 0 ? value / product.price : 0;
  } else {
    qty = value ?? 1;
    amount = qty * product.price;
  }

  if (qty > product.stock)
    return {
      ok: false,
      error: `Stock insuficiente de ${product.name}: quedan ${qtyLabel(product.stock, product.unit)}.`,
    };

  return { ok: true, product, qty, amount };
}

export type Range = "day" | "week" | "month";

export function rangeStart(range: Range, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (range === "week") d.setDate(d.getDate() - 6);
  if (range === "month") d.setDate(d.getDate() - 29);
  return d.getTime();
}

export function useStore() {
  const [data, setData] = useState<Data>(empty);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setData(read());
    setReady(true);
  }, []);

  const save = useCallback((next: Data) => {
    setData(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* almacenamiento no disponible */
    }
  }, []);

  const upsertProduct = useCallback(
    (p: Omit<Product, "id" | "stock"> & { id?: string; stock?: number }) => {
      const products = [...data.products];
      const i = p.id ? products.findIndex((x) => x.id === p.id) : -1;
      if (i >= 0) {
        products[i] = { ...products[i]!, ...p, id: products[i]!.id };
      } else {
        products.push({ ...p, id: uid(), stock: p.stock ?? 0 } as Product);
      }
      save({ ...data, products });
    },
    [data, save],
  );

  const removeProduct = useCallback(
    (id: string) => save({ ...data, products: data.products.filter((p) => p.id !== id) }),
    [data, save],
  );

  const addEntry = useCallback(
    (productId: string, qty: number) => {
      const product = data.products.find((p) => p.id === productId);
      if (!product) return;
      const products = data.products.map((p) =>
        p.id === productId ? { ...p, stock: +(p.stock + qty).toFixed(3) } : p,
      );
      const mov: Movement = {
        id: uid(),
        ts: Date.now(),
        type: "in",
        productId,
        productName: product.name,
        qty,
        amount: qty * product.price,
        unit: product.unit,
      };
      save({ products, movements: [mov, ...data.movements] });
    },
    [data, save],
  );

  const addSale = useCallback(
    (productId: string, qty: number, amount: number) => {
      const product = data.products.find((p) => p.id === productId);
      if (!product) return;
      const products = data.products.map((p) =>
        p.id === productId ? { ...p, stock: Math.max(0, +(p.stock - qty).toFixed(3)) } : p,
      );
      const mov: Movement = {
        id: uid(),
        ts: Date.now(),
        type: "out",
        productId,
        productName: product.name,
        qty,
        amount,
        unit: product.unit,
      };
      save({ products, movements: [mov, ...data.movements] });
    },
    [data, save],
  );

  return { data, ready, upsertProduct, removeProduct, addEntry, addSale };
}
