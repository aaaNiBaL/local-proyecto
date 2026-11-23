ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS inventory_alerts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expiry_alert_days integer NOT NULL DEFAULT 7
    CHECK (expiry_alert_days IN (3, 7, 15)),
  ADD COLUMN IF NOT EXISTS whatsapp_connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_last_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_last_error text,
  ADD COLUMN IF NOT EXISTS whatsapp_notifications_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.whatsapp_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text NOT NULL CHECK (notification_type IN ('daily_report', 'low_stock', 'out_of_stock', 'expiry_alert', 'test')),
  recipient text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  dedupe_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_notifications_history_idx
  ON public.whatsapp_notifications (created_at DESC);
CREATE INDEX whatsapp_notifications_queue_idx
  ON public.whatsapp_notifications (status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.whatsapp_notifications TO authenticated;
GRANT ALL ON public.whatsapp_notifications TO service_role;
CREATE POLICY "whatsapp_notifications_admin_read"
  ON public.whatsapp_notifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.claim_whatsapp_notifications(
  _limit integer DEFAULT 20,
  _notification_id uuid DEFAULT NULL
)
RETURNS SETOF public.whatsapp_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Solo el servicio puede procesar la cola de WhatsApp';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.whatsapp_notifications
    WHERE status = 'pending'
      AND (_notification_id IS NULL OR id = _notification_id)
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 20), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_notifications AS n
  SET status = 'sending', attempts = attempts + 1, updated_at = now()
  FROM candidates
  WHERE n.id = candidates.id
  RETURNING n.*;
END
$$;
REVOKE EXECUTE ON FUNCTION public.claim_whatsapp_notifications(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_notifications(integer, uuid) TO service_role;

CREATE TABLE public.whatsapp_inventory_alert_state (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('low_stock', 'out_of_stock')),
  is_active boolean NOT NULL DEFAULT false,
  transition_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, alert_type)
);
ALTER TABLE public.whatsapp_inventory_alert_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.whatsapp_inventory_alert_state TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_inventory_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  alert_kind text;
  active_now boolean;
  previous_active boolean;
  next_transition integer;
  owner_phone text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NOT (NEW.stock IS DISTINCT FROM OLD.stock
      OR NEW.min_stock IS DISTINCT FROM OLD.min_stock
      OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RETURN NEW;
  END IF;

  SELECT owner_whatsapp INTO owner_phone
  FROM public.settings
  WHERE id = 1 AND whatsapp_notifications_enabled AND inventory_alerts_enabled;
  IF owner_phone IS NULL OR btrim(owner_phone) = '' THEN
    RETURN NEW;
  END IF;

  FOREACH alert_kind IN ARRAY ARRAY['out_of_stock', 'low_stock']
  LOOP
    active_now := CASE alert_kind
      WHEN 'out_of_stock' THEN NEW.stock <= 0
      ELSE NEW.stock > 0 AND NEW.stock <= NEW.min_stock
    END;

    INSERT INTO public.whatsapp_inventory_alert_state (product_id, alert_type, is_active, transition_count)
    VALUES (NEW.id, alert_kind, false, 0)
    ON CONFLICT (product_id, alert_type) DO NOTHING;

    SELECT is_active, transition_count
      INTO previous_active, next_transition
    FROM public.whatsapp_inventory_alert_state
    WHERE product_id = NEW.id AND alert_type = alert_kind
    FOR UPDATE;

    IF active_now IS DISTINCT FROM previous_active THEN
      next_transition := next_transition + 1;
      UPDATE public.whatsapp_inventory_alert_state
      SET is_active = active_now, transition_count = next_transition, updated_at = now()
      WHERE product_id = NEW.id AND alert_type = alert_kind;

      IF active_now THEN
        INSERT INTO public.whatsapp_notifications (
          notification_type, recipient, message, dedupe_key, metadata
        )
        VALUES (
          alert_kind,
          owner_phone,
          CASE alert_kind
            WHEN 'out_of_stock' THEN format('Producto agotado: %s. Stock disponible: %s. Cantidad mínima: %s.', NEW.name, NEW.stock, NEW.min_stock)
            ELSE format('Alerta de stock bajo: %s. Stock disponible: %s. Cantidad mínima: %s.', NEW.name, NEW.stock, NEW.min_stock)
          END,
          format('inventory:%s:%s:%s', NEW.id, alert_kind, next_transition),
          jsonb_build_object('product_id', NEW.id, 'product_name', NEW.name, 'stock', NEW.stock, 'min_stock', NEW.min_stock)
        )
        ON CONFLICT (dedupe_key) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END
$$;

CREATE TRIGGER products_whatsapp_inventory_alerts
  AFTER UPDATE OF stock, min_stock, name ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_whatsapp_inventory_alerts();

CREATE TRIGGER products_whatsapp_inventory_alerts_on_insert
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_whatsapp_inventory_alerts();

CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_expiry_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owner_phone text;
  alert_days integer;
  queued_count integer := 0;
  inserted_count integer;
BEGIN
  SELECT owner_whatsapp, expiry_alert_days
    INTO owner_phone, alert_days
  FROM public.settings
  WHERE id = 1 AND whatsapp_notifications_enabled AND inventory_alerts_enabled;

  IF owner_phone IS NULL OR btrim(owner_phone) = '' THEN
    RETURN 0;
  END IF;

  WITH inserted AS (
    INSERT INTO public.whatsapp_notifications (
      notification_type, recipient, message, dedupe_key, metadata
    )
    SELECT
      'expiry_alert',
      owner_phone,
      format('Alerta de vencimiento: %s. Stock del lote: %s. Vence el %s (en %s días).',
        p.name, l.qty, to_char(l.expires_at, 'DD/MM/YYYY'), alert_days),
      format('expiry:%s:%s:%s', l.id, l.expires_at, alert_days),
      jsonb_build_object(
        'product_id', p.id, 'product_name', p.name, 'lot_id', l.id,
        'stock', l.qty, 'expires_at', l.expires_at, 'days_before', alert_days
      )
    FROM public.lots AS l
    JOIN public.products AS p ON p.id = l.product_id
    WHERE l.qty > 0 AND l.expires_at = CURRENT_DATE + alert_days
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO queued_count FROM inserted;

  RETURN queued_count;
END
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_whatsapp_inventory_alerts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_whatsapp_expiry_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_expiry_alerts() TO service_role;
