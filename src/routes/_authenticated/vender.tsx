import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Minus, Plus, Printer, ScanLine, Search, Tag, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { categoriesQuery, movementsQuery, productsQuery, promotionsQuery, qk, settingsQuery } from "@/lib/queries";
import { effectivePrice, findByCode, money, qtyLabel, rangeStart, type Product, type Unit } from "@/lib/inventory";
import { useAuth } from "@/lib/auth-context";
import { Kpi } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/vender")({
  head: () => ({ meta: [{ title: "Vender — Invenco" }] }),
  component: SellPage,
});

type Receipt = {
  id: string;
  total: number;
  createdAt: string;
  items: { productName: string; qty: number; unit: Unit; amount: number }[];
};

type CartLine = {
  product_id: string;
  product_name: string;
  unit: Unit;
  qty: number;
  unit_price: number;
  discount_pct: number;
  subtotal: number;
};

const CART_KEY = "invenco:vender:cart";

const readCart = (): CartLine[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
};

const persistCart = (items: CartLine[]) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // noop
  }
};

const parseDecimal = (raw: string) => {
  if (!raw) return null;
  const next = raw.trim().replace(",", ".");
  const value = Number(next);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const matchProductByScan = (value: string, products: Product[]) => {
  const query = value.trim().toLowerCase();
  if (!query) return undefined;

  const direct = products.find((p) => (p.code ?? "").trim().toLowerCase() === query);
  if (direct) return direct;

  const keyword = products.find((p) => (p.keyword ?? "").trim().toLowerCase() === query);
  if (keyword) return keyword;

  const name = products.find((p) => p.name.trim().toLowerCase() === query);
  if (name) return name;

  return undefined;
};

function SellPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { data: products = [] } = useQuery(productsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: promotions = [] } = useQuery(promotionsQuery);
  const { data: settings } = useQuery(settingsQuery);
  const { data: movements = [] } = useQuery(movementsQuery(2));
  const [scanValue, setScanValue] = useState("");
  const [cart, setCart] = useState<CartLine[]>(readCart);
  const [pendingWeightProduct, setPendingWeightProduct] = useState<Product | null>(null);
  const [weightDraft, setWeightDraft] = useState("0.5");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [promotionFormOpen, setPromotionFormOpen] = useState(false);
  const [promotionCategory, setPromotionCategory] = useState("all");
  const [promotionProductCategory, setPromotionProductCategory] = useState("all");
  const [promotionProductId, setPromotionProductId] = useState("");
  const [promotionType, setPromotionType] = useState<"price" | "bundle">("price");
  const [promotionTitle, setPromotionTitle] = useState("");
  const [promotionDescription, setPromotionDescription] = useState("");
  const [promotionPrice, setPromotionPrice] = useState("");
  const [bundleQty, setBundleQty] = useState("3");
  const [bundlePrice, setBundlePrice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    persistCart(cart);
  }, [cart]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const today = useMemo(() => {
    const from = rangeStart("day").getTime();
    const sales = movements.filter((m) => m.type === "out" && new Date(m.ts).getTime() >= from);
    return { count: sales.length, total: sales.reduce((s, m) => s + Number(m.amount), 0) };
  }, [movements]);

  const searchResults = useMemo(() => {
    const query = scanValue.trim().toLowerCase();
    if (!query) return [];
    return products
      .filter(
        (p) =>
          p.active &&
          (p.name.toLowerCase().includes(query) ||
            (p.keyword ?? "").toLowerCase().includes(query) ||
            (p.code ?? "").toLowerCase().includes(query)),
      )
      .slice(0, 8);
  }, [products, scanValue]);

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.subtotal, 0), [cart]);
  const promotionByProduct = useMemo(
    () => new Map(promotions.map((promotion) => [promotion.product_id, promotion])),
    [promotions],
  );
  const promotionProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.active &&
          Number(product.stock) > 0 &&
          (promotionProductCategory === "all" || product.category_id === promotionProductCategory),
      ),
    [products, promotionProductCategory],
  );
  const selectedPromotionProduct = promotionProducts.find((product) => product.id === promotionProductId);
  const visiblePromotions = promotions.filter((promotion) => {
    const product = products.find((item) => item.id === promotion.product_id);
    if (!product?.active || Number(product.stock) <= 0) return false;
    return promotionCategory === "all" || product.category_id === promotionCategory;
  });

  const calculateSubtotal = (product: Product, qty: number) => {
    const promotion = promotionByProduct.get(product.id);
    if (promotion?.promo_type === "price" && promotion.promo_price !== null) {
      return Number((qty * Number(promotion.promo_price)).toFixed(2));
    }
    if (
      promotion?.promo_type === "bundle" &&
      promotion.bundle_qty !== null &&
      promotion.bundle_price !== null
    ) {
      const sets = Math.floor(qty / promotion.bundle_qty);
      const remainder = qty % promotion.bundle_qty;
      return Number(
        (sets * Number(promotion.bundle_price) + remainder * effectivePrice(product)).toFixed(2),
      );
    }
    return Number((qty * effectivePrice(product)).toFixed(2));
  };

  const savePromotion = useMutation({
    mutationFn: async () => {
      if (!selectedPromotionProduct) throw new Error("Selecciona un producto activo con stock.");
      const title = promotionTitle.trim();
      if (!title) throw new Error("Escribe el nombre de la promoción.");

      const offer =
        promotionType === "price"
          ? {
              promo_type: "price" as const,
              promo_price: parseDecimal(promotionPrice),
              bundle_qty: null,
              bundle_price: null,
            }
          : {
              promo_type: "bundle" as const,
              promo_price: null,
              bundle_qty: Number(bundleQty),
              bundle_price: parseDecimal(bundlePrice),
            };

      if (promotionType === "price") {
        if (offer.promo_price === null) throw new Error("Ingresa un precio promocional válido.");
        if (offer.promo_price >= effectivePrice(selectedPromotionProduct)) {
          throw new Error("El precio promocional debe ser menor al precio actual del producto.");
        }
      } else {
        if (
          offer.bundle_qty === null ||
          !Number.isInteger(offer.bundle_qty) ||
          offer.bundle_qty < 2
        ) {
          throw new Error("La cantidad de productos de la oferta debe ser al menos 2.");
        }
        if (offer.bundle_price === null) throw new Error("Ingresa el precio del paquete.");
        if (selectedPromotionProduct.unit !== "unidad") {
          throw new Error("Las promociones por paquete solo están disponibles para productos por unidad.");
        }
        if (offer.bundle_price >= effectivePrice(selectedPromotionProduct) * offer.bundle_qty) {
          throw new Error("El precio del paquete debe ser menor al precio normal de esas unidades.");
        }
      }

      const { error } = await supabase.from("promotions").upsert(
        {
          product_id: selectedPromotionProduct.id,
          title,
          description: promotionDescription.trim() || null,
          ...offer,
          active: true,
        },
        { onConflict: "product_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Promoción guardada.");
      qc.invalidateQueries({ queryKey: qk.promotions });
      setPromotionFormOpen(false);
      setPromotionProductId("");
      setPromotionTitle("");
      setPromotionDescription("");
      setPromotionPrice("");
      setBundlePrice("");
      setBundleQty("3");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const finishPromotion = useMutation({
    mutationFn: async (promotionId: string) => {
      const { error } = await supabase.from("promotions").update({ active: false }).eq("id", promotionId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Promoción finalizada.");
      qc.invalidateQueries({ queryKey: qk.promotions });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const storeName = settings?.store_name || "Invenco";
  const storeAddress = [settings?.address, settings?.city].filter(Boolean).join(" — ") || "Local comercial";

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const lowStockWarning = (product: Product) => {
    const stock = Number(product.stock) || 0;
    const min = Number(product.min_stock) || 0;
    if (min > 0 && stock <= min) {
      toast.warning(`${product.name} quedó bajo el mínimo (${qtyLabel(stock, product.unit)} / meta ${qtyLabel(min, product.unit)})`);
    }
  };

  const addLineToCart = (product: Product, qty: number) => {
    if (!product.active) {
      toast.error(`${product.name} está inactivo.`);
      return;
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("La cantidad debe ser mayor a cero.");
      return;
    }

    if (product.unit !== "kilo" && !Number.isInteger(qty)) {
      toast.error("Las unidades deben ser números enteros.");
      return;
    }

    const stock = Number(product.stock) || 0;
    const line = cart.find((item) => item.product_id === product.id);
    const nextQty = (line?.qty ?? 0) + qty;

    if (nextQty > stock) {
      toast.error(`Stock insuficiente para ${product.name}. Quedan ${qtyLabel(stock, product.unit)}.`);
      return;
    }

    const subtotal = calculateSubtotal(product, qty);
    const unitPrice = subtotal / qty;

    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product_id === product.id
            ? {
                ...item,
                qty: Number((item.qty + qty).toFixed(3)),
                unit_price: calculateSubtotal(product, item.qty + qty) / (item.qty + qty),
                discount_pct: Number(product.discount_pct || 0),
                subtotal: calculateSubtotal(product, item.qty + qty),
              }
            : item,
        );
      }

      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          unit: product.unit,
          qty: Number(qty.toFixed(3)),
          unit_price: unitPrice,
          discount_pct: Number(product.discount_pct || 0),
          subtotal,
        },
      ];
    });

    lowStockWarning(product);
    setScanValue("");
    focusInput();
  };

  const handleManualSelect = (product: Product) => {
    if (product.unit === "kilo") {
      setPendingWeightProduct(product);
      setWeightDraft("0.5");
      return;
    }

    addLineToCart(product, 1);
  };

  const handleScan = (value: string) => {
    const query = value.trim();
    if (!query) return;

    const product = matchProductByScan(query, products);
    if (product) {
      if (product.unit === "kilo") {
        setPendingWeightProduct(product);
        setWeightDraft("0.5");
        setScanValue("");
        focusInput();
        return;
      }

      addLineToCart(product, 1);
      return;
    }

    if (searchResults.length > 0) {
      const first = searchResults[0];
      if (first && searchResults.length === 1) {
        handleManualSelect(first);
        return;
      }
      toast.info("Selecciona uno de los resultados para agregarlo al carrito.");
      return;
    }

    toast.error(`No existe un producto para: “${query}”.`);
    setScanValue("");
    focusInput();
  };

  const updateCartQty = (product_id: string, nextQty: number) => {
    const line = cart.find((item) => item.product_id === product_id);
    if (!line) return;

    const product = products.find((p) => p.id === product_id);
    if (!product) return;

    if (nextQty <= 0) {
      setCart((prev) => prev.filter((item) => item.product_id !== product_id));
      return;
    }

    if (product.unit !== "kilo" && !Number.isInteger(nextQty)) {
      toast.error("Las unidades deben ser enteras.");
      return;
    }

    const stock = Number(product.stock) || 0;
    if (nextQty > stock) {
      toast.error(`Stock insuficiente para ${product.name}. Quedan ${qtyLabel(stock, product.unit)}.`);
      return;
    }

    const subtotal = calculateSubtotal(product, nextQty);
    setCart((prev) =>
      prev.map((item) =>
        item.product_id === product_id
          ? {
              ...item,
              qty: Number(nextQty.toFixed(3)),
              unit_price: subtotal / nextQty,
              subtotal,
            }
          : item,
      ),
    );

    lowStockWarning(product);
  };

  const checkout = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("El carrito está vacío.");

      const payload = cart.map((item) => ({
        product_id: item.product_id,
        qty: Number(item.qty),
      }));

      const { data, error } = await supabase.rpc("register_sale", {
        _items: payload,
        _note: "Venta POS",
      });

      if (error) throw new Error(error.message);
      return { saleId: (data as string | null) ?? `INV-${Date.now()}`, total: cartTotal };
    },
    onSuccess: ({ saleId, total }) => {
      const nextReceipt: Receipt = {
        id: saleId,
        total,
        createdAt: new Date().toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }),
        items: cart.map((item) => ({
          productName: item.product_name,
          qty: item.qty,
          unit: item.unit,
          amount: item.subtotal,
        })),
      };

      setReceipt(nextReceipt);
      setCart([]);
      setScanValue("");
      toast.success(`Venta cobrada por ${money(total)}`);
      qc.invalidateQueries({ queryKey: qk.products });
      qc.invalidateQueries({ queryKey: qk.lots });
      qc.invalidateQueries({ queryKey: qk.movements(2) });
      focusInput();
    },
    onError: (e: Error) => {
      toast.error(e.message || "No se pudo registrar la venta.");
    },
  });

  const clearCart = () => {
    if (cart.length === 0) return;
    const ok = window.confirm("¿Vaciar el carrito actual?");
    if (!ok) return;
    setCart([]);
    toast.info("Carrito vaciado.");
    focusInput();
  };

  const handleWeightSubmit = () => {
    if (!pendingWeightProduct) return;
    const qty = parseDecimal(weightDraft);
    if (!qty) {
      toast.error("Ingresa un peso válido en kg.");
      return;
    }

    addLineToCart(pendingWeightProduct, qty);
    setPendingWeightProduct(null);
    setWeightDraft("0.5");
  };

  return (
    <>
      <style>{`
        @page {
          size: 80mm auto;
          margin: 0;
        }

        @media print {
          html, body {
            background: white !important;
          }

          body * {
            visibility: hidden;
          }

          .receipt-print, .receipt-print * {
            visibility: visible;
          }

          .receipt-print {
            position: absolute;
            inset: 0;
            width: 100%;
            max-width: 80mm;
            margin: 0 auto;
            padding: 0;
            background: white;
            color: #111827;
            font-family: "SFMono-Regular", Consolas, monospace;
            box-shadow: none !important;
            border: none !important;
          }

          .receipt-print * {
            box-shadow: none !important;
          }
        }
      `}</style>

      {pendingWeightProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold">Peso de {pendingWeightProduct.name}</p>
              <Button type="button" variant="ghost" size="icon" onClick={() => setPendingWeightProduct(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <Input
                value={weightDraft}
                onChange={(e) => setWeightDraft(e.target.value)}
                placeholder="0.750"
                inputMode="decimal"
                autoFocus
              />
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {weightDraft ? `${Number.parseFloat(weightDraft || "0").toFixed(3)} kg × ${money(effectivePrice(pendingWeightProduct))}/kg` : "Ingresa un peso"}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setPendingWeightProduct(null)}>
                  Cancelar
                </Button>
                <Button type="button" className="flex-1" onClick={handleWeightSubmit}>
                  Agregar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Kpi label="Ventas de hoy" value={money(today.total)} sub={`${today.count} transacciones`} tone="good" />
            <Kpi label="Productos activos" value={products.filter((p) => p.active).length} sub="en catálogo" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanLine className="size-4" /> Venta por código
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleScan(scanValue);
                }}
                className="flex gap-2"
              >
                <Input
                  ref={inputRef}
                  autoFocus
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  placeholder="Escanea o escribe código, palabra clave o nombre"
                  className="h-12 text-lg"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" size="lg">
                  Agregar
                </Button>
              </form>

              {scanValue.trim() && searchResults.length > 0 && (
                <div className="rounded-lg border bg-card p-2">
                  <div className="mb-2 flex items-center gap-2 px-2 pt-1 text-xs font-medium text-muted-foreground">
                    <Search className="size-3.5" /> Resultado de búsqueda
                  </div>
                  <div className="space-y-1">
                    {searchResults.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleManualSelect(product)}
                        className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-sm transition hover:bg-muted"
                      >
                        <span>
                          <span className="font-medium">{product.name}</span>
                          <span className="ml-2 text-muted-foreground">{product.code}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{qtyLabel(Number(product.stock), product.unit)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">Carrito</p>
                  <div className="flex gap-2">
                    {cart.length > 0 && (
                      <Button type="button" variant="outline" size="sm" onClick={clearCart}>
                        <Trash2 className="size-4" /> Vaciar
                      </Button>
                    )}
                  </div>
                </div>

                {cart.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Todavía no hay productos agregados.</p>
                ) : (
                  <div className="space-y-2">
                    {cart.map((item) => {
                      const product = products.find((p) => p.id === item.product_id);
                      return (
                        <div key={item.product_id} className="rounded-md border bg-background p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">{item.product_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {money(item.unit_price)} / {item.unit === "kilo" ? "kg" : "un"}
                              </p>
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={() => setCart((prev) => prev.filter((x) => x.product_id !== item.product_id))}>
                              <X className="size-4" />
                            </Button>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => updateCartQty(item.product_id, item.qty - 1)}>
                                <Minus className="size-4" />
                              </Button>
                              <Input
                                type="number"
                                min={0}
                                step={item.unit === "kilo" ? "0.1" : "1"}
                                value={item.qty}
                                onChange={(e) => updateCartQty(item.product_id, Number(e.target.value))}
                                className="h-9 w-20 text-center"
                              />
                              <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => updateCartQty(item.product_id, item.qty + 1)}>
                                <Plus className="size-4" />
                              </Button>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">{money(item.subtotal)}</p>
                              <p className="text-[11px] text-muted-foreground">{qtyLabel(item.qty, item.unit)}</p>
                            </div>
                          </div>

                          {product &&
                            !promotionByProduct.has(product.id) &&
                            Number(product.discount_pct || 0) > 0 && (
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-accent-foreground">
                              <Badge className="gap-1 bg-accent text-accent-foreground hover:bg-accent">
                                <Tag className="size-3" /> -{product.discount_pct}%
                              </Badge>
                            </div>
                          )}
                          {promotionByProduct.get(item.product_id) && (
                            <div className="mt-2">
                              <Badge className="gap-1 bg-accent text-accent-foreground hover:bg-accent">
                                <Tag className="size-3" /> {promotionByProduct.get(item.product_id)?.title}
                              </Badge>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {cart.length > 0 && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-xl font-bold">{money(cartTotal)}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button type="button" className="flex-1" onClick={() => checkout.mutate()} disabled={checkout.isPending || cart.length === 0}>
                      {checkout.isPending ? "Cobran..." : "Cobrar"}
                    </Button>
                  </div>
                </div>
              )}

              {receipt && (
                <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Último comprobante</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="size-4" /> Imprimir
                    </Button>
                  </div>
                  <div className="receipt-print rounded-lg border bg-white p-4 text-black shadow-none">
                    <div className="text-center leading-tight">
                      <p className="text-[18px] font-black uppercase">{storeName}</p>
                      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-600">Boleta de venta</p>
                      {storeAddress && <p className="mt-1 text-[8px] text-slate-500">{storeAddress}</p>}
                    </div>

                    <div className="my-3 border-t border-b border-slate-200 py-2 text-[9px] leading-4 text-slate-700">
                      <p className="flex items-center justify-between"><span>N°</span><span>{receipt.id}</span></p>
                      <p className="flex items-center justify-between"><span>Fecha</span><span>{receipt.createdAt}</span></p>
                    </div>

                    <div className="space-y-2 text-[10px]">
                      {receipt.items.map((item) => (
                        <div key={`${receipt.id}-${item.productName}`} className="border-b border-slate-100 pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-slate-700">{item.productName}</span>
                            <span className="font-semibold">{money(item.amount)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-slate-600">
                            <span>{qtyLabel(item.qty, item.unit)}</span>
                            <span>{money(item.amount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] font-black">
                      <div className="flex items-center justify-between">
                        <span>Total</span>
                        <span>{money(receipt.total)}</span>
                      </div>
                    </div>

                    <p className="mt-4 text-center text-[8px] uppercase tracking-[0.2em] text-slate-500">
                      Gracias por su compra
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Últimas transacciones</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {movements.filter((m) => m.type === "out").length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">Aún no hay ventas.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements
                      .filter((m) => m.type === "out")
                      .slice(0, 15)
                      .map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">
                            {m.product_name}
                            {m.discount_pct > 0 && (
                              <span className="ml-2 text-xs text-accent-foreground/80">-{m.discount_pct}%</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{qtyLabel(Number(m.qty), m.unit)}</TableCell>
                          <TableCell className="text-right">{money(Number(m.amount))}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Tag className="size-4" /> Promociones
                </CardTitle>
                {isAdmin && (
                  <Button type="button" size="sm" onClick={() => setPromotionFormOpen((open) => !open)}>
                    {promotionFormOpen ? "Cerrar" : "Agregar promoción"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={promotionCategory} onValueChange={setPromotionCategory}>
                <SelectTrigger aria-label="Filtrar promociones por categoría">
                  <SelectValue placeholder="Filtrar por categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {promotionFormOpen && isAdmin && (
                <form
                  className="space-y-3 rounded-lg border bg-muted/30 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    savePromotion.mutate();
                  }}
                >
                  <p className="text-sm font-semibold">Nueva promoción</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="promotion-category">Categoría</Label>
                    <Select
                      value={promotionProductCategory}
                      onValueChange={(categoryId) => {
                        setPromotionProductCategory(categoryId);
                        setPromotionProductId("");
                      }}
                    >
                      <SelectTrigger id="promotion-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las categorías</SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="promotion-product">Producto</Label>
                    <Select
                      value={promotionProductId}
                      onValueChange={(productId) => {
                        setPromotionProductId(productId);
                        const product = promotionProducts.find((item) => item.id === productId);
                        if (product?.unit === "kilo") setPromotionType("price");
                      }}
                    >
                      <SelectTrigger id="promotion-product">
                        <SelectValue placeholder="Elige un producto" />
                      </SelectTrigger>
                      <SelectContent>
                        {promotionProducts.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} · {qtyLabel(Number(product.stock), product.unit)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="promotion-title">Nombre de la promoción</Label>
                    <Input
                      id="promotion-title"
                      value={promotionTitle}
                      onChange={(event) => setPromotionTitle(event.target.value)}
                      placeholder='Ej.: "Frugelles 3 por $100" o "Tomates maduros"'
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="promotion-type">Tipo de oferta</Label>
                    <Select
                      value={promotionType}
                      onValueChange={(value) => {
                        if (value === "price" || value === "bundle") setPromotionType(value);
                      }}
                    >
                      <SelectTrigger id="promotion-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="price">Precio especial por unidad o kilo</SelectItem>
                        <SelectItem value="bundle" disabled={selectedPromotionProduct?.unit !== "unidad"}>
                          Oferta por cantidad (ej. 3 por $100)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {promotionType === "price" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="promotion-price">
                        Precio promocional{selectedPromotionProduct?.unit === "kilo" ? " por kilo" : ""}
                      </Label>
                      <Input
                        id="promotion-price"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={promotionPrice}
                        onChange={(event) => setPromotionPrice(event.target.value)}
                        required
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="promotion-quantity">Unidades</Label>
                        <Input
                          id="promotion-quantity"
                          type="number"
                          min="2"
                          step="1"
                          value={bundleQty}
                          onChange={(event) => setBundleQty(event.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="promotion-bundle-price">Precio del paquete</Label>
                        <Input
                          id="promotion-bundle-price"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={bundlePrice}
                          onChange={(event) => setBundlePrice(event.target.value)}
                          required
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="promotion-description">Detalle (opcional)</Label>
                    <Textarea
                      id="promotion-description"
                      value={promotionDescription}
                      onChange={(event) => setPromotionDescription(event.target.value)}
                      placeholder="Ej.: producto más maduro; vender pronto"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={savePromotion.isPending}>
                    {savePromotion.isPending ? "Guardando…" : "Guardar promoción"}
                  </Button>
                </form>
              )}

              {visiblePromotions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay promociones activas en esta categoría.</p>
              ) : (
                <div className="space-y-2">
                  {visiblePromotions.map((promotion) => {
                    const product = products.find((item) => item.id === promotion.product_id);
                    if (!product) return null;
                    const category = categories.find((item) => item.id === product.category_id);
                    return (
                      <div
                        key={promotion.id}
                        className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">{promotion.title}</p>
                            <Badge variant="secondary">{category?.name ?? "Sin categoría"}</Badge>
                          </div>
                          <p className="mt-1 text-sm">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {promotion.promo_type === "bundle"
                              ? `${promotion.bundle_qty} unidades por ${money(Number(promotion.bundle_price))}`
                              : `${money(Number(promotion.promo_price))}${product.unit === "kilo" ? " / kg" : " / unidad"}`}
                          </p>
                          {promotion.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{promotion.description}</p>
                          )}
                        </div>
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => finishPromotion.mutate(promotion.id)}
                            disabled={finishPromotion.isPending}
                          >
                            Finalizar
                          </Button>
                        )}
                        <Button type="button" size="sm" onClick={() => handleManualSelect(product)}>
                          Agregar
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
