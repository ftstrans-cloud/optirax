# OPTIRAX – Kontekst projektu i historia rozwoju

## Stack techniczny
- **Backend:** Node.js + Express (`server.js`), ES modules (`"type": "module"`)
- **Routing:** HERE Routing API v8 (klucz w `.env` jako `HERE_API_KEY`)
- **Geocoding:** Nominatim (OpenStreetMap, darmowy, bez klucza)
- **AI:** OpenAI GPT-4o-mini (klucz w `.env` jako `OPENAI_API_KEY`)
- **Baza danych:** Supabase PostgreSQL (klucze w `.env`, gotowe ale niepodłączone)
- **Frontend:** Vanilla JS + Leaflet.js (mapa), bez frameworka

## Pliki projektu
```
fixed_project/
├── server.js              ← główny serwer Express + HERE API + Supabase endpoints
├── .env                   ← klucze API (HERE, OpenAI, Supabase)
├── supabase_setup.sql     ← SQL do uruchomienia w Supabase (tabele + polityki)
├── START.bat              ← uruchamia serwer + otwiera przeglądarkę
├── package.json           ← zależności (cors, dotenv, express, openai)
└── public/
    ├── index.html         ← główny UI + CSS + fuel tracker modal + tema dark/light
    ├── app.js             ← logika główna: getRoute, historia wycen, alternatywy
    ├── route.js           ← Leaflet mapa, style mapy HERE, winiety, PDF
    ├── calculator.js      ← kalkulacje kosztów, applyVignetteOverrides, applyAutoFields
    ├── autocomplete.js    ← autocomplete adresów + parser Google Maps + parser AI (NLP)
    └── ai.js              ← raport AI (GPT)
```

## Zmienne środowiskowe (.env)
```env
OPENAI_API_KEY=sk-proj-...
PORT=3001
TOLLS_MODE=fast
HERE_API_KEY=FVzdlERJ5P7AxHWBP9_zSTUwNq4itN-qkHrzHCgvBm8

# Supabase – gotowe na podłączenie
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

## Architektura HERE Routing

### Endpointy serwera
- `POST /api/route` – trasa A→B z 3 alternatywami (truck profile)
- `POST /api/route/multi` – trasa wielopunktowa (bez alternatyw)
- `POST /api/report` – raport AI (GPT-4o-mini)
- `POST /api/parse-stops` – NLP parser adresów z tekstu
- `GET /api/config` – klucz HERE do tile'ów mapy (dla frontendu)
- `GET /api/health` – status serwera

### Endpointy Supabase (gotowe, czekają na klucze)
- `GET/POST/DELETE /api/history` – historia wycen
- `GET/POST/DELETE /api/fuel` – tracker spalania
- `GET/POST/DELETE /api/fuel/:id`

### Logika myto HERE
```
parseHereRoute()
  ├── sections[].tolls[].fares → wybierz NAJTAŃSZY fare per toll
  ├── Deduplikacja koncesyjnych autostrad (A2 Wlkp, A4 Stalexport) – seenTollSystems
  ├── SKIP_COUNTRIES = ["NLD"] – Holandia wykluczona (winieta dzienna 12€)
  ├── NLD dodawane z geometrii ray-casting (km) do by_country z cost_eur=0
  └── Fallback offline gdy HERE nie zwraca toll sections (multi-point)
```

### Profile pojazdów (presety)
| Preset | transportMode | Masa | Osie |
|--------|--------------|------|------|
| TIR 40t | truck | 40 000 kg | 5 |
| TIR 24t | truck | 24 000 kg | 4 |
| Bus | bus | 18 000 kg | 3 |
| Van | truck | 3 500 kg | 2 |
| Ciągnik solo | truck | 18 000 kg | 3 |

Zmiana presetu → automatyczny `getRoute()` jeśli trasa już pobrana.

## Style mapy (HERE Map Tile API v3)
```js
// URL format:
https://maps.hereapi.com/v3/background/mc/{z}/{x}/{y}/png?style=explore.day&apiKey=...
```
| Przycisk | Style HERE | Fallback |
|---------|-----------|---------|
| Drogowa | explore.day | OSM |
| Noc | explore.night | Esri Dark Gray |
| Satelita | satellite.day | Esri Imagery |
| Sat+Noc | satellite.explore.night | Esri Dark Gray |
| OSM | — | OpenStreetMap |

Klucz pobierany przez `fetch("/api/config")` przy init mapy.
Auto-switch przy zmianie motywu dark/light (tylko jeśli nie wybrano satelity).

## Winiety
Liczone w `calcDailyVignettesFromGeo()` w `route.js`:
- **NL:** 12€/dzień, km z geometrii ray-casting (bo wykluczone z HERE)
- **GB:** 10 GBP/dzień (HGV Levy), km z `nonEuKmEst` (totalKm - euKm)
- Domyślne 550 km/dzień gdy brak danych, BEZ cap do driver_days

`applyVignetteOverrides()` w `calculator.js`:
- Usuwa z by_country wpisy `source: "OSRM+offline"` dla NL/GB
- Zachowuje wpisy `source: "HERE"` (tunel, realne myto)

## Parser Google Maps (autocomplete.js)
Obsługuje 6 formatów URL:
1. `/maps/dir/Miasto/Miasto` (główny)
2. `?saddr=...&daddr=...` ze `+to:` dla punktów pośrednich
3. `?q=Miasto`
4. `/maps/place/Nazwa/@lat,lon`
5. `@lat,lon` (same koordynaty)
6. `lat, lon` (wklejone czyste koordynaty)

## Parser AI (autocomplete.js + server.js)
```
POST /api/parse-stops { text: "59114 Steenvoorde, France\n8520 Kuurne, Belgium\n21-400 Łuków, PL" }
→ GPT-4o-mini wyciąga { origin, stops[], destination }
→ setRouteToUI() wypełnia pola trasy
```
Działa bez etykiet (załadunek/rozładunek) – same adresy w kolejności.

## Tracker spalania (⛽ w actionBar)
Modal wysuwany od dołu. Trzy zakładki: Nowy przejazd / Historia / Statystyki.

### Wzór
```
km = drogomierz_powrót - drogomierz_wyjazd
paliwo_razem = baza_wyjazd + karty_paliwowe + baza_powrót
spalanie_rzeczywiste = (paliwo_razem / km) * 100
różnica_l100 = spalanie_rzeczywiste - komputer_pokładowy
różnica_litry = (różnica_l100 / 100) * km
```

### Margines
- ±0.5 l/100 → zielony (OK)
- ±2.0 l/100 → żółty (uwaga)
- >2.0 l/100 → czerwony (wymaga wyjaśnienia)

### Storage
localStorage `optirax_fuel_v1` (fallback) + Supabase `fuel_trips` (gdy podłączone).

## Supabase – plan wdrożenia
1. Utwórz projekt na supabase.com (darmowy, 500MB)
2. SQL Editor → uruchom `supabase_setup.sql`
3. Settings → API → skopiuj URL i anon key do `.env`
4. Restart serwera

### Tabele
- `quotes` – historia wycen (id, user_id, trasa, koszty, tolls_geo, calc, input)
- `fuel_trips` – tracker spalania (id, user_id, reg, km, paliwa, spalanie, diff)

### Multi-user (przyszłość)
Aktualnie `user_id = "default"` dla wszystkich.
Gdy dodamy auth: podmienić na `req.user.id` z Supabase Auth (JWT).
RLS polityki są już włączone, wystarczy zaktualizować `using (auth.uid()::text = user_id)`.

## Trans.eu integracja — plan (DO ZREALIZOWANIA)

### Model: C (hybrid)
- Jedno konto Trans.eu firmy → wyszukiwanie frachtu (wspólne dla wszystkich userów)
- Userzy nie muszą mieć konta Trans.eu
- Kliknięcie oferty → otwiera platform.trans.eu (negocjacja tam)
- Opcja podpięcia własnego konta Trans.eu per user — w przyszłości

### Status
- [ ] Rejestracja aplikacji na platform.trans.eu (Settings → Aplikacje API)
- [ ] Rejestracja integracji na trans.eu/api (formularz)
- [ ] Wpisanie client_id + client_secret do .env
- [ ] Implementacja kodu

### Do wpisania w .env po rejestracji
```env
TRANSEU_CLIENT_ID=
TRANSEU_CLIENT_SECRET=
```

### Planowane endpointy
- `GET /api/transeu/search?lat=...&lon=...&radius=50` — fracht w korytarzu trasy
- Token cache (OAuth2 client_credentials, token ważny 1h)

### Planowany UI
- Przycisk "Szukaj doładunków" po pobraniu trasy
- Panel boczny: trasa, ładunek, cena, firma, rating Trans.eu
- Przycisk "Otwórz w Trans.eu" → link do platform.trans.eu
- Filtrowanie: odległość od trasy, typ naczepy, tonaż
- Weryfikacja ceny: Twoja wycena vs średnia rynkowa Trans.eu

### Weryfikacja ceny rynkowej
- Po obliczeniu wyceny pokaż czy cena jest powyżej/poniżej średniej rynkowej Trans.eu


## Znane ograniczenia / TODO
- HERE v8 free tier nie zwraca km per kraj (używamy ray-casting geometrii)
- NL winieta obowiązuje do lipca 2025 – po tej dacie usunąć z SKIP_COUNTRIES
- Trasa multi-point nie ma alternatyw (ograniczenie HERE API)
- Flexible polyline decoder napisany własnoręcznie (testowany na przykładach HERE docs)
- A2 Autostrada Wielkopolska deduplikowana po nazwie systemu – może nie działać dla A4 Stalexport jeśli HERE zmieni nazewnictwo

## Uruchamianie
```bash
# Zainstaluj zależności (raz)
npm install

# Uruchom serwer
node server.js

# Lub przez START.bat (Windows) – otwiera też przeglądarkę
```

Serwer: http://localhost:3001
Health check: http://localhost:3001/api/health
