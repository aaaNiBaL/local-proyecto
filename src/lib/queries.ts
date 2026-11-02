import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Category, Lot, Movement, Product, Profile, Promotion, Settings } from "./inventory";

export const qk = {
  products: ["products"] as const,
  promotions: ["promotions"] as const,
  categories: ["categories"] as const,
  lots: ["lots"] as const,
  movements: (days: number) => ["movements", days] as const,
  settings: ["settings"] as const,
  profiles: ["profiles"] as const,
};

const unwrap = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export const productsQuery = queryOptions({
  queryKey: qk.products,
  queryFn: async (): Promise<Product[]> =>
    unwrap(await supabase.from("products").select("*").order("name")),
});

export const promotionsQuery = queryOptions({
  queryKey: qk.promotions,
  queryFn: async (): Promise<Promotion[]> =>
    unwrap(await supabase.from("promotions").select("*").eq("active", true).order("created_at")),
});

export const categoriesQuery = queryOptions({
  queryKey: qk.categories,
  queryFn: async (): Promise<Category[]> =>
    unwrap(await supabase.from("categories").select("*").order("sort")),
});

export const lotsQuery = queryOptions({
  queryKey: qk.lots,
  queryFn: async (): Promise<Lot[]> =>
    unwrap(await supabase.from("lots").select("*").gt("qty", 0).order("expires_at", { nullsFirst: false })),
});

export const movementsQuery = (days = 60) =>
  queryOptions({
    queryKey: qk.movements(days),
    queryFn: async (): Promise<Movement[]> => {
      const from = new Date();
      from.setDate(from.getDate() - days);
      from.setHours(0, 0, 0, 0);
      return unwrap(
        await supabase
          .from("movements")
          .select("*")
          .gte("ts", from.toISOString())
          .order("ts", { ascending: false })
          .limit(2000),
      );
    },
  });

export const settingsQuery = queryOptions({
  queryKey: qk.settings,
  queryFn: async (): Promise<Settings> =>
    unwrap(await supabase.from("settings").select("*").eq("id", 1).single()),
});

export const profilesQuery = queryOptions({
  queryKey: qk.profiles,
  queryFn: async (): Promise<(Profile & { role: "admin" | "cajero" | null })[]> => {
    const [profiles, roles] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const ps = unwrap(profiles);
    const rs = unwrap(roles);
    return ps.map((p) => ({ ...p, role: rs.find((r) => r.user_id === p.id)?.role ?? null }));
  },
});
