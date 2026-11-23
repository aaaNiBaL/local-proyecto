ALTER TABLE public.products
  ADD COLUMN supplier text,
  ADD COLUMN location text;

CREATE TABLE public.inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  previous_stock numeric(12,3) NOT NULL,
  quantity_delta numeric(12,3) NOT NULL CHECK (quantity_delta <> 0),
  new_stock numeric(12,3) NOT NULL CHECK (new_stock >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  user_id uuid NOT NULL,
  user_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_adjustments_created_at_idx
  ON public.inventory_adjustments (created_at DESC);
CREATE INDEX inventory_adjustments_product_idx
  ON public.inventory_adjustments (product_id);

GRANT SELECT ON public.inventory_adjustments TO authenticated;
GRANT ALL ON public.inventory_adjustments TO service_role;
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventory_adjustments_admin_select"
  ON public.inventory_adjustments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.adjust_inventory(
  _product_id uuid,
  _quantity_delta numeric,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.products%ROWTYPE;
  next_stock numeric(12,3);
  adjustment_id uuid;
  remaining numeric(12,3);
  lot_row record;
  quantity_to_remove numeric(12,3);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administradores pueden ajustar el inventario';
  END IF;
  IF _quantity_delta IS NULL OR _quantity_delta = 0 THEN
    RAISE EXCEPTION 'La cantidad del ajuste debe ser distinta de cero';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'La razón del ajuste es obligatoria';
  END IF;
  IF length(btrim(_reason)) > 500 THEN
    RAISE EXCEPTION 'La razón no puede superar 500 caracteres';
  END IF;

  SELECT * INTO p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  next_stock := p.stock + _quantity_delta;
  IF next_stock < 0 THEN
    RAISE EXCEPTION 'El ajuste no puede dejar el stock negativo (actual: %)', p.stock;
  END IF;

  UPDATE public.products SET stock = next_stock WHERE id = p.id;

  IF _quantity_delta > 0 THEN
    INSERT INTO public.lots (product_id, qty, qty_initial, note)
    VALUES (p.id, _quantity_delta, _quantity_delta, 'Ajuste: ' || btrim(_reason));
  ELSE
    remaining := abs(_quantity_delta);
    FOR lot_row IN
      SELECT id, qty
      FROM public.lots
      WHERE product_id = p.id AND qty > 0
      ORDER BY expires_at NULLS LAST, received_at
      FOR UPDATE
    LOOP
      EXIT WHEN remaining <= 0;
      quantity_to_remove := LEAST(lot_row.qty, remaining);
      UPDATE public.lots SET qty = qty - quantity_to_remove WHERE id = lot_row.id;
      remaining := remaining - quantity_to_remove;
    END LOOP;
  END IF;

  INSERT INTO public.inventory_adjustments (
    product_id, product_name, previous_stock, quantity_delta, new_stock,
    reason, user_id, user_email
  )
  VALUES (
    p.id, p.name, p.stock, _quantity_delta, next_stock,
    btrim(_reason), auth.uid(), auth.jwt() ->> 'email'
  )
  RETURNING id INTO adjustment_id;

  RETURN adjustment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_inventory(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, numeric, text) TO authenticated, service_role;
