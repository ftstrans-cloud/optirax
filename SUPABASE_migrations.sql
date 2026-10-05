-- ============================================================
-- OPTIRAX — migracje do wklejenia w Supabase SQL Editor
-- Kolejność: wykonaj od góry do dołu
-- ============================================================

-- 1. Dodaj vehicle_id i vehicle_reg do wycen
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vehicle_id  TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vehicle_reg TEXT;

-- 2. Historia serwisowa pojazdów
CREATE TABLE IF NOT EXISTS vehicle_service_logs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL DEFAULT 'default',
  auth_user_id  TEXT NOT NULL,
  vehicle_id    TEXT REFERENCES vehicles(id) ON DELETE CASCADE,
  log_date      DATE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('oc','przeglad','tacho','serwis','naprawa','inne')),
  title         TEXT NOT NULL,
  workshop      TEXT,
  cost_pln      NUMERIC(10,2),
  notes         TEXT,
  -- Opcjonalnie: po dodaniu wpisu automatycznie aktualizuj terminarz pojazdu
  updates_oc_date       DATE,
  updates_przeglad_date DATE,
  updates_tacho_date    DATE,
  updates_serwis_date   DATE,
  updates_serwis_km     INT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vsl_vehicle ON vehicle_service_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS vsl_user    ON vehicle_service_logs(auth_user_id);

ALTER TABLE vehicle_service_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user sees own service logs" ON vehicle_service_logs
  FOR ALL USING (true) WITH CHECK (true);
