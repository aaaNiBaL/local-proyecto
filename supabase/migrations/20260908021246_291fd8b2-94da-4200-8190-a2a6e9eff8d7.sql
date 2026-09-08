ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'devolucion';

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS owner_whatsapp text NOT NULL DEFAULT '+56923605378',
  ADD COLUMN IF NOT EXISTS daily_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_report_hour integer NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS last_report_on date;