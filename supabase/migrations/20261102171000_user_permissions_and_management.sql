ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL,
  permission text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

INSERT INTO public.role_permissions (role, permission, allowed)
SELECT role_row.role, permission_row.permission,
  CASE
    WHEN role_row.role = 'admin' THEN true
    WHEN role_row.role = 'cajero' THEN permission_row.permission IN ('dashboard', 'sales', 'search')
    ELSE permission_row.permission IN ('dashboard', 'inventory_view', 'reports', 'search')
  END
FROM unnest(enum_range(NULL::public.app_role)) AS role_row(role)
CROSS JOIN (VALUES
  ('dashboard'), ('sales'), ('search'), ('inventory_view'), ('reports'),
  ('movements_view'), ('products_manage'), ('stock_manage'), ('expiry_manage'),
  ('promotions_manage'), ('settings_manage'), ('user_manage')
) AS permission_row(permission)
ON CONFLICT (role, permission) DO NOTHING;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
CREATE POLICY "role_permissions_select_auth" ON public.role_permissions
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'cajero')
    OR public.has_role(auth.uid(), 'consulta')
  );
CREATE POLICY "role_permissions_admin_all" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    JOIN public.profiles AS profile_row ON profile_row.id = role_row.user_id
    WHERE role_row.user_id = _user_id
      AND role_row.role = _role
      AND profile_row.is_active
  )
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles AS admin_role
    JOIN public.profiles AS admin_profile ON admin_profile.id = admin_role.user_id
    WHERE admin_role.user_id = _user_id AND admin_role.role = 'admin' AND admin_profile.is_active
  ) OR EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    JOIN public.profiles AS profile_row ON profile_row.id = role_row.user_id
    JOIN public.role_permissions AS permission_row
      ON permission_row.role = role_row.role
    WHERE role_row.user_id = _user_id
      AND profile_row.is_active
      AND permission_row.permission = _permission
      AND permission_row.allowed
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(array_agg(DISTINCT permission_row.permission), ARRAY[]::text[])
  FROM public.user_roles AS role_row
  JOIN public.profiles AS profile_row ON profile_row.id = role_row.user_id
  JOIN public.role_permissions AS permission_row ON permission_row.role = role_row.role
  WHERE role_row.user_id = auth.uid()
    AND profile_row.is_active
    AND permission_row.allowed
$$;

REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.app_role
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := auth.uid();
  r public.app_role;
  jwt jsonb := auth.jwt();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (uid, COALESCE(jwt -> 'user_metadata' ->> 'full_name', jwt -> 'user_metadata' ->> 'name'), jwt ->> 'email')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_active) THEN
    RAISE EXCEPTION 'La cuenta está desactivada. Contacta al administrador.';
  END IF;
  SELECT role INTO r FROM public.user_roles WHERE user_id = uid ORDER BY role LIMIT 1;
  IF r IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
      r := 'admin';
    ELSE
      r := 'cajero';
    END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, r);
  END IF;
  RETURN r;
END
$$;

CREATE OR REPLACE FUNCTION public.protect_admin_permissions()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' OR OLD.permission = 'user_manage' THEN
      RAISE EXCEPTION 'Este permiso está reservado para administradores';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.role IS DISTINCT FROM OLD.role OR NEW.permission IS DISTINCT FROM OLD.permission
  ) THEN
    RAISE EXCEPTION 'No puedes cambiar la identidad del permiso';
  END IF;
  IF (NEW.role = 'admin' AND NEW.allowed IS DISTINCT FROM true)
    OR (NEW.permission = 'user_manage' AND NEW.role <> 'admin' AND NEW.allowed)
  THEN
    RAISE EXCEPTION 'El rol administrador siempre conserva todos los permisos';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER role_permissions_protect_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin_permissions();

CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  admins integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo administradores'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('invenco-admin-role-guard'));
  IF _user_id = auth.uid() AND _role <> 'admin' THEN
    RAISE EXCEPTION 'No puedes quitarte tu propio rol de administrador';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
    AND _role <> 'admin' THEN
    SELECT count(*) INTO admins
    FROM public.user_roles AS role_row
    JOIN public.profiles AS profile_row ON profile_row.id = role_row.user_id
    WHERE role_row.role = 'admin' AND profile_row.is_active;
    IF admins <= 1 THEN RAISE EXCEPTION 'No puedes quitar el último administrador activo'; END IF;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  INSERT INTO public.activity_log (actor_id, target_user_id, action, details)
  VALUES (auth.uid(), _user_id, 'user_role_changed', jsonb_build_object('role', _role));
END
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  _user_id uuid,
  _role public.app_role,
  _is_active boolean,
  _full_name text,
  _email text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  admins integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo administradores'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('invenco-admin-role-guard'));
  IF _user_id = auth.uid() AND (NOT _is_active OR _role <> 'admin') THEN
    RAISE EXCEPTION 'No puedes desactivar ni cambiar el rol de tu propia cuenta';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
    AND (NOT _is_active OR _role <> 'admin') THEN
    SELECT count(*) INTO admins
    FROM public.user_roles AS role_row
    JOIN public.profiles AS profile_row ON profile_row.id = role_row.user_id
    WHERE role_row.role = 'admin' AND profile_row.is_active;
    IF admins <= 1 THEN RAISE EXCEPTION 'No puedes desactivar ni degradar al último administrador activo'; END IF;
  END IF;
  IF _full_name IS NULL OR length(btrim(_full_name)) = 0 OR length(_full_name) > 120 THEN
    RAISE EXCEPTION 'El nombre es obligatorio y no puede superar 120 caracteres';
  END IF;
  IF _email IS NULL OR length(btrim(_email)) = 0 OR length(_email) > 254 THEN
    RAISE EXCEPTION 'Correo electrónico inválido';
  END IF;
  PERFORM set_config('app.admin_user_update', 'true', true);
  UPDATE public.profiles
  SET full_name = btrim(_full_name), email = lower(btrim(_email)), is_active = _is_active
  WHERE id = _user_id;
  PERFORM set_config('app.admin_user_update', 'false', true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  INSERT INTO public.activity_log (actor_id, target_user_id, action, details)
  VALUES (auth.uid(), _user_id, 'user_updated',
    jsonb_build_object('role', _role, 'is_active', _is_active, 'full_name', btrim(_full_name), 'email', lower(btrim(_email))));
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user(uuid, public.app_role, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, public.app_role, boolean, text, text) TO authenticated;

CREATE TABLE public.activity_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  target_user_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_created_at_idx ON public.activity_log (created_at DESC);
CREATE INDEX activity_log_actor_idx ON public.activity_log (actor_id, created_at DESC);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
CREATE POLICY "activity_log_admin_read" ON public.activity_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.log_inventory_activity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  action_name text;
  event_data jsonb;
BEGIN
  IF TG_TABLE_NAME = 'movements' THEN
    action_name := 'movement_' || NEW.type::text;
    event_data := jsonb_build_object(
      'product_id', NEW.product_id, 'product_name', NEW.product_name,
      'quantity', NEW.qty, 'reason', NEW.note, 'movement_id', NEW.id
    );
    INSERT INTO public.activity_log (actor_id, action, details)
    VALUES (NEW.user_id, action_name, event_data);
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['stock', 'updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['stock', 'updated_at']) THEN
      INSERT INTO public.activity_log (actor_id, action, details)
      VALUES (auth.uid(), 'product_updated',
        jsonb_build_object('product_id', NEW.id, 'product_name', NEW.name,
          'product', to_jsonb(NEW)));
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log (actor_id, action, details)
    VALUES (auth.uid(), 'product_created',
      jsonb_build_object('product_id', NEW.id, 'product_name', NEW.name));
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER movements_activity_log
  AFTER INSERT ON public.movements
  FOR EACH ROW EXECUTE FUNCTION public.log_inventory_activity();
CREATE TRIGGER products_activity_log
  AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_inventory_activity();

CREATE OR REPLACE FUNCTION public.enforce_movement_permission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  required_permission text;
BEGIN
  required_permission := CASE NEW.type
    WHEN 'out' THEN 'sales'
    WHEN 'in' THEN 'stock_manage'
    WHEN 'merma' THEN 'expiry_manage'
    WHEN 'devolucion' THEN 'sales'
    ELSE NULL
  END;
  IF required_permission IS NULL OR NOT public.has_permission(auth.uid(), required_permission) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar este movimiento';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER movements_permission_check
  BEFORE INSERT ON public.movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_movement_permission();

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_auth" ON public.profiles;
CREATE POLICY "profiles_read_admin_and_reports" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'user_manage')
    OR public.has_permission(auth.uid(), 'reports')
    OR public.has_permission(auth.uid(), 'movements_view')
  );
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() = OLD.id AND (
    NEW.email IS DISTINCT FROM OLD.email OR
    NEW.is_active IS DISTINCT FROM OLD.is_active
  ) AND current_setting('app.admin_user_update', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'No puedes cambiar el correo ni el estado de tu cuenta desde el perfil';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER profiles_protect_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

DROP POLICY IF EXISTS "roles_admin_insert" ON public.user_roles;
DROP POLICY IF EXISTS "roles_admin_update" ON public.user_roles;
DROP POLICY IF EXISTS "roles_admin_delete" ON public.user_roles;
DROP POLICY IF EXISTS "roles_select_auth" ON public.user_roles;
CREATE POLICY "roles_select_auth" ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_permission(auth.uid(), 'user_manage')
    OR public.has_permission(auth.uid(), 'reports')
    OR public.has_permission(auth.uid(), 'movements_view')
  );
CREATE POLICY "roles_change_through_rpc_only" ON public.user_roles
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "settings_admin_update" ON public.settings;
DROP POLICY IF EXISTS "settings_admin_insert" ON public.settings;
DROP POLICY IF EXISTS "settings_select_auth" ON public.settings;
CREATE POLICY "settings_select_active" ON public.settings FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'dashboard')
    OR public.has_permission(auth.uid(), 'settings_manage')
  );
CREATE POLICY "settings_admin_update" ON public.settings FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'settings_manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'settings_manage'));
CREATE POLICY "settings_admin_insert" ON public.settings FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'settings_manage'));

DROP POLICY IF EXISTS "categories_admin_all" ON public.categories;
DROP POLICY IF EXISTS "categories_select_auth" ON public.categories;
CREATE POLICY "categories_select_by_permission" ON public.categories FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'inventory_view')
    OR public.has_permission(auth.uid(), 'sales')
    OR public.has_permission(auth.uid(), 'dashboard')
    OR public.has_permission(auth.uid(), 'search')
    OR public.has_permission(auth.uid(), 'reports')
  );
CREATE POLICY "categories_admin_all" ON public.categories FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'products_manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'products_manage'));

DROP POLICY IF EXISTS "products_select_auth" ON public.products;
DROP POLICY IF EXISTS "products_admin_insert" ON public.products;
DROP POLICY IF EXISTS "products_admin_update" ON public.products;
DROP POLICY IF EXISTS "products_admin_delete" ON public.products;
CREATE POLICY "products_select_by_permission" ON public.products FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'inventory_view')
    OR public.has_permission(auth.uid(), 'sales')
    OR public.has_permission(auth.uid(), 'dashboard')
    OR public.has_permission(auth.uid(), 'search')
    OR public.has_permission(auth.uid(), 'reports')
  );
CREATE POLICY "products_manage_insert" ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'products_manage'));
CREATE POLICY "products_manage_update" ON public.products FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'products_manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'products_manage'));
CREATE POLICY "products_manage_delete" ON public.products FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'products_manage'));

CREATE OR REPLACE FUNCTION public.protect_product_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['stock', 'discount_pct', 'updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['stock', 'discount_pct', 'updated_at'])
    AND NOT public.has_permission(auth.uid(), 'products_manage')
  THEN
    RAISE EXCEPTION 'No tienes permiso para modificar los datos del producto';
  END IF;
  IF auth.uid() IS NOT NULL
    AND NEW.discount_pct IS DISTINCT FROM OLD.discount_pct
    AND NOT (
      public.has_permission(auth.uid(), 'products_manage')
      OR public.has_permission(auth.uid(), 'expiry_manage')
    )
  THEN
    RAISE EXCEPTION 'No tienes permiso para modificar el descuento';
  END IF;
  IF auth.uid() IS NOT NULL
    AND NEW.stock IS DISTINCT FROM OLD.stock
    AND NOT (
      public.has_permission(auth.uid(), 'products_manage')
      OR public.has_permission(auth.uid(), 'sales')
      OR public.has_permission(auth.uid(), 'stock_manage')
      OR public.has_permission(auth.uid(), 'expiry_manage')
    )
  THEN
    RAISE EXCEPTION 'No tienes permiso para modificar el inventario';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER products_permission_check
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.protect_product_changes();

DROP POLICY IF EXISTS "lots_select_auth" ON public.lots;
DROP POLICY IF EXISTS "lots_admin_all" ON public.lots;
CREATE POLICY "lots_select_by_permission" ON public.lots FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'inventory_view')
    OR public.has_permission(auth.uid(), 'sales')
    OR public.has_permission(auth.uid(), 'dashboard')
    OR public.has_permission(auth.uid(), 'reports')
  );
CREATE POLICY "lots_manage_insert" ON public.lots FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'stock_manage'));
CREATE POLICY "lots_manage_update" ON public.lots FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'stock_manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'stock_manage'));
CREATE POLICY "lots_manage_delete" ON public.lots FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'stock_manage'));

DROP POLICY IF EXISTS "movements_select_auth" ON public.movements;
CREATE POLICY "movements_select_by_permission" ON public.movements FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'movements_view')
    OR public.has_permission(auth.uid(), 'reports')
    OR public.has_permission(auth.uid(), 'dashboard')
    OR public.has_permission(auth.uid(), 'sales')
  );

DROP POLICY IF EXISTS "promotions_admin_all" ON public.promotions;
DROP POLICY IF EXISTS "promotions_select_auth" ON public.promotions;
CREATE POLICY "promotions_select_by_permission" ON public.promotions FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'sales')
    OR public.has_permission(auth.uid(), 'promotions_manage')
  );
CREATE POLICY "promotions_manage_all" ON public.promotions FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'promotions_manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'promotions_manage'));

DROP POLICY IF EXISTS "inventory_adjustments_admin_select" ON public.inventory_adjustments;
CREATE POLICY "inventory_adjustments_permission_select" ON public.inventory_adjustments FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'movements_view'));

DROP POLICY IF EXISTS "sale_payments_select_auth" ON public.sale_payments;
CREATE POLICY "sale_payments_select_permission" ON public.sale_payments FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'sales')
    OR public.has_permission(auth.uid(), 'dashboard')
    OR public.has_permission(auth.uid(), 'reports')
  );

CREATE OR REPLACE FUNCTION public.register_entry(
  _product_id uuid, _qty numeric, _expires_at date DEFAULT NULL, _note text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p public.products%ROWTYPE;
  lid uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'stock_manage') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar entradas';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  SELECT * INTO p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  INSERT INTO public.lots (product_id, qty, qty_initial, expires_at, note)
    VALUES (_product_id, _qty, _qty, _expires_at, _note) RETURNING id INTO lid;
  UPDATE public.products SET stock = stock + _qty WHERE id = _product_id;
  INSERT INTO public.movements (type, product_id, product_name, unit, qty, amount, cost_amount, lot_id, user_id, note)
    VALUES ('in', p.id, p.name, p.unit, _qty, _qty * p.price, _qty * p.cost, lid, auth.uid(), _note);
  RETURN lid;
END
$$;

CREATE OR REPLACE FUNCTION public.register_waste(_lot_id uuid, _qty numeric, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l public.lots%ROWTYPE;
  p public.products%ROWTYPE;
  q numeric;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expiry_manage') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar mermas';
  END IF;
  SELECT * INTO l FROM public.lots WHERE id = _lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote no encontrado'; END IF;
  SELECT * INTO p FROM public.products WHERE id = l.product_id FOR UPDATE;
  q := LEAST(COALESCE(_qty, l.qty), l.qty);
  IF q <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  UPDATE public.lots SET qty = qty - q WHERE id = _lot_id;
  UPDATE public.products SET stock = GREATEST(0, stock - q) WHERE id = p.id;
  INSERT INTO public.movements (type, product_id, product_name, unit, qty, amount, cost_amount, lot_id, user_id, note)
    VALUES ('merma', p.id, p.name, p.unit, q, 0, q * p.cost, _lot_id, auth.uid(), _note);
END
$$;

CREATE OR REPLACE FUNCTION public.set_expiry_discount(_product_id uuid, _discount_pct integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expiry_manage') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar descuentos flash';
  END IF;
  IF _discount_pct IS NULL OR _discount_pct NOT IN (0, 20, 30) THEN
    RAISE EXCEPTION 'El descuento debe ser 0, 20 o 30 por ciento';
  END IF;
  IF _discount_pct > 0 AND public.expiry_discount_pct(_product_id, _discount_pct) <> _discount_pct THEN
    RAISE EXCEPTION 'El descuento solo se puede aplicar a productos próximos a vencer sin lotes vencidos';
  END IF;
  UPDATE public.products SET discount_pct = _discount_pct WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.adjust_inventory(_product_id uuid, _quantity_delta numeric, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p public.products%ROWTYPE;
  next_stock numeric(12,3);
  adjustment_id uuid;
  remaining numeric(12,3);
  lot_row record;
  quantity_to_remove numeric(12,3);
BEGIN
  IF NOT public.has_permission(auth.uid(), 'stock_manage') THEN
    RAISE EXCEPTION 'No tienes permiso para ajustar el inventario';
  END IF;
  IF _quantity_delta IS NULL OR _quantity_delta = 0 THEN RAISE EXCEPTION 'La cantidad del ajuste debe ser distinta de cero'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN RAISE EXCEPTION 'La razón del ajuste es obligatoria'; END IF;
  IF length(btrim(_reason)) > 500 THEN RAISE EXCEPTION 'La razón no puede superar 500 caracteres'; END IF;
  SELECT * INTO p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  next_stock := p.stock + _quantity_delta;
  IF next_stock < 0 THEN RAISE EXCEPTION 'El ajuste no puede dejar el stock negativo (actual: %)', p.stock; END IF;
  UPDATE public.products SET stock = next_stock WHERE id = p.id;
  IF _quantity_delta > 0 THEN
    INSERT INTO public.lots (product_id, qty, qty_initial, note)
      VALUES (p.id, _quantity_delta, _quantity_delta, 'Ajuste: ' || btrim(_reason));
  ELSE
    remaining := abs(_quantity_delta);
    FOR lot_row IN SELECT id, qty FROM public.lots WHERE product_id = p.id AND qty > 0
      ORDER BY expires_at NULLS LAST, received_at FOR UPDATE
    LOOP
      EXIT WHEN remaining <= 0;
      quantity_to_remove := LEAST(lot_row.qty, remaining);
      UPDATE public.lots SET qty = qty - quantity_to_remove WHERE id = lot_row.id;
      remaining := remaining - quantity_to_remove;
    END LOOP;
  END IF;
  INSERT INTO public.inventory_adjustments (
    product_id, product_name, previous_stock, quantity_delta, new_stock, reason, user_id, user_email
  ) VALUES (
    p.id, p.name, p.stock, _quantity_delta, next_stock, btrim(_reason), auth.uid(), auth.jwt() ->> 'email'
  ) RETURNING id INTO adjustment_id;
  INSERT INTO public.activity_log (actor_id, action, details)
  VALUES (auth.uid(), 'inventory_adjusted',
    jsonb_build_object('product_id', p.id, 'product_name', p.name, 'quantity', _quantity_delta, 'reason', btrim(_reason)));
  RETURN adjustment_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_entry(uuid, numeric, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_waste(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_inventory(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_expiry_discount(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_entry(uuid, numeric, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_waste(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_expiry_discount(uuid, integer) TO authenticated;
