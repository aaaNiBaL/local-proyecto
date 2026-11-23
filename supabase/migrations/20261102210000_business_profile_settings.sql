ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS business_description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'Región del Libertador General Bernardo O''Higgins',
  ADD COLUMN IF NOT EXISTS opening_time time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS closing_time time NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS operating_days text[] NOT NULL
    DEFAULT ARRAY['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CLP',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Santiago',
  ADD COLUMN IF NOT EXISTS business_status text NOT NULL DEFAULT 'abierto';

ALTER TABLE public.settings
  ADD CONSTRAINT settings_operating_days_valid
    CHECK (
      cardinality(operating_days) <= 7
      AND operating_days <@ ARRAY[
        'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'
      ]::text[]
    ),
  ADD CONSTRAINT settings_currency_chile_only
    CHECK (currency = 'CLP'),
  ADD CONSTRAINT settings_timezone_chile_only
    CHECK (timezone = 'America/Santiago'),
  ADD CONSTRAINT settings_business_status_valid
    CHECK (business_status IN ('abierto', 'cerrado', 'temporalmente_inactivo'));
