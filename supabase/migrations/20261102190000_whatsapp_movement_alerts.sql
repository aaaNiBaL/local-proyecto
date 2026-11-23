ALTER TABLE public.whatsapp_notifications
  DROP CONSTRAINT IF EXISTS whatsapp_notifications_notification_type_check;

ALTER TABLE public.whatsapp_notifications
  ADD CONSTRAINT whatsapp_notifications_notification_type_check
  CHECK (
    notification_type IN (
      'daily_report',
      'low_stock',
      'out_of_stock',
      'expiry_alert',
      'test',
      'inventory_adjustment',
      'waste',
      'return',
      'supplier_return'
    )
  );

CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_inventory_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  activity jsonb;
  notification_kind text;
  activity_label text;
  quantity_text text;
  activity_detail text;
  owner_phone text;
BEGIN
  activity := to_jsonb(NEW);

  IF TG_TABLE_NAME = 'inventory_adjustments' THEN
    notification_kind := 'inventory_adjustment';
    activity_label := 'Ajuste manual de inventario';
    quantity_text := activity ->> 'quantity_delta';
    activity_detail := COALESCE(NULLIF(activity ->> 'reason', ''), 'Sin motivo indicado');
  ELSE
    IF activity ->> 'type' = 'merma' THEN
      notification_kind := 'waste';
      activity_label := 'Merma registrada';
    ELSIF activity ->> 'type' = 'devolucion' THEN
      notification_kind := 'return';
      activity_label := 'Devolución de cliente';
    ELSIF activity ->> 'type' = 'devolucion_proveedor' THEN
      notification_kind := 'supplier_return';
      activity_label := 'Devolución a proveedor';
    ELSE
      RETURN NEW;
    END IF;
    quantity_text := concat(activity ->> 'qty', ' ', activity ->> 'unit');
    activity_detail := COALESCE(NULLIF(activity ->> 'note', ''), 'Sin detalle adicional');
  END IF;

  SELECT owner_whatsapp
    INTO owner_phone
  FROM public.settings
  WHERE id = 1
    AND whatsapp_notifications_enabled
    AND inventory_alerts_enabled;

  IF owner_phone IS NULL OR btrim(owner_phone) = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.whatsapp_notifications (
    notification_type,
    recipient,
    message,
    dedupe_key,
    metadata
  )
  VALUES (
    notification_kind,
    owner_phone,
    format(
      '%s: %s. Cantidad: %s. Detalle: %s.',
      activity_label,
      COALESCE(activity ->> 'product_name', 'Producto'),
      quantity_text,
      activity_detail
    ),
    format('inventory-activity:%s:%s', notification_kind, activity ->> 'id'),
    jsonb_build_object(
      'record_id', activity ->> 'id',
      'product_name', activity ->> 'product_name',
      'quantity', quantity_text,
      'detail', activity_detail
    )
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_whatsapp_inventory_activity()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER inventory_adjustments_whatsapp_activity
  AFTER INSERT ON public.inventory_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_whatsapp_inventory_activity();

CREATE TRIGGER movements_whatsapp_activity
  AFTER INSERT ON public.movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_whatsapp_inventory_activity();
