CREATE OR REPLACE FUNCTION public.expiry_discount_pct(_product_id uuid, _discount_pct integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _discount_pct > 0
      AND EXISTS (
        SELECT 1
        FROM public.lots AS lot_row
        WHERE lot_row.product_id = _product_id
          AND lot_row.qty > 0
          AND lot_row.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 10
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.lots AS lot_row
        WHERE lot_row.product_id = _product_id
          AND lot_row.qty > 0
          AND lot_row.expires_at < CURRENT_DATE
      )
    THEN _discount_pct
    ELSE 0
  END
$$;

REVOKE EXECUTE ON FUNCTION public.expiry_discount_pct(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_expiry_discount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.discount_pct > 0
    AND (TG_OP = 'INSERT' OR NEW.discount_pct IS DISTINCT FROM OLD.discount_pct)
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.lots AS lot_row
        WHERE lot_row.product_id = NEW.id
          AND lot_row.qty > 0
          AND lot_row.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 10
      )
      OR EXISTS (
        SELECT 1
        FROM public.lots AS lot_row
        WHERE lot_row.product_id = NEW.id
          AND lot_row.qty > 0
          AND lot_row.expires_at < CURRENT_DATE
      )
    )
  THEN
    RAISE EXCEPTION 'El descuento solo se puede aplicar si el producto tiene stock próximo a vencer y ningún lote vencido.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER products_validate_expiry_discount
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_expiry_discount();

CREATE OR REPLACE FUNCTION public.set_expiry_discount(_product_id uuid, _discount_pct integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administradores pueden gestionar descuentos flash.';
  END IF;

  IF _discount_pct IS NULL OR _discount_pct NOT IN (0, 20, 30) THEN
    RAISE EXCEPTION 'El descuento debe ser 0, 20 o 30 por ciento.';
  END IF;

  IF _discount_pct > 0
    AND public.expiry_discount_pct(_product_id, _discount_pct) <> _discount_pct
  THEN
    RAISE EXCEPTION 'El descuento solo se puede aplicar a productos próximos a vencer sin lotes vencidos.';
  END IF;

  UPDATE public.products
  SET discount_pct = _discount_pct
  WHERE id = _product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado.';
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.set_expiry_discount(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_expiry_discount(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_sale(
  _items jsonb,
  _note text DEFAULT NULL,
  _payment_method text DEFAULT 'efectivo',
  _amount_received numeric DEFAULT NULL,
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sale_id uuid := gen_random_uuid();
  item jsonb;
  item_index integer := 0;
  item_count integer;
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
  gross_subtotal numeric := 0;
  sale_discount numeric := 0;
  applied_discount numeric := 0;
  line_discount numeric;
  sale_total numeric;
  received numeric;
  change_due numeric;
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

  IF _payment_method IS NULL OR _payment_method NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'Método de pago inválido.';
  END IF;

  IF _discount_type IS NULL
    OR _discount_type NOT IN ('none', 'percentage', 'fixed')
    OR _discount_value IS NULL
    OR _discount_value < 0 THEN
    RAISE EXCEPTION 'Descuento inválido.';
  END IF;

  item_count := jsonb_array_length(_items);

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

    IF EXISTS (
      SELECT 1
      FROM public.lots AS lot_row
      WHERE lot_row.product_id = v_product_id
        AND lot_row.qty > 0
        AND lot_row.expires_at < CURRENT_DATE
    ) THEN
      RAISE EXCEPTION 'El producto % tiene lotes vencidos. Registra la merma antes de venderlo.', prod.name;
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

    base_price := prod.price
      * (1 - public.expiry_discount_pct(prod.id, prod.discount_pct)::numeric / 100);
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

    gross_subtotal := gross_subtotal + line_amount;
  END LOOP;

  gross_subtotal := ROUND(gross_subtotal, 2);
  IF _discount_type = 'percentage' THEN
    IF _discount_value > 100 THEN
      RAISE EXCEPTION 'El descuento porcentual no puede superar el 100%%.';
    END IF;
    sale_discount := ROUND(gross_subtotal * _discount_value / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    sale_discount := ROUND(_discount_value, 2);
  END IF;

  IF sale_discount > gross_subtotal THEN
    RAISE EXCEPTION 'El descuento no puede superar el subtotal.';
  END IF;

  sale_total := ROUND(gross_subtotal - sale_discount, 2);
  IF _payment_method = 'efectivo' THEN
    IF _amount_received IS NULL OR _amount_received < sale_total THEN
      RAISE EXCEPTION 'El efectivo recibido no alcanza para cubrir el total.';
    END IF;
    received := ROUND(_amount_received, 2);
    change_due := ROUND(received - sale_total, 2);
  ELSE
    received := sale_total;
    change_due := 0;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_index := item_index + 1;
    v_product_id := (item->>'product_id')::uuid;
    v_qty := (item->>'qty')::numeric;

    SELECT * INTO prod
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM public.lots AS lot_row
      WHERE lot_row.product_id = v_product_id
        AND lot_row.qty > 0
        AND lot_row.expires_at < CURRENT_DATE
    ) THEN
      RAISE EXCEPTION 'El producto % tiene lotes vencidos. Registra la merma antes de venderlo.', prod.name;
    END IF;

    SELECT * INTO promo
    FROM public.promotions
    WHERE product_id = v_product_id AND active;
    promo_found := FOUND;

    base_price := prod.price
      * (1 - public.expiry_discount_pct(prod.id, prod.discount_pct)::numeric / 100);
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

    IF item_index = item_count THEN
      line_discount := sale_discount - applied_discount;
    ELSIF gross_subtotal > 0 THEN
      line_discount := FLOOR(sale_discount * line_amount / gross_subtotal * 100) / 100;
    ELSE
      line_discount := 0;
    END IF;
    applied_discount := applied_discount + line_discount;
    line_amount := GREATEST(0, line_amount - line_discount);

    effective_discount := CASE
      WHEN prod.price <= 0 OR v_qty <= 0 THEN 0
      ELSE GREATEST(0, LEAST(100, ROUND((1 - line_amount / (v_qty * prod.price)) * 100)::integer))
    END;

    remaining := v_qty;
    FOR lot IN
      SELECT lot_row.id, lot_row.qty
      FROM public.lots AS lot_row
      WHERE lot_row.product_id = v_product_id
        AND lot_row.qty > 0
        AND (lot_row.expires_at IS NULL OR lot_row.expires_at >= CURRENT_DATE)
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
      note,
      sale_id
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
      _note,
      sale_id
    );
  END LOOP;

  INSERT INTO public.sale_payments (
    sale_id,
    payment_method,
    subtotal,
    discount_amount,
    total,
    amount_received,
    change_amount
  )
  VALUES (
    sale_id,
    _payment_method,
    gross_subtotal,
    sale_discount,
    sale_total,
    received,
    change_due
  );

  RETURN sale_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.register_sale(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_sale(jsonb, text, text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_sale(jsonb, text, text, numeric, text, numeric) TO authenticated, service_role;
