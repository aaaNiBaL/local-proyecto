CREATE OR REPLACE FUNCTION public.register_supplier_return(
  _product_id uuid,
  _qty numeric,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  product_row public.products%ROWTYPE;
  remaining numeric(12,3);
  quantity_to_remove numeric(12,3);
  lot_row record;
  movement_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT public.has_permission(auth.uid(), 'stock_manage') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar el inventario';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Ingresa una cantidad válida';
  END IF;
  IF _note IS NULL OR length(btrim(_note)) = 0 THEN
    RAISE EXCEPTION 'Indica el proveedor o el motivo de la devolución';
  END IF;
  IF length(btrim(_note)) > 500 THEN
    RAISE EXCEPTION 'El detalle no puede superar 500 caracteres';
  END IF;

  SELECT *
    INTO product_row
  FROM public.products
  WHERE id = _product_id
    AND active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;
  IF product_row.stock < _qty THEN
    RAISE EXCEPTION 'No hay stock suficiente para devolver esa cantidad (disponible: %)', product_row.stock;
  END IF;
  IF _qty <> round(_qty, 3) THEN
    RAISE EXCEPTION 'La cantidad puede tener hasta tres decimales';
  END IF;
  IF product_row.unit = 'unidad' AND _qty <> trunc(_qty) THEN
    RAISE EXCEPTION 'La cantidad de este producto debe ser un número entero';
  END IF;

  remaining := _qty;
  FOR lot_row IN
    SELECT id, qty
    FROM public.lots
    WHERE product_id = product_row.id
      AND qty > 0
    ORDER BY expires_at NULLS LAST, received_at
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    quantity_to_remove := LEAST(lot_row.qty, remaining);
    UPDATE public.lots
    SET qty = qty - quantity_to_remove
    WHERE id = lot_row.id;
    remaining := remaining - quantity_to_remove;
  END LOOP;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'El stock de los lotes no coincide con el inventario; no se registró la devolución';
  END IF;

  UPDATE public.products
  SET stock = stock - _qty
  WHERE id = product_row.id;

  INSERT INTO public.movements (
    type,
    product_id,
    product_name,
    unit,
    qty,
    amount,
    cost_amount,
    user_id,
    note
  )
  VALUES (
    'devolucion_proveedor',
    product_row.id,
    product_row.name,
    product_row.unit,
    _qty,
    0,
    _qty * product_row.cost,
    auth.uid(),
    btrim(_note)
  )
  RETURNING id INTO movement_id;

  RETURN movement_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.register_supplier_return(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_supplier_return(uuid, numeric, text)
  TO authenticated, service_role;
