-- ============================================================
-- OPTIRAX – Supabase SQL Setup
-- Wklej całość w Supabase → SQL Editor → Run
-- ============================================================

-- 1. HISTORIA WYCEN
create table if not exists quotes (
  id          text primary key,
  user_id     text not null default 'default',
  ts          bigint not null,
  name        text,
  client      text,
  note        text,
  origin      text,
  destination text,
  stops       jsonb default '[]',
  distance_km numeric,
  duration_h  numeric,
  total_cost  numeric,
  price_eur   numeric,
  margin_eur  numeric,
  margin_pct  numeric,
  tolls_eur   numeric,
  fuel_eur    numeric,
  driver_eur  numeric,
  other_eur   numeric,
  tolls_geo   jsonb,
  vignettes   jsonb,
  calc        jsonb,
  input       jsonb,
  created_at  timestamptz default now()
);

create index if not exists quotes_user_ts on quotes(user_id, ts desc);

-- 2. TRACKER SPALANIA
create table if not exists fuel_trips (
  id          bigint primary key,
  user_id     text not null default 'default',
  reg         text,
  driver      text,
  date_out    text,
  date_in     text,
  km          numeric,
  fuel_base1  numeric,
  fuel_cards  numeric,
  fuel_base2  numeric,
  fuel_total  numeric,
  burn_real   numeric,
  burn_computer numeric,
  diff_l100   numeric,
  diff_liters numeric,
  badge       text,
  created_at  timestamptz default now()
);

create index if not exists fuel_trips_user on fuel_trips(user_id, created_at desc);

-- 3. Row Level Security – wyłącz na start (włącz gdy dodasz auth)
alter table quotes    enable row level security;
alter table fuel_trips enable row level security;

-- Polityki tymczasowe – pełny dostęp (zastąp gdy dodasz logowanie)
create policy "allow all quotes"     on quotes     for all using (true) with check (true);
create policy "allow all fuel_trips" on fuel_trips for all using (true) with check (true);
