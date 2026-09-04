import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Invenco — POS e inventario en tiempo real" },
      {
        name: "description",
        content:
          "Invenco: punto de venta, inventario perpetuo, control de vencimientos y reportes para minimarkets de alta rotación.",
      },
      { property: "og:title", content: "Invenco — POS e inventario en tiempo real" },
      { property: "og:description", content: "Vende por código de barras o palabra clave, controla stock, lotes y mermas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      navigate({ to: data.session ? "/vender" : "/auth", replace: true });
    });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Store className="size-5" />
        </div>
        <p className="text-sm">Cargando Invenco…</p>
      </div>
    </div>
  );
}
