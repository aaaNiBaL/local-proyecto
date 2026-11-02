-- Venta por carrito en una sola transacción.
-- Reemplaza el patrón de venta individual por una operación atómica con items JSONB.

CREATE OR REPLACE FUNCTION public.register_sale(_items jsonb, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sale_id uuid := gen_random_uuid();
  item jsonb;
  product_id uuid;
  qty numeric;
  prod public.products%ROWTYPE;
  remaining numeric;
  lot record;
  take numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'El payload debe ser un array JSON.';
  END IF;

  IF jsonb_array_length(_items) IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'El carrito está vacío.';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    IF item->>'product_id' IS NULL OR item->>'qty' IS NULL THEN
      RAISE EXCEPTION 'Cada item debe incluir product_id y qty';
    END IF;

    product_id := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;

    IF qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para producto %', product_id;
    END IF;

    SELECT * INTO prod
    FROM public.products
    WHERE id = product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', product_id;
    END IF;

    IF prod.active = false THEN
      RAISE EXCEPTION 'El producto % está inactivo', prod.name;
    END IF;

    IF prod.unit = 'kilo' THEN
      IF qty > prod.stock THEN
        RAISE EXCEPTION 'Stock insuficiente de %: quedan % kg', prod.name, prod.stock;
      END IF;
    ELSE
      IF qty > prod.stock THEN
        RAISE EXCEPTION 'Stock insuficiente de %: quedan % unidades', prod.name, prod.stock;
      END IF;
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    product_id := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;

    SELECT * INTO prod
    FROM public.products
    WHERE id = product_id
    FOR UPDATE;

    remaining := qty;

    FOR lot IN
      SELECT id, qty
      FROM public.lots
      WHERE product_id = product_id AND qty > 0
      ORDER BY expires_at NULLS LAST, received_at
    LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(lot.qty, remaining);
      UPDATE public.lots
      SET qty = qty - take
      WHERE id = lot.id;
      remaining := remaining - take;
    END LOOP;

    IF remaining > 0 THEN
      RAISE EXCEPTION 'No hay stock suficiente para %', prod.name;
    END IF;

    UPDATE public.products
    SET stock = stock - qty
    WHERE id = product_id;

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
      qty,
      ROUND(qty * prod.price * (1 - (COALESCE(prod.discount_pct, 0)::numeric / 100)), 2),
      ROUND(qty * prod.cost, 2),
      COALESCE(prod.discount_pct, 0),
      auth.uid(),
      _note
    );
  END LOOP;

  RETURN sale_id;
END
$$;

-- Seguridad: solo usuarios autenticados y servicio.
REVOKE EXECUTE ON FUNCTION public.register_sale(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_sale(jsonb, text) TO authenticated, service_role;

-- Mantener también la versión previa restringida.
REVOKE EXECUTE ON FUNCTION public.register_sale(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_sale(uuid, numeric, numeric) TO authenticated, service_role;
