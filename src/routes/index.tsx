import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpDown,
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Search,
  ScanLine,
  Store as StoreIcon,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  findByCode,
  money,
  parseSale,
  qtyLabel,
  rangeStart,
  useStore,
  type Product,
  type Range,
  type Unit,
} from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mi Almacén — Inventario, ventas y reportes" },
      {
        name: "description",
        content:
          "Panel de almacén: entradas por código de barras, ventas por palabra clave y peso, inventario en vivo y reportes por día, semana o mes.",
      },
      { property: "og:title", content: "Mi Almacén — Panel de inventario" },
      {
        property: "og:description",
        content:
          "Controla stock, ventas y ganancias con códigos de barras y palabras clave por kilo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Store = ReturnType<typeof useStore>;
type Section = "vender" | "entradas" | "inventario" | "reportes";

const NAV: { id: Section; label: string; icon: typeof Boxes }[] = [
  { id: "vender", label: "Vender", icon: ScanLine },
  { id: "entradas", label: "Entradas", icon: ArrowDownToLine },
  { id: "inventario", label: "Inventario", icon: Boxes },
  { id: "reportes", label: "Reportes", icon: BarChart3 },
];

function Index() {
  const store = useStore();
  const [section, setSection] = useState<Section>("inventario");
  const [query, setQuery] = useState("");

  const today = useMemo(() => {
    const from = rangeStart("day");
    const sales = store.data.movements.filter((m) => m.type === "out" && m.ts >= from);
    return { count: sales.length, total: sales.reduce((s, m) => s + m.amount, 0) };
  }, [store.data.movements]);

  return (
    <div className="flex min-h-screen bg-muted/40">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <StoreIcon className="size-5" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold">Mi Almacén</p>
            <p className="text-xs text-muted-foreground">Panel de control</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                section === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t px-5 py-4 text-xs text-muted-foreground">
          Datos guardados en este dispositivo
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="border-b bg-card">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <h1 className="text-xl font-bold tracking-tight">
              {NAV.find((n) => n.id === section)?.label}
            </h1>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar producto o código"
                className="pl-9"
              />
            </div>
            <div className="rounded-lg border px-3 py-1.5 text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Hoy</p>
              <p className="text-sm font-semibold">
                {money(today.total)} · {today.count} ventas
              </p>
            </div>
          </div>
          {/* Mobile nav */}
          <div className="flex gap-1 overflow-x-auto border-t px-2 py-2 md:hidden">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm",
                  section === item.id ? "bg-primary/10 text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          {section === "vender" && <SellTab store={store} />}
          {section === "entradas" && <EntryTab store={store} />}
          {section === "inventario" && <InventoryTab store={store} query={query} />}
          {section === "reportes" && <ReportsTab store={store} />}
        </main>
      </div>
    </div>
  );
}

/* ---------------------------- Vender ---------------------------- */

function SellTab({ store }: { store: Store }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const res = parseSale(value, store.data.products);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    store.addSale(res.product.id, res.qty, res.amount);
    toast.success(
      `Vendido: ${res.product.name} — ${qtyLabel(res.qty, res.product.unit)} por ${money(res.amount)}`,
    );
    setValue("");
  };

  const recent = store.data.movements.filter((m) => m.type === "out").slice(0, 12);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="size-4" /> Pasar producto
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex gap-2"
          >
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Código de barras, o palabra clave + precio (ej: p 1500)"
              className="h-12 text-lg"
            />
            <Button type="submit" size="lg">
              Vender
            </Button>
          </form>
          <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">Cómo se usa</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Escanea el código de barras: descuenta 1 unidad.</li>
              <li>
                Varias unidades: <code>780123456789 x3</code>
              </li>
              <li>
                Por peso (pan, frutas): palabra clave + monto cobrado, ej. <code>p 1500</code>. Con
                el precio por kilo se calculan los kilos vendidos.
              </li>
              <li>
                Si dos productos parten con la misma letra, usa 2 letras: <code>pa 4</code>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimas ventas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
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
                {recent.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.productName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {qtyLabel(m.qty, m.unit)}
                    </TableCell>
                    <TableCell className="text-right">{money(m.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------- Entradas ---------------------------- */

function EntryTab({ store }: { store: Store }) {
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const found = code.trim() ? findByCode(store.data.products, code) : undefined;

  const [newProduct, setNewProduct] = useState<null | { code: string }>(null);

  const submit = () => {
    const n = Number(qty.replace(",", "."));
    if (!found) {
      setNewProduct({ code: code.trim() });
      return;
    }
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Ingresa una cantidad válida.");
      return;
    }
    store.addEntry(found.id, n);
    toast.success(`Entrada: ${found.name} +${qtyLabel(n, found.unit)}`);
    setCode("");
    setQty("");
  };

  const loadDemo = () => {
    const count = store.seedDemo();
    if (count === 0) {
      toast.info("Los productos de prueba ya están cargados.");
    } else {
      toast.success(`Se cargaron ${count} productos de prueba con stock y ventas de ejemplo.`);
    }
  };

  const lastEntries = store.data.movements.filter((m) => m.type === "in").slice(0, 8);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Ingresar mercadería</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Código de barras o palabra clave</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Escanea o escribe el código"
              />
              {code.trim() && (
                <p className="text-sm text-muted-foreground">
                  {found
                    ? `${found.name} · stock actual ${qtyLabel(found.stock, found.unit)}`
                    : "Producto nuevo: se pedirán los datos al continuar."}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty">
                Cantidad que llegó {found?.unit === "kilo" ? "(kilos)" : "(unidades)"}
              </Label>
              <Input
                id="qty"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={submit} className="flex-1">
                {found ? "Agregar al inventario" : "Crear producto"}
              </Button>
              <Button variant="outline" onClick={loadDemo}>
                Productos de prueba
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Últimas entradas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lastEntries.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin entradas registradas.</p>
            )}
            {lastEntries.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span className="font-medium">{m.productName}</span>
                <span className="text-muted-foreground">
                  +{qtyLabel(m.qty, m.unit)} ·{" "}
                  {new Date(m.ts).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <ProductForm
        store={store}
        prefill={newProduct?.code}
        onDone={() => {
          setNewProduct(null);
          setCode("");
          setQty("");
        }}
      />
    </div>
  );
}

function ProductForm({
  store,
  prefill,
  onDone,
}: {
  store: Store;
  prefill?: string | undefined;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("unidad");
  const [barcode, setBarcode] = useState("");
  const [keyword, setKeyword] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");

  const isNumericCode = prefill ? /^\d{4,}$/.test(prefill) : false;
  const codeValue = prefill ?? "";
  const effBarcode = prefill ? (isNumericCode ? codeValue : barcode) : barcode;
  const effKeyword = prefill ? (isNumericCode ? keyword : codeValue) : keyword;

  const submit = () => {
    const p = Number(price.replace(",", "."));
    const s = Number((stock || "0").replace(",", "."));
    if (!name.trim()) {
      toast.error("Escribe el nombre del producto.");
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      toast.error(unit === "kilo" ? "Ingresa el precio por kilo." : "Ingresa el precio.");
      return;
    }
    if (!effBarcode.trim() && !effKeyword.trim()) {
      toast.error("Necesita un código de barras o una palabra clave.");
      return;
    }
    if (
      store.data.products.some(
        (x) =>
          (effBarcode && x.barcode === effBarcode.trim()) ||
          (effKeyword && x.keyword?.toLowerCase() === effKeyword.trim().toLowerCase()),
      )
    ) {
      toast.error("Ya existe un producto con ese código o palabra clave.");
      return;
    }

    store.upsertProduct({
      name: name.trim(),
      unit,
      price: p,
      stock: Number.isFinite(s) && s > 0 ? s : 0,
      ...(effBarcode.trim() ? { barcode: effBarcode.trim() } : {}),
      ...(effKeyword.trim() ? { keyword: effKeyword.trim().toLowerCase() } : {}),
    });
    toast.success(`Producto "${name.trim()}" creado.`);
    setName("");
    setBarcode("");
    setKeyword("");
    setPrice("");
    setStock("");
    onDone();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo producto</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pname">Nombre</Label>
          <Input
            id="pname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pan batido"
          />
        </div>
        <div className="space-y-2">
          <Label>Se vende por</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unidad">Unidad</SelectItem>
              <SelectItem value="kilo">Kilo (peso)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pbar">Código de barras</Label>
            <Input
              id="pbar"
              value={effBarcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pkey">Palabra clave</Label>
            <Input
              id="pkey"
              value={effKeyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="p, pa, m..."
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pprice">{unit === "kilo" ? "Precio por kilo" : "Precio unitario"}</Label>
            <Input
              id="pprice"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pstock">Stock inicial</Label>
            <Input
              id="pstock"
              inputMode="decimal"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </div>
        </div>
        <Button onClick={submit} className="w-full">
          Guardar producto
        </Button>
      </CardContent>
    </Card>
  );
}

/* ---------------------------- Inventario ---------------------------- */

type SortKey = "name" | "price" | "sold" | "stock";
const PAGE_SIZE = 8;

function InventoryTab({ store, query }: { store: Store; query: string }) {
  const [unitFilter, setUnitFilter] = useState<"all" | Unit>("all");
  const [availability, setAvailability] = useState<"all" | "in" | "out">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const [page, setPage] = useState(1);

  const soldByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of store.data.movements) {
      if (m.type === "out") map.set(m.productId, (map.get(m.productId) ?? 0) + m.qty);
    }
    return map;
  }, [store.data.movements]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = store.data.products.filter((p) => {
      if (unitFilter !== "all" && p.unit !== unitFilter) return false;
      if (availability === "in" && p.stock <= 0) return false;
      if (availability === "out" && p.stock > 0) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q) ||
        (p.keyword ?? "").toLowerCase().includes(q)
      );
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
      if (sort.key === "price") return (a.price - b.price) * dir;
      if (sort.key === "stock") return (a.stock - b.stock) * dir;
      return ((soldByProduct.get(a.id) ?? 0) - (soldByProduct.get(b.id) ?? 0)) * dir;
    });
  }, [store.data.products, query, unitFilter, availability, sort, soldByProduct]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const stockValue = store.data.products.reduce((s, p) => s + p.stock * p.price, 0);
  const soldTotal = store.data.movements
    .filter((m) => m.type === "out")
    .reduce((s, m) => s + m.amount, 0);
  const lowStock = store.data.products.filter((p) => p.stock <= 0).length;

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  const Th = ({ label, k, right }: { label: string; k: SortKey; right?: boolean }) => (
    <TableHead className={right ? "text-right" : undefined}>
      <button
        onClick={() => toggleSort(k)}
        className={cn(
          "inline-flex items-center gap-1 font-medium hover:text-foreground",
          sort.key === k ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <ArrowUpDown className="size-3" />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Valor del inventario" value={money(stockValue)} />
        <Stat label="Vendido (histórico)" value={money(soldTotal)} />
        <Stat label="Sin stock" value={`${lowStock} productos`} />
      </div>

      <Card>
        <CardHeader className="gap-3 border-b">
          <CardTitle>Stock</CardTitle>
          <p className="text-sm text-muted-foreground">
            Revisa existencias, lo vendido y cuánto queda de cada producto.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Select
              value={unitFilter}
              onValueChange={(v) => {
                setUnitFilter(v as "all" | Unit);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tipo: todos</SelectItem>
                <SelectItem value="unidad">Tipo: por unidad</SelectItem>
                <SelectItem value="kilo">Tipo: por kilo</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={availability}
              onValueChange={(v) => {
                setAvailability(v as "all" | "in" | "out");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[210px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Disponibilidad: todos</SelectItem>
                <SelectItem value="in">Disponibilidad: con stock</SelectItem>
                <SelectItem value="out">Disponibilidad: sin stock</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="ml-auto">
              {rows.length} de {store.data.products.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {store.data.products.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Todavía no hay productos. Agrégalos en Entradas.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Código / clave</TableHead>
                      <Th label="Producto" k="name" />
                      <TableHead>Tipo</TableHead>
                      <Th label="Precio" k="price" />
                      <Th label="Vendido" k="sold" />
                      <Th label="Quedan" k="stock" />
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((p: Product) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.barcode || (p.keyword ? p.keyword.toUpperCase() : "—")}
                        </TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {p.unit === "kilo" ? "Por kilo" : "Por unidad"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {money(p.price)}
                          {p.unit === "kilo" ? " /kg" : ""}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {qtyLabel(soldByProduct.get(p.id) ?? 0, p.unit)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.stock <= 0 ? "destructive" : "secondary"}>
                            {qtyLabel(p.stock, p.unit)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{money(p.stock * p.price)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Eliminar ${p.name}`}
                            onClick={() => store.removeProduct(p.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {pageRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          Sin resultados con estos filtros.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center gap-2 border-t px-4 py-3 text-sm">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-muted-foreground">
                  Página {current} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={current >= totalPages}
                  onClick={() => setPage(current + 1)}
                  aria-label="Página siguiente"
                >
                  <ChevronRight className="size-4" />
                </Button>
                <span className="ml-auto text-muted-foreground">Total — {rows.length}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------- Reportes ---------------------------- */

function ReportsTab({ store }: { store: Store }) {
  const [range, setRange] = useState<Range>("day");
  const from = rangeStart(range);
  const movs = store.data.movements.filter((m) => m.ts >= from);
  const sales = movs.filter((m) => m.type === "out");
  const entries = movs.filter((m) => m.type === "in");

  const ranking = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; amount: number; unit: Unit }>();
    for (const m of sales) {
      const cur = map.get(m.productId) ?? { name: m.productName, qty: 0, amount: 0, unit: m.unit };
      cur.qty += m.qty;
      cur.amount += m.amount;
      map.set(m.productId, cur);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [sales]);

  const top = ranking[0]?.amount ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm">Periodo</Label>
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Hoy</SelectItem>
            <SelectItem value="week">Últimos 7 días</SelectItem>
            <SelectItem value="month">Últimos 30 días</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Ganado (ventas)" value={money(sales.reduce((s, m) => s + m.amount, 0))} />
        <Stat label="Salieron" value={`${sales.length} ventas`} />
        <Stat label="Entraron" value={`${entries.length} entradas`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lo que más se vende</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas en este periodo.</p>
          ) : (
            ranking.map((r) => (
              <div key={r.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground">
                    {qtyLabel(r.qty, r.unit)} · {money(r.amount)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${top > 0 ? (r.amount / top) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {movs.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Sin movimientos.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movs.slice(0, 30).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Badge variant={m.type === "in" ? "outline" : "default"}>
                          {m.type === "in" ? "Entrada" : "Venta"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{m.productName}</TableCell>
                      <TableCell>{qtyLabel(m.qty, m.unit)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(m.ts).toLocaleString("es-CL", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-right">{money(m.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
