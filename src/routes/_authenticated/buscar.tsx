import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { categoriesQuery, lotsQuery, productsQuery } from "@/lib/queries";
import { effectivePrice, expiryStatus, money, NATURES, natureLabel, qtyLabel } from "@/lib/inventory";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/buscar")({
  head: () => ({ meta: [{ title: "Buscar — Invenco" }] }),
  component: SearchPage,
});

function SearchPage() {
  const { data: products = [] } = useQuery(productsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: lots = [] } = useQuery(lotsQuery);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [nature, setNature] = useState("all");

  const results = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => {
        if (cat !== "all" && p.category_id !== cat) return false;
        if (nature !== "all" && p.nature !== nature) return false;
        if (!terms.length) return true;
        const hay = `${p.name} ${p.code ?? ""} ${p.keyword ?? ""} ${categories.find((c) => c.id === p.category_id)?.name ?? ""}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .map((p) => {
        const pl = lots.filter((l) => l.product_id === p.id && l.expires_at);
        const next = pl.sort((a, b) => (a.expires_at! < b.expires_at! ? -1 : 1))[0];
        return { p, nextExp: next?.expires_at ?? null, st: expiryStatus(next?.expires_at) };
      });
  }, [products, categories, lots, q, cat, nature]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, código, clave o departamento"
              className="h-11 pl-9"
            />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los departamentos</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={nature} onValueChange={setNature}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda naturaleza</SelectItem>
              {NATURES.map((n) => (
                <SelectItem key={n.value} value={n.value}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">{results.length} resultados</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Código / clave</TableHead>
                <TableHead>Departamento</TableHead>
                <TableHead>Naturaleza</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Próximo vencimiento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Ningún artículo coincide con la búsqueda.
                  </TableCell>
                </TableRow>
              )}
              {results.map(({ p, nextExp, st }) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.code || "—"}
                    {p.keyword && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans">{p.keyword}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{categories.find((c) => c.id === p.category_id)?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{natureLabel(p.nature)}</TableCell>
                  <TableCell className="text-right">
                    {money(effectivePrice(p))}
                    {p.discount_pct > 0 && <span className="ml-1 text-xs text-accent-foreground/80">-{p.discount_pct}%</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={Number(p.stock) <= Number(p.min_stock) ? "secondary" : "outline"}>
                      {qtyLabel(Number(p.stock), p.unit)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {nextExp ? (
                      <span className={st === "vencido" || st === "critico" ? "text-destructive" : st === "proximo" ? "text-accent-foreground" : ""}>
                        {new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(nextExp + "T00:00:00"))}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
