-- ===== Roles =====
CREATE TYPE public.app_role AS ENUM ('admin', 'cajero');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "roles_select_auth" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_insert" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "roles_admin_update" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "roles_admin_delete" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== Profiles =====
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Ensures profile + role after login. First user becomes admin.
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r public.app_role;
  jwt jsonb := auth.jwt();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (uid, COALESCE(jwt -> 'user_metadata' ->> 'full_name', jwt -> 'user_metadata' ->> 'name'), jwt ->> 'email')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);
  SELECT role INTO r FROM public.user_roles WHERE user_id = uid ORDER BY role LIMIT 1;
  IF r IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN r := 'admin'; ELSE r := 'cajero'; END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, r);
  END IF;
  RETURN r;
END $$;

-- Admin: change another user's role
CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo administradores'; END IF;
  IF _user_id = auth.uid() AND _role <> 'admin' THEN RAISE EXCEPTION 'No puedes quitarte tu propio rol de administrador'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
END $$;

-- ===== Settings =====
CREATE TABLE public.settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name text NOT NULL DEFAULT 'Minimarket Maxi',
  address text NOT NULL DEFAULT 'Javiera Carrera 521',
  city text NOT NULL DEFAULT 'Rancagua',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select_auth" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_admin_update" ON public.settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "settings_admin_insert" ON public.settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.settings (id) VALUES (1);

-- ===== Categories =====
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort int NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_select_auth" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_admin_all" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.categories (name, sort) VALUES
  ('Abarrotes', 1), ('Lácteos', 2), ('Bebidas', 3), ('Friver', 4), ('Panadería', 5), ('Aseo', 6);

-- ===== Products =====
CREATE TYPE public.product_nature AS ENUM ('consumible', 'empaque', 'herramienta', 'repuesto');
CREATE TYPE public.product_unit AS ENUM ('unidad', 'kilo');

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  keyword text,
  name text NOT NULL,
  nature public.product_nature NOT NULL DEFAULT 'consumible',
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  unit public.product_unit NOT NULL DEFAULT 'unidad',
  price numeric(12,2) NOT NULL DEFAULT 0,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  stock numeric(12,3) NOT NULL DEFAULT 0,
  min_stock numeric(12,3) NOT NULL DEFAULT 0,
  discount_pct int NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 90),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_code_uq ON public.products (lower(code)) WHERE code IS NOT NULL AND code <> '';
CREATE UNIQUE INDEX products_keyword_uq ON public.products (lower(keyword)) WHERE keyword IS NOT NULL AND keyword <> '';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select_auth" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_admin_insert" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "products_admin_update" ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "products_admin_delete" ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Lots =====
CREATE TABLE public.lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty numeric(12,3) NOT NULL DEFAULT 0,
  qty_initial numeric(12,3) NOT NULL DEFAULT 0,
  expires_at date,
  note text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lots_product_idx ON public.lots (product_id);
CREATE INDEX lots_expires_idx ON public.lots (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lots TO authenticated;
GRANT ALL ON public.lots TO service_role;
ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lots_select_auth" ON public.lots FOR SELECT TO authenticated USING (true);
CREATE POLICY "lots_admin_all" ON public.lots FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ===== Movements =====
CREATE TYPE public.movement_type AS ENUM ('in', 'out', 'merma');

CREATE TABLE public.movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  type public.movement_type NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  unit public.product_unit NOT NULL,
  qty numeric(12,3) NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  cost_amount numeric(12,2) NOT NULL DEFAULT 0,
  discount_pct int NOT NULL DEFAULT 0,
  lot_id uuid REFERENCES public.lots(id) ON DELETE SET NULL,
  user_id uuid,
  note text
);
CREATE INDEX movements_ts_idx ON public.movements (ts DESC);
CREATE INDEX movements_product_idx ON public.movements (product_id);
GRANT SELECT ON public.movements TO authenticated;
GRANT ALL ON public.movements TO service_role;
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movements_select_auth" ON public.movements FOR SELECT TO authenticated USING (true);

-- ===== Secure operations =====
-- Sale: any authenticated user. Consumes lots FIFO by expiry.
CREATE OR REPLACE FUNCTION public.register_sale(_product_id uuid, _qty numeric, _amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.products%ROWTYPE;
  remaining numeric := _qty;
  l RECORD;
  take numeric;
  mid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  SELECT * INTO p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF p.stock < _qty THEN RAISE EXCEPTION 'Stock insuficiente de %: quedan %', p.name, p.stock; END IF;

  FOR l IN SELECT id, qty FROM public.lots WHERE product_id = _product_id AND qty > 0 ORDER BY expires_at NULLS LAST, received_at LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(l.qty, remaining);
    UPDATE public.lots SET qty = qty - take WHERE id = l.id;
    remaining := remaining - take;
  END LOOP;

  UPDATE public.products SET stock = GREATEST(0, stock - _qty) WHERE id = _product_id;
  INSERT INTO public.movements (type, product_id, product_name, unit, qty, amount, cost_amount, discount_pct, user_id)
  VALUES ('out', p.id, p.name, p.unit, _qty, _amount, _qty * p.cost, p.discount_pct, auth.uid())
  RETURNING id INTO mid;
  RETURN mid;
END $$;

-- Entry: admin only. Creates a lot.
CREATE OR REPLACE FUNCTION public.register_entry(_product_id uuid, _qty numeric, _expires_at date DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.products%ROWTYPE;
  lid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo administradores pueden registrar entradas'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  SELECT * INTO p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  INSERT INTO public.lots (product_id, qty, qty_initial, expires_at, note) VALUES (_product_id, _qty, _qty, _expires_at, _note) RETURNING id INTO lid;
  UPDATE public.products SET stock = stock + _qty WHERE id = _product_id;
  INSERT INTO public.movements (type, product_id, product_name, unit, qty, amount, cost_amount, lot_id, user_id, note)
  VALUES ('in', p.id, p.name, p.unit, _qty, _qty * p.price, _qty * p.cost, lid, auth.uid(), _note);
  RETURN lid;
END $$;

-- Waste (merma): admin only. Removes from a lot.
CREATE OR REPLACE FUNCTION public.register_waste(_lot_id uuid, _qty numeric, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.lots%ROWTYPE;
  p public.products%ROWTYPE;
  q numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo administradores pueden registrar mermas'; END IF;
  SELECT * INTO l FROM public.lots WHERE id = _lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote no encontrado'; END IF;
  SELECT * INTO p FROM public.products WHERE id = l.product_id FOR UPDATE;
  q := LEAST(COALESCE(_qty, l.qty), l.qty);
  IF q <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  UPDATE public.lots SET qty = qty - q WHERE id = _lot_id;
  UPDATE public.products SET stock = GREATEST(0, stock - q) WHERE id = p.id;
  INSERT INTO public.movements (type, product_id, product_name, unit, qty, amount, cost_amount, lot_id, user_id, note)
  VALUES ('merma', p.id, p.name, p.unit, q, 0, q * p.cost, _lot_id, auth.uid(), _note);
END $$;