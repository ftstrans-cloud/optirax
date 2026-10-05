-- ============================================================
-- OPTIRAX - migracja: kolumna is_draft + indeks dla autosave
-- Wklej w Supabase -> SQL Editor -> Run
-- ============================================================

-- 1. Dodaj kolumnę is_draft (domyślnie false dla istniejących wpisów)
alter table quotes
  add column if not exists is_draft boolean not null default false;

-- 2. Indeks pod szybkie wyszukiwanie draftu po trasie i userze
--    Używany w autosave do upsert + przy promote draft->stały
create index if not exists quotes_autosave_lookup
  on quotes (auth_user_id, origin, destination, is_draft)
  where is_draft = true;

-- 3. Indeks pod listing historii (jak nie ma jeszcze)
create index if not exists quotes_user_ts_active
  on quotes (auth_user_id, ts desc)
  where is_draft = false;
