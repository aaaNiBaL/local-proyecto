import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      { title: "Almacén — Inventario y ventas por código de barras" },
      {
        name: "description",
        content:
          "Registra entradas por código de barras, vende con palabras clave por kilo y revisa inventario, ventas y ganancias por día, semana o mes.",
      },
      { property: "og:title", content: "Almacén — Inventario y ventas" },
      {
        property: "og:description",
        content:
          "Control de inventario simple: entradas por código de barras, ventas por palabra clave y reportes de ganancias.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const store = useStore();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Mi Almacén</h1>
            <p className="text-sm text-muted-foreground">
              Inventario, ventas y ganancias en un solo lugar
            </p>
          </div>
          <Badge variant="secondary">{store.data.products.length} productos</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Tabs defaultValue="vender">
          <TabsList className="mb-6 w-full justify-start overflow-x-auto">
            <TabsTrigger value="vender">Vender</TabsTrigger>
            <TabsTrigger value="entradas">Entradas</TabsTrigger>
            <TabsTrigger value="inventario">Inventario</TabsTrigger>
            <TabsTrigger value="reportes">Reportes</TabsTrigger>
          </TabsList>

          <TabsContent value="vender">
            <SellTab store={store} />
          </TabsContent>
          <TabsContent value="entradas">
            <EntryTab store={store} />
          </TabsContent>
          <TabsContent value="inventario">
            <InventoryTab store={store} />
          </TabsContent>
          <TabsContent value="reportes">
            <ReportsTab store={store} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

type Store = ReturnType<typeof useStore>;

/* ---------------------------- Vender ---------------------------- */

function SellTab({ store }: { store: Store }) {
  const [value, setValue] = useState("");
  const today = useMemo(() => {
    const from = rangeStart("day");
    const sales = store.data.movements.filter((m) => m.type === "out" && m.ts >= from);
    return {
      count: sales.length,
      total: sales.reduce((s, m) => s + m.amount, 0),
    };
  }, [store.data.movements]);

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

  const recent = store.data.movements.filter((m) => m.type === "out").slice(0, 10);

  return (
    <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Pasar producto</CardTitle>
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
              className="text-lg"
            />
            <Button type="submit">Vender</Button>
          </form>
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">Cómo se usa</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Escanea el código de barras: descuenta 1 unidad.</li>
              <li>
                Varias unidades: <code>780123456789 x3</code>
              </li>
              <li>
                Por peso (pan, frutas): palabra clave + monto cobrado, ej. <code>p 1500</code>. Con el
                precio por kilo se calculan los kilos vendidos.
              </li>
              <li>
                Si dos productos parten con la misma letra, usa 2 letras: <code>pa 4</code>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Hoy</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{money(today.total)}</p>
            <p className="text-sm text-muted-foreground">{today.count} ventas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Últimas ventas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.length === 0 && (
              <p className="text-sm text-muted-foreground">Aún no hay ventas.</p>
            )}
            {recent.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span>{m.productName}</span>
                <span className="text-muted-foreground">
                  {qtyLabel(m.qty, m.unit)} · {money(m.amount)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
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

  return (
    <div className="grid gap-6 md:grid-cols-2">
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
          <Button onClick={submit} className="w-full">
            {found ? "Agregar al inventario" : "Crear producto"}
          </Button>
        </CardContent>
      </Card>

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
  prefill?: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("unidad");
  const [barcode, setBarcode] = useState("");
  const [keyword, setKeyword] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");

  const isNumericCode = prefill ? /^\d{4,}$/.test(prefill) : false;
  const codeValue = prefill ? (isNumericCode ? prefill : prefill) : "";
  const effBarcode = prefill ? (isNumericCode ? codeValue : barcode) : barcode;
  const effKeyword = prefill ? (isNumericCode ? keyword : codeValue) : keyword;

  const submit = () => {
    const p = Number(price.replace(",", "."));
    const s = Number((stock || "0").replace(",", "."));
    if (!name.trim()) return toast.error("Escribe el nombre del producto.");
    if (!Number.isFinite(p) || p <= 0)
      return toast.error(unit === "kilo" ? "Ingresa el precio por kilo." : "Ingresa el precio.");
    if (!effBarcode.trim() && !effKeyword.trim())
      return toast.error("Necesita un código de barras o una palabra clave.");
    if (
      store.data.products.some(
        (x) =>
          (effBarcode && x.barcode === effBarcode.trim()) ||
          (effKeyword && x.keyword?.toLowerCase() === effKeyword.trim().toLowerCase()),
      )
    )
      return toast.error("Ya existe un producto con ese código o palabra clave.");

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
          <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pan batido" />
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
            <Input id="pprice" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pstock">Stock inicial</Label>
            <Input id="pstock" inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} />
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

function InventoryTab({ store }: { store: Store }) {
  const products = store.data.products;
  const soldByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of store.data.movements) {
      if (m.type === "out") map.set(m.productId, (map.get(m.productId) ?? 0) + m.qty);
    }
    return map;
  }, [store.data.movements]);

  const value = products.reduce((s, p) => s + p.stock * p.price, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventario · valor {money(value)}</CardTitle>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay productos. Agrégalos en la pestaña Entradas.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Código / clave</TableHead>
                <TableHead>Precio</TableHead>
                <TableHead>Vendido</TableHead>
                <TableHead>Quedan</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p: Product) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.barcode ?? "—"} {p.keyword ? `· ${p.keyword}` : ""}
                  </TableCell>
                  <TableCell>
                    {money(p.price)}
                    {p.unit === "kilo" ? " /kg" : ""}
                  </TableCell>
                  <TableCell>{qtyLabel(soldByProduct.get(p.id) ?? 0, p.unit)}</TableCell>
                  <TableCell>
                    <Badge variant={p.stock <= 0 ? "destructive" : "secondary"}>
                      {qtyLabel(p.stock, p.unit)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => store.removeProduct(p.id)}>
                      Eliminar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
    const map = new Map<string, { name: string; qty: number; amount: number; unit: Product["unit"] }>();
    for (const m of sales) {
      const cur = map.get(m.productId) ?? { name: m.productName, qty: 0, amount: 0, unit: m.unit };
      cur.qty += m.qty;
      cur.amount += m.amount;
      map.set(m.productId, cur);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [sales]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Label className="text-sm">Periodo</Label>
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="w-48">
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
        <CardContent>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas en este periodo.</p>
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
                {ranking.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{qtyLabel(r.qty, r.unit)}</TableCell>
                    <TableCell className="text-right">{money(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {movs.length === 0 && <p className="text-sm text-muted-foreground">Sin movimientos.</p>}
          {movs.slice(0, 30).map((m) => (
            <div key={m.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
              <span>
                <Badge variant={m.type === "in" ? "secondary" : "default"} className="mr-2">
                  {m.type === "in" ? "Entrada" : "Venta"}
                </Badge>
                {m.productName}
              </span>
              <span className="text-muted-foreground">
                {qtyLabel(m.qty, m.unit)} · {money(m.amount)} ·{" "}
                {new Date(m.ts).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
