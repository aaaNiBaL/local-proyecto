import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { categoriesQuery, qk } from "@/lib/queries";
import { NATURES, num, type Nature, type Product, type Unit } from "@/lib/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  product?: Product | null;
  /** Código escaneado para prellenar al crear */
  initialCode?: string;
  onSaved?: (p: Product) => void;
};

type FormState = {
  code: string;
  keyword: string;
  name: string;
  nature: Nature;
  category_id: string;
  unit: Unit;
  price: string;
  cost: string;
  stock: string;
  min_stock: string;
};

const blank = (code = ""): FormState => ({
  code: /^\d{6,}$/.test(code) ? code : "",
  keyword: /^\d{6,}$/.test(code) ? "" : code,
  name: "",
  nature: "consumible",
  category_id: "",
  unit: "unidad",
  price: "",
  cost: "",
  stock: "0",
  min_stock: "0",
});

export function ProductForm({ open, onOpenChange, product, initialCode, onSaved }: Props) {
  const qc = useQueryClient();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [f, setF] = useState<FormState>(blank());

  useEffect(() => {
    if (!open) return;
    if (product) {
      setF({
        code: product.code ?? "",
        keyword: product.keyword ?? "",
        name: product.name,
        nature: product.nature,
        category_id: product.category_id ?? "",
        unit: product.unit,
        price: String(product.price),
        cost: String(product.cost),
        stock: String(product.stock),
        min_stock: String(product.min_stock),
      });
    } else setF(blank(initialCode));
  }, [open, product, initialCode]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("El nombre es obligatorio.");
      if (!f.code.trim() && !f.keyword.trim()) throw new Error("Ingresa un código o una palabra clave.");
      const price = num(f.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error("Precio inválido.");
      const payload = {
        code: f.code.trim() || null,
        keyword: f.keyword.trim().toLowerCase() || null,
        name: f.name.trim(),
        nature: f.nature,
        category_id: f.category_id || null,
        unit: f.unit,
        price,
        cost: Number.isFinite(num(f.cost)) ? num(f.cost) : 0,
        min_stock: Number.isFinite(num(f.min_stock)) ? num(f.min_stock) : 0,
      };
      if (product) {
        const { data, error } = await supabase.from("products").update(payload).eq("id", product.id).select().single();
        if (error) throw new Error(error.message);
        return data;
      }
      const initialStock = Number.isFinite(num(f.stock)) ? Math.max(0, num(f.stock)) : 0;
      const { data, error } = await supabase.from("products").insert(payload).select().single();
      if (error) throw new Error(friendly(error.message));
      if (initialStock > 0) {
        const { error: e2 } = await supabase.rpc("register_entry", {
          _product_id: data.id,
          _qty: initialStock,
          _note: "Stock inicial",
        });
        if (e2) throw new Error(e2.message);
      }
      return data;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: qk.products });
      qc.invalidateQueries({ queryKey: qk.lots });
      qc.invalidateQueries({ queryKey: ["movements"] });
      toast.success(product ? "Producto actualizado" : `Producto creado: ${p.name}`);
      onOpenChange(false);
      onSaved?.(p);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? "Editar producto" : "Nuevo producto"}</DialogTitle>
          <DialogDescription>
            Usa código de barras para productos envasados o una palabra clave corta para granel (pan, frutas).
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="grid gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Código (barras o interno)</Label>
              <Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="7801234567890" />
            </div>
            <div className="space-y-1.5">
              <Label>Palabra clave</Label>
              <Input value={f.keyword} onChange={(e) => set("keyword", e.target.value)} placeholder="p, pa, m…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Nombre descriptivo</Label>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Pan batido" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Naturaleza</Label>
              <Select value={f.nature} onValueChange={(v) => set("nature", v as Nature)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NATURES.map((n) => (
                    <SelectItem key={n.value} value={n.value}>
                      {n.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={f.category_id || "none"} onValueChange={(v) => set("category_id", v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin categoría</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Se vende por</Label>
              <Select value={f.unit} onValueChange={(v) => set("unit", v as Unit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unidad">Unidad</SelectItem>
                  <SelectItem value="kilo">Kilo (peso)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Precio venta {f.unit === "kilo" ? "por kilo" : "unitario"}</Label>
              <Input inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Costo reposición</Label>
              <Input inputMode="decimal" value={f.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {!product && (
              <div className="space-y-1.5">
                <Label>Stock inicial ({f.unit === "kilo" ? "kg" : "un"})</Label>
                <Input inputMode="decimal" value={f.stock} onChange={(e) => set("stock", e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Stock mínimo (alerta)</Label>
              <Input inputMode="decimal" value={f.min_stock} onChange={(e) => set("min_stock", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function friendly(msg: string) {
  if (/products_code_uq/.test(msg)) return "Ya existe un producto con ese código.";
  if (/products_keyword_uq/.test(msg)) return "Ya existe un producto con esa palabra clave. Usa 2 letras (ej: pa).";
  return msg;
}
