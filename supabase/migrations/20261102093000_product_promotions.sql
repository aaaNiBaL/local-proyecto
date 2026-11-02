CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  promo_type text NOT NULL CHECK (promo_type IN ('price', 'bundle')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text,
  promo_price numeric(12,2),
  bundle_qty integer,
  bundle_price numeric(12,2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_valid_offer CHECK (
    (
      promo_type = 'price'
      AND promo_price IS NOT NULL
      AND promo_price > 0
      AND bundle_qty IS NULL
      AND bundle_price IS NULL
    )
    OR
    (
      promo_type = 'bundle'
      AND promo_price IS NULL
      AND bundle_qty IS NOT NULL
      AND bundle_qty >= 2
      AND bundle_price IS NOT NULL
      AND bundle_price > 0
    )
  )
);

CREATE INDEX promotions_active_idx ON public.promotions (active) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promotions_select_auth" ON public.promotions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "promotions_admin_all" ON public.promotions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.register_sale(_items jsonb, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sale_id uuid := gen_random_uuid();
  item jsonb;
  v_product_id uuid;
  v_qty numeric;
  prod public.products%ROWTYPE;
  promo public.promotions%ROWTYPE;
  promo_found boolean;
  remaining numeric;
  lot record;
  take numeric;
  line_amount numeric;
  base_price numeric;
  effective_discount integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'El carrito está vacío o no es válido.';
  END IF;

  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'El carrito está vacío o no es válido.';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    IF item->>'product_id' IS NULL OR item->>'qty' IS NULL THEN
      RAISE EXCEPTION 'Cada item debe incluir product_id y qty';
    END IF;

    v_product_id := (item->>'product_id')::uuid;
    v_qty := (item->>'qty')::numeric;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para producto %', v_product_id;
    END IF;

    SELECT * INTO prod
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_product_id;
    END IF;

    IF NOT prod.active THEN
      RAISE EXCEPTION 'El producto % está inactivo', prod.name;
    END IF;

    IF prod.unit = 'unidad' AND v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION 'La cantidad de % debe ser un número entero', prod.name;
    END IF;

    IF v_qty > prod.stock THEN
      RAISE EXCEPTION 'Stock insuficiente de %: quedan %', prod.name, prod.stock;
    END IF;

    SELECT * INTO promo
    FROM public.promotions
    WHERE product_id = v_product_id AND active;
    promo_found := FOUND;

    IF promo_found AND promo.promo_type = 'bundle' AND prod.unit <> 'unidad' THEN
      RAISE EXCEPTION 'La promoción por paquete de % requiere venta por unidad', prod.name;
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_product_id := (item->>'product_id')::uuid;
    v_qty := (item->>'qty')::numeric;

    SELECT * INTO prod
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    SELECT * INTO promo
    FROM public.promotions
    WHERE product_id = v_product_id AND active;
    promo_found := FOUND;

    base_price := prod.price * (1 - COALESCE(prod.discount_pct, 0)::numeric / 100);
    IF promo_found AND promo.promo_type = 'price' THEN
      line_amount := ROUND(v_qty * promo.promo_price, 2);
    ELSIF promo_found AND promo.promo_type = 'bundle' THEN
      line_amount :=
        FLOOR(v_qty / promo.bundle_qty) * promo.bundle_price
        + MOD(v_qty, promo.bundle_qty) * base_price;
      line_amount := ROUND(line_amount, 2);
    ELSE
      line_amount := ROUND(v_qty * base_price, 2);
    END IF;

    effective_discount := CASE
      WHEN prod.price <= 0 THEN 0
      ELSE GREATEST(0, LEAST(100, ROUND((1 - line_amount / (v_qty * prod.price)) * 100)::integer))
    END;

    remaining := v_qty;
    FOR lot IN
      SELECT lot_row.id, lot_row.qty
      FROM public.lots AS lot_row
      WHERE lot_row.product_id = v_product_id AND lot_row.qty > 0
      ORDER BY lot_row.expires_at NULLS LAST, lot_row.received_at
      FOR UPDATE
    LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(lot.qty, remaining);
      UPDATE public.lots SET qty = qty - take WHERE id = lot.id;
      remaining := remaining - take;
    END LOOP;

    IF remaining > 0 THEN
      RAISE EXCEPTION 'No hay stock suficiente en lotes para %', prod.name;
    END IF;

    UPDATE public.products
    SET stock = stock - v_qty
    WHERE id = v_product_id;

    INSERT INTO public.movements (
      type,
      product_id,
      product_name,
      unit,
      qty,
      amount,
      cost_amount,
      discount_pct,
      user_id,
      note
    )
    VALUES (
      'out',
      prod.id,
      prod.name,
      prod.unit,
      v_qty,
      line_amount,
      ROUND(v_qty * prod.cost, 2),
      effective_discount,
      auth.uid(),
      _note
    );
  END LOOP;

  RETURN sale_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.register_sale(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_sale(jsonb, text) TO authenticated, service_role;
