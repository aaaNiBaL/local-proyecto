CREATE OR REPLACE FUNCTION public.register_return(_product_id uuid, _qty numeric, _amount numeric, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.products%ROWTYPE;
  lid uuid;
  mid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF _amount < 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  SELECT * INTO p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  INSERT INTO public.lots (product_id, qty, qty_initial, note)
  VALUES (_product_id, _qty, _qty, COALESCE(_note, 'Devolución de cliente'))
  RETURNING id INTO lid;

  UPDATE public.products SET stock = stock + _qty WHERE id = _product_id;

  INSERT INTO public.movements (type, product_id, product_name, unit, qty, amount, cost_amount, lot_id, user_id, note)
  VALUES ('devolucion', p.id, p.name, p.unit, _qty, _amount, _qty * p.cost, lid, auth.uid(), _note)
  RETURNING id INTO mid;
  RETURN mid;
END $function$;

REVOKE EXECUTE ON FUNCTION public.register_return(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_return(uuid, numeric, numeric, text) TO authenticated, service_role;