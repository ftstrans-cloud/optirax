-- ============================================================
-- TRIAL USERS — segmentacja do kampanii konwersyjnej
-- ============================================================

-- A) Trial WYGASŁ (do 30 dni temu) — najgorętszy cel
SELECT
  email,
  full_name,
  COALESCE(company, 'brak firmy')    AS firma,
  trial_ends_at::date                AS koniec_trialu,
  (now() - trial_ends_at)::interval  AS ile_temu,
  (SELECT count(*) FROM quotes q WHERE q.company_id = p.company_id) AS wycen,
  (SELECT count(*) FROM vehicles v WHERE v.company_id = p.company_id) AS pojazdow
FROM profiles p
WHERE plan = 'trial'
  AND trial_ends_at < now()
  AND trial_ends_at > now() - interval '30 days'
  AND is_active = true
ORDER BY trial_ends_at DESC;

-- B) Trial wygasa za 1-7 dni — prewencja churnu
SELECT
  email,
  full_name,
  COALESCE(company, 'brak firmy')    AS firma,
  trial_ends_at::date                AS koniec_trialu,
  ceil(extract(epoch from (trial_ends_at - now()))/86400)::int AS dni_zostalo,
  (SELECT count(*) FROM quotes q WHERE q.company_id = p.company_id) AS wycen
FROM profiles p
WHERE plan = 'trial'
  AND trial_ends_at BETWEEN now() AND now() + interval '7 days'
  AND is_active = true
ORDER BY trial_ends_at ASC;

-- C) Trial wygasa za 8-14 dni — early warning
SELECT
  email,
  full_name,
  trial_ends_at::date                AS koniec_trialu,
  ceil(extract(epoch from (trial_ends_at - now()))/86400)::int AS dni_zostalo,
  (SELECT count(*) FROM quotes q WHERE q.company_id = p.company_id) AS wycen
FROM profiles p
WHERE plan = 'trial'
  AND trial_ends_at BETWEEN now() + interval '8 days' AND now() + interval '14 days'
  AND is_active = true
ORDER BY trial_ends_at ASC;
