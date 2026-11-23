import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Minus,
  Package,
  Play,
  Plus,
  Printer,
  ScanLine,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  categoriesQuery,
  lotsQuery,
  movementsQuery,
  productsQuery,
  promotionsQuery,
  qk,
  salePaymentsQuery,
  settingsQuery,
} from "@/lib/queries";
import {
  daysUntil,
  effectivePrice,
  expiryStatus,
  findByCode,
  money,
  qtyLabel,
  rangeStart,
  type Movement,
  type Product,
  type SalePayment,
  type Unit,
} from "@/lib/inventory";
import { useAuth } from "@/lib/auth-context";
import { Kpi } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/vender")({
  head: () => ({ meta: [{ title: "Vender — Invenco" }] }),
  component: SellPage,
});

type Receipt = {
  id: string;
  subtotal: number;
  discount: number;
  total: number;
  createdAt: string;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  change: number;
  items: { productName: string; qty: number; unit: Unit; amount: number }[];
};

type PaymentMethod = "efectivo" | "tarjeta" | "transferencia";
type DiscountType = "none" | "percentage" | "fixed";

type CartLine = {
  product_id: string;
  product_name: string;
  unit: Unit;
  qty: number;
  unit_price: number;
  discount_pct: number;
  subtotal: number;
};

type SuspendedSale = {
  id: string;
  createdAt: string;
  items: CartLine[];
  paymentMethod?: PaymentMethod;
  discountType?: DiscountType;
  discountValue?: string;
  cashReceived?: string;
};

function getSuspendedSaleTotal(sale: SuspendedSale): number {
  const subtotal = sale.items.reduce((sum, item) => sum + item.subtotal, 0);
  const value = Number((sale.discountValue ?? "0").replace(",", "."));
  const discount =
    sale.discountType === "percentage"
      ? (subtotal * value) / 100
      : sale.discountType === "fixed"
        ? value
        : 0;
  return Math.max(0, Number((subtotal - (Number.isFinite(discount) ? discount : 0)).toFixed(2)));
}

type SaleSummary = {
  key: string;
  id: string;
  createdAt: string;
  items: Movement[];
  total: number;
  payment: SalePayment | undefined;
};

function groupSales(movements: Movement[], payments: SalePayment[]): SaleSummary[] {
  const paymentBySale = new Map(payments.map((payment) => [payment.sale_id, payment]));
  const grouped = new Map<string, SaleSummary>();

  for (const movement of movements) {
    if (movement.type !== "out") continue;
    const key = movement.sale_id ?? `legacy-${movement.id}`;
    const sale = grouped.get(key);
    if (sale) {
      sale.items.push(movement);
      sale.total += Number(movement.amount);
    } else {
      grouped.set(key, {
        key,
        id: movement.sale_id ?? movement.id,
        createdAt: movement.ts,
        items: [movement],
        total: Number(movement.amount),
        payment: movement.sale_id ? paymentBySale.get(movement.sale_id) : undefined,
      });
    }
  }

  return [...grouped.values()]
    .map((sale) => ({ ...sale, total: Number(sale.total.toFixed(2)) }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15);
}

const CART_KEY = "invenco:vender:cart";
const SUSPENDED_CARTS_KEY = "invenco:vender:suspended";

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

const readSuspendedCarts = (): SuspendedSale[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUSPENDED_CARTS_KEY);
    return raw ? (JSON.parse(raw) as SuspendedSale[]) : [];
  } catch {
    return [];
  }
};

const persistSuspendedCarts = (sales: SuspendedSale[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SUSPENDED_CARTS_KEY, JSON.stringify(sales));
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
  const { hasPermission } = useAuth();
  const canManagePromotions = hasPermission("promotions_manage");
  const { data: products = [] } = useQuery(productsQuery);
  const { data: lots, isLoading: lotsLoading } = useQuery(lotsQuery);
  const activeLots = useMemo(() => lots ?? [], [lots]);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: promotions = [] } = useQuery(promotionsQuery);
  const { data: settings } = useQuery(settingsQuery);
  const { data: movements = [] } = useQuery(movementsQuery(2));
  const { data: salePayments = [] } = useQuery(salePaymentsQuery(2));
  const [scanValue, setScanValue] = useState("");
  const [cart, setCart] = useState<CartLine[]>(readCart);
  const [suspendedSales, setSuspendedSales] = useState<SuspendedSale[]>(readSuspendedCarts);
  const [pendingWeightProduct, setPendingWeightProduct] = useState<Product | null>(null);
  const [weightDraft, setWeightDraft] = useState("0.5");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [cashReceived, setCashReceived] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("none");
  const [discountValue, setDiscountValue] = useState("");
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
    persistSuspendedCarts(suspendedSales);
  }, [suspendedSales]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const today = useMemo(() => {
    const from = rangeStart("day").getTime();
    const sales = movements.filter((m) => m.type === "out" && new Date(m.ts).getTime() >= from);
    return { count: sales.length, total: sales.reduce((s, m) => s + Number(m.amount), 0) };
  }, [movements]);
  const recentSales = useMemo(() => groupSales(movements, salePayments), [movements, salePayments]);
  const expiredProductIds = useMemo(
    () =>
      new Set(
        activeLots
          .filter((lot) => Number(lot.qty) > 0 && (daysUntil(lot.expires_at) ?? 0) < 0)
          .map((lot) => lot.product_id),
      ),
    [activeLots],
  );
  const discountEligibleProductIds = useMemo(
    () =>
      new Set(
        activeLots
          .filter(
            (lot) =>
              Number(lot.qty) > 0 &&
              ["critico", "proximo"].includes(expiryStatus(lot.expires_at)) &&
              !expiredProductIds.has(lot.product_id),
          )
          .map((lot) => lot.product_id),
      ),
    [activeLots, expiredProductIds],
  );
  const salePrice = (product: Product) =>
    effectivePrice({
      ...product,
      discount_pct: discountEligibleProductIds.has(product.id) ? product.discount_pct : 0,
    });
  const cartHasExpiredProducts = cart.some((item) => expiredProductIds.has(item.product_id));

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

  const cartSubtotal = useMemo(() => cart.reduce((sum, item) => sum + item.subtotal, 0), [cart]);
  const parsedDiscountValue =
    discountValue.trim() === "" ? null : Number(discountValue.replace(",", "."));
  const discountAmount =
    discountType === "percentage" &&
    parsedDiscountValue !== null &&
    Number.isFinite(parsedDiscountValue)
      ? Number(((cartSubtotal * parsedDiscountValue) / 100).toFixed(2))
      : discountType === "fixed" &&
          parsedDiscountValue !== null &&
          Number.isFinite(parsedDiscountValue)
        ? Number(parsedDiscountValue.toFixed(2))
        : 0;
  const cartTotal = Math.max(0, cartSubtotal - discountAmount);
  const parsedCashReceived =
    cashReceived.trim() === "" ? 0 : Number(cashReceived.replace(",", "."));
  const changeDue =
    paymentMethod === "efectivo" &&
    parsedCashReceived !== null &&
    Number.isFinite(parsedCashReceived)
      ? Math.max(0, Number((parsedCashReceived - cartTotal).toFixed(2)))
      : 0;
  const discountInputInvalid =
    discountType !== "none" &&
    (parsedDiscountValue === null ||
      !Number.isFinite(parsedDiscountValue) ||
      parsedDiscountValue < 0 ||
      (discountType === "percentage" && parsedDiscountValue > 100) ||
      (discountType === "fixed" && parsedDiscountValue > cartSubtotal));
  const cashInputInvalid =
    paymentMethod === "efectivo" &&
    (!Number.isFinite(parsedCashReceived) || parsedCashReceived < cartTotal);
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
  const selectedPromotionProduct = promotionProducts.find(
    (product) => product.id === promotionProductId,
  );
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
        (sets * Number(promotion.bundle_price) + remainder * salePrice(product)).toFixed(2),
      );
    }
    return Number((qty * salePrice(product)).toFixed(2));
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
        if (offer.promo_price >= salePrice(selectedPromotionProduct)) {
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
          throw new Error(
            "Las promociones por paquete solo están disponibles para productos por unidad.",
          );
        }
        if (offer.bundle_price >= salePrice(selectedPromotionProduct) * offer.bundle_qty) {
          throw new Error(
            "El precio del paquete debe ser menor al precio normal de esas unidades.",
          );
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
      const { error } = await supabase
        .from("promotions")
        .update({ active: false })
        .eq("id", promotionId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Promoción finalizada.");
      qc.invalidateQueries({ queryKey: qk.promotions });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const storeName = settings?.store_name || "Invenco";
  const storeAddress =
    [settings?.address, settings?.city, settings?.region].filter(Boolean).join(" — ") ||
    "Local comercial";

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const lowStockWarning = (product: Product) => {
    const stock = Number(product.stock) || 0;
    const min = Number(product.min_stock) || 0;
    if (min > 0 && stock <= min) {
      toast.warning(
        `${product.name} quedó bajo el mínimo (${qtyLabel(stock, product.unit)} / meta ${qtyLabel(min, product.unit)})`,
      );
    }
  };

  const addLineToCart = (product: Product, qty: number) => {
    if (lotsLoading) {
      toast.error("Espera a que se cargue el estado de los lotes antes de vender.");
      return;
    }

    if (expiredProductIds.has(product.id)) {
      toast.error(`${product.name} tiene lotes vencidos. Registra la merma antes de venderlo.`);
      return;
    }

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
      toast.error(
        `Stock insuficiente para ${product.name}. Quedan ${qtyLabel(stock, product.unit)}.`,
      );
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
                discount_pct: discountEligibleProductIds.has(product.id)
                  ? Number(product.discount_pct || 0)
                  : 0,
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
          discount_pct: discountEligibleProductIds.has(product.id)
            ? Number(product.discount_pct || 0)
            : 0,
          subtotal,
        },
      ];
    });

    lowStockWarning(product);
    setScanValue("");
    focusInput();
  };

  const handleManualSelect = (product: Product) => {
    if (expiredProductIds.has(product.id)) {
      toast.error(`${product.name} tiene lotes vencidos. Registra la merma antes de venderlo.`);
      return;
    }

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
      if (expiredProductIds.has(product.id)) {
        toast.error(`${product.name} tiene lotes vencidos. Registra la merma antes de venderlo.`);
        setScanValue("");
        focusInput();
        return;
      }

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
      toast.error(
        `Stock insuficiente para ${product.name}. Quedan ${qtyLabel(stock, product.unit)}.`,
      );
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
      if (lotsLoading) throw new Error("Espera a que se cargue el estado de los lotes.");
      if (cart.some((item) => expiredProductIds.has(item.product_id))) {
        throw new Error(
          "El carrito contiene productos con lotes vencidos. Retíralos o regístralos como merma.",
        );
      }
      if (discountInputInvalid) throw new Error("Revisa el descuento ingresado.");
      if (cashInputInvalid)
        throw new Error("El efectivo recibido debe cubrir el total de la venta.");

      const payload = cart.map((item) => ({
        product_id: item.product_id,
        qty: Number(item.qty),
      }));
      const received = paymentMethod === "efectivo" ? parsedCashReceived : cartTotal;

      const { data, error } = await supabase.rpc("register_sale", {
        _items: payload,
        _note: "Venta POS",
        _payment_method: paymentMethod,
        _amount_received: received,
        _discount_type: discountType,
        _discount_value: discountType === "none" ? 0 : (parsedDiscountValue ?? 0),
      });

      if (error) throw new Error(error.message);
      return {
        saleId: data ?? `INV-${Date.now()}`,
        subtotal: cartSubtotal,
        discount: discountAmount,
        total: cartTotal,
        paymentMethod,
        amountReceived: received,
        change: paymentMethod === "efectivo" ? Number((received - cartTotal).toFixed(2)) : 0,
      };
    },
    onSuccess: ({
      saleId,
      subtotal,
      discount,
      total,
      paymentMethod: method,
      amountReceived,
      change,
    }) => {
      const nextReceipt: Receipt = {
        id: saleId,
        subtotal,
        discount,
        total,
        createdAt: new Date().toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }),
        paymentMethod: method,
        amountReceived,
        change,
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
      setCashReceived("");
      setDiscountType("none");
      setDiscountValue("");
      toast.success(`Venta cobrada por ${money(total)}`);
      qc.invalidateQueries({ queryKey: qk.products });
      qc.invalidateQueries({ queryKey: qk.lots });
      qc.invalidateQueries({ queryKey: qk.movements(2) });
      qc.invalidateQueries({ queryKey: qk.inventoryStockAudit });
      qc.invalidateQueries({ queryKey: qk.salePayments(2) });
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

  const resumeSuspendedSale = (sale: SuspendedSale) => {
    if (cart.length > 0) {
      const shouldSuspend = window.confirm(
        "¿Suspender la venta actual y continuar con esta venta?",
      );
      if (!shouldSuspend) return;
      setSuspendedSales((previous) => [
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          items: cart,
          paymentMethod,
          discountType,
          discountValue,
          cashReceived,
        },
        ...previous.filter((item) => item.id !== sale.id),
      ]);
    } else {
      setSuspendedSales((previous) => previous.filter((item) => item.id !== sale.id));
    }

    setCart(sale.items);
    setPaymentMethod(sale.paymentMethod ?? "efectivo");
    setDiscountType(sale.discountType ?? "none");
    setDiscountValue(sale.discountValue ?? "");
    setCashReceived(sale.cashReceived ?? "");
    setScanValue("");
    setReceipt(null);
    toast.success("Venta retomada.");
    focusInput();
  };

  const deleteSuspendedSale = (saleId: string) => {
    setSuspendedSales((previous) => previous.filter((sale) => sale.id !== saleId));
    toast.info("Venta suspendida eliminada.");
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPendingWeightProduct(null)}
              >
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
                {weightDraft
                  ? `${Number.parseFloat(weightDraft || "0").toFixed(3)} kg × ${money(salePrice(pendingWeightProduct))}/kg`
                  : "Ingresa un peso"}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPendingWeightProduct(null)}
                >
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
            <Kpi
              label="Ventas de hoy"
              value={money(today.total)}
              icon={Banknote}
              sub={`${today.count} transacciones`}
              tone="good"
            />
            <Kpi
              label="Productos activos"
              value={products.filter((p) => p.active).length}
              icon={Package}
              sub="en catálogo"
            />
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
                  disabled={checkout.isPending}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  placeholder="Escanea o escribe código, palabra clave o nombre"
                  className="h-12 text-lg"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" size="lg" disabled={checkout.isPending}>
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
                        disabled={
                          checkout.isPending || lotsLoading || expiredProductIds.has(product.id)
                        }
                        className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span>
                          <span className="font-medium">{product.name}</span>
                          <span className="ml-2 text-muted-foreground">{product.code}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {expiredProductIds.has(product.id)
                            ? "Vencido · registrar merma"
                            : qtyLabel(Number(product.stock), product.unit)}
                        </span>
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearCart}
                        disabled={checkout.isPending}
                      >
                        <Trash2 className="size-4" /> Vaciar
                      </Button>
                    )}
                  </div>
                </div>

                {suspendedSales.length > 0 && (
                  <div className="mb-3 space-y-2 rounded-md border bg-background p-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Ventas suspendidas ({suspendedSales.length})
                    </p>
                    {suspendedSales.map((sale) => (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <div>
                          <p className="font-medium">
                            {sale.items.length} {sale.items.length === 1 ? "producto" : "productos"}{" "}
                            · {money(getSuspendedSaleTotal(sale))}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(sale.createdAt).toLocaleString("es-CL", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => resumeSuspendedSale(sale)}
                          >
                            <Play className="size-3.5" /> Retomar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Eliminar venta suspendida"
                            onClick={() => deleteSuspendedSale(sale.id)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {cart.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Todavía no hay productos agregados.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {cartHasExpiredProducts && (
                      <p
                        role="alert"
                        className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                      >
                        Hay productos con lotes vencidos. Retíralos del carrito y regístralos como
                        merma antes de vender.
                      </p>
                    )}
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setCart((prev) =>
                                  prev.filter((x) => x.product_id !== item.product_id),
                                )
                              }
                              disabled={checkout.isPending}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-8"
                                onClick={() => updateCartQty(item.product_id, item.qty - 1)}
                                disabled={checkout.isPending}
                              >
                                <Minus className="size-4" />
                              </Button>
                              <Input
                                type="number"
                                min={0}
                                step={item.unit === "kilo" ? "0.1" : "1"}
                                value={item.qty}
                                onChange={(e) =>
                                  updateCartQty(item.product_id, Number(e.target.value))
                                }
                                className="h-9 w-20 text-center"
                                disabled={checkout.isPending}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-8"
                                onClick={() => updateCartQty(item.product_id, item.qty + 1)}
                                disabled={checkout.isPending}
                              >
                                <Plus className="size-4" />
                              </Button>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">{money(item.subtotal)}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {qtyLabel(item.qty, item.unit)}
                              </p>
                            </div>
                          </div>

                          {product &&
                            !promotionByProduct.has(product.id) &&
                            discountEligibleProductIds.has(product.id) &&
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
                                <Tag className="size-3" />{" "}
                                {promotionByProduct.get(item.product_id)?.title}
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
                <div className="space-y-4 rounded-lg border bg-card p-4">
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="sale-discount-type">Descuento de la venta</Label>
                      <div className="flex gap-2">
                        <Select
                          value={discountType}
                          onValueChange={(value) => {
                            if (value === "none" || value === "percentage" || value === "fixed") {
                              setDiscountType(value);
                              setDiscountValue("");
                            }
                          }}
                        >
                          <SelectTrigger id="sale-discount-type" className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin descuento</SelectItem>
                            <SelectItem value="percentage">Porcentaje</SelectItem>
                            <SelectItem value="fixed">Monto en pesos</SelectItem>
                          </SelectContent>
                        </Select>
                        {discountType !== "none" && (
                          <Input
                            aria-label={
                              discountType === "percentage"
                                ? "Porcentaje de descuento"
                                : "Descuento en pesos"
                            }
                            type="number"
                            min="0"
                            max={discountType === "percentage" ? 100 : cartSubtotal}
                            step={discountType === "percentage" ? "1" : "1"}
                            value={discountValue}
                            onChange={(event) => setDiscountValue(event.target.value)}
                            className="flex-1"
                          />
                        )}
                      </div>
                      {discountInputInvalid && (
                        <p className="text-xs text-destructive">
                          Ingresa un descuento válido que no supere el subtotal.
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="payment-method">Método de pago</Label>
                      <Select
                        value={paymentMethod}
                        onValueChange={(value) => {
                          if (
                            value === "efectivo" ||
                            value === "tarjeta" ||
                            value === "transferencia"
                          ) {
                            setPaymentMethod(value);
                            setCashReceived("");
                          }
                        }}
                      >
                        <SelectTrigger id="payment-method">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="efectivo">
                            <span className="flex items-center gap-2">
                              <Banknote className="size-4" /> Efectivo
                            </span>
                          </SelectItem>
                          <SelectItem value="tarjeta">
                            <span className="flex items-center gap-2">
                              <CreditCard className="size-4" /> Tarjeta
                            </span>
                          </SelectItem>
                          <SelectItem value="transferencia">
                            <span className="flex items-center gap-2">
                              <ArrowLeftRight className="size-4" /> Transferencia
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {paymentMethod === "efectivo" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="cash-received">Efectivo recibido</Label>
                        <Input
                          id="cash-received"
                          type="number"
                          min={cartTotal}
                          step="1"
                          value={cashReceived}
                          onChange={(event) => setCashReceived(event.target.value)}
                          placeholder={String(cartTotal)}
                          aria-invalid={cashInputInvalid}
                        />
                        {cashInputInvalid ? (
                          <p className="text-xs text-destructive">
                            El monto recibido debe cubrir el total.
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Vuelto: {money(changeDue)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Subtotal</span>
                      <span>{money(cartSubtotal)}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Descuento</span>
                        <span>-{money(discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span>Total</span>
                      <span className="text-xl font-bold">{money(cartTotal)}</span>
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => checkout.mutate()}
                      disabled={
                        checkout.isPending ||
                        lotsLoading ||
                        cart.length === 0 ||
                        cartHasExpiredProducts ||
                        discountInputInvalid ||
                        cashInputInvalid
                      }
                    >
                      {checkout.isPending ? "Cobrando…" : "Cobrar y emitir comprobante"}
                    </Button>
                  </div>
                </div>
              )}

              {receipt && (
                <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Último comprobante</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => window.print()}
                    >
                      <Printer className="size-4" /> Imprimir
                    </Button>
                  </div>
                  <div className="receipt-print rounded-lg border bg-white p-4 text-black shadow-none">
                    <div className="text-center leading-tight">
                      <p className="text-[18px] font-black uppercase">{storeName}</p>
                      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-600">
                        Boleta de venta
                      </p>
                      {storeAddress && (
                        <p className="mt-1 text-[8px] text-slate-500">{storeAddress}</p>
                      )}
                    </div>

                    <div className="my-3 border-t border-b border-slate-200 py-2 text-[9px] leading-4 text-slate-700">
                      <p className="flex items-center justify-between">
                        <span>N°</span>
                        <span>{receipt.id}</span>
                      </p>
                      <p className="flex items-center justify-between">
                        <span>Fecha</span>
                        <span>{receipt.createdAt}</span>
                      </p>
                    </div>

                    <div className="space-y-2 text-[10px]">
                      {receipt.items.map((item) => (
                        <div
                          key={`${receipt.id}-${item.productName}`}
                          className="border-b border-slate-100 pb-2"
                        >
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
                      {receipt.discount > 0 && (
                        <div className="flex items-center justify-between pb-1 text-slate-600">
                          <span>Subtotal</span>
                          <span>{money(receipt.subtotal)}</span>
                        </div>
                      )}
                      {receipt.discount > 0 && (
                        <div className="flex items-center justify-between pb-1 text-slate-600">
                          <span>Descuento</span>
                          <span>-{money(receipt.discount)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span>Total</span>
                        <span>{money(receipt.total)}</span>
                      </div>
                      <div className="mt-1 space-y-0.5 border-t border-slate-200 pt-1 text-[9px] font-normal text-slate-700">
                        <p className="flex justify-between">
                          <span>Pago</span>
                          <span>
                            {receipt.paymentMethod === "efectivo"
                              ? "Efectivo"
                              : receipt.paymentMethod === "tarjeta"
                                ? "Tarjeta"
                                : "Transferencia"}
                          </span>
                        </p>
                        {receipt.paymentMethod === "efectivo" && (
                          <>
                            <p className="flex justify-between">
                              <span>Recibido</span>
                              <span>{money(receipt.amountReceived)}</span>
                            </p>
                            <p className="flex justify-between">
                              <span>Vuelto</span>
                              <span>{money(receipt.change)}</span>
                            </p>
                          </>
                        )}
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
              <CardTitle>Ventas recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {recentSales.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no hay ventas.</p>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {recentSales.map((sale) => (
                    <AccordionItem key={sale.key} value={sale.key}>
                      <AccordionTrigger className="gap-3 py-3 hover:no-underline">
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              Venta #{sale.id.slice(0, 8).toUpperCase()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(sale.createdAt).toLocaleString("es-CL", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}{" "}
                              · {sale.items.length}{" "}
                              {sale.items.length === 1 ? "producto" : "productos"}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold">
                            {money(sale.total)}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 border-t pt-3">
                          {sale.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start justify-between gap-3 text-sm"
                            >
                              <div>
                                <p className="font-medium">{item.product_name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {qtyLabel(Number(item.qty), item.unit)}
                                  {item.discount_pct > 0 && ` · -${item.discount_pct}%`}
                                </p>
                              </div>
                              <span className="shrink-0">{money(Number(item.amount))}</span>
                            </div>
                          ))}
                          <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                            <span>Total de la venta</span>
                            <span>{money(sale.total)}</span>
                          </div>
                          {sale.payment && (
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p className="flex justify-between">
                                <span>Pago: {sale.payment.payment_method}</span>
                                {sale.payment.discount_amount > 0 && (
                                  <span>
                                    Descuento: {money(Number(sale.payment.discount_amount))}
                                  </span>
                                )}
                              </p>
                              {sale.payment.payment_method === "efectivo" && (
                                <p className="flex justify-between">
                                  <span>
                                    Recibido: {money(Number(sale.payment.amount_received))}
                                  </span>
                                  <span>Vuelto: {money(Number(sale.payment.change_amount))}</span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Tag className="size-4" /> Promociones
                </CardTitle>
                {canManagePromotions && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setPromotionFormOpen((open) => !open)}
                  >
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

              {promotionFormOpen && canManagePromotions && (
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
                        <SelectItem
                          value="bundle"
                          disabled={selectedPromotionProduct?.unit !== "unidad"}
                        >
                          Oferta por cantidad (ej. 3 por $100)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {promotionType === "price" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="promotion-price">
                        Precio promocional
                        {selectedPromotionProduct?.unit === "kilo" ? " por kilo" : ""}
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
                <p className="text-sm text-muted-foreground">
                  No hay promociones activas en esta categoría.
                </p>
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
                            <p className="mt-1 text-xs text-muted-foreground">
                              {promotion.description}
                            </p>
                          )}
                        </div>
                        {canManagePromotions && (
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
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleManualSelect(product)}
                          disabled={checkout.isPending}
                        >
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
