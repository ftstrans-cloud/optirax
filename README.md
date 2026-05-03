# OPTIRAX – Kalkulator kosztów tras

> Smart Routes. Better Business.

Profesjonalny kalkulator kosztów tras dla spedytorów z integracją HERE Routing API, giełdą Trans.eu i zarządzaniem flotą.

## Funkcje

- 🗺 **Routing HERE API v8** – realne myto per kraj, profil pojazdu (TIR/Bus/Van)
- 🚛 **3 alternatywne trasy** z porównaniem kosztów i myto
- 📋 **Parser AI** – wklejasz tekst zlecenia, AI wyciąga adresy
- 📌 **Parser Google Maps** – wklej link, trasa wchodzi automatycznie
- ⛽ **Tracker spalania** – weryfikacja vs komputer pokładowy
- 🚛 **Zarządzanie flotą** – pojazdy, naczepy, kierowcy
- 📊 **Historia wycen** – sync online przez Supabase
- 📄 **PDF oferty** dla klienta
- 🔒 **Multi-user** – rejestracja, logowanie, 14-dniowy trial

---

## Deployment na Railway

### 1. Fork repozytorium na GitHub

### 2. Utwórz projekt na Supabase
1. Wejdź na [supabase.com](https://supabase.com) → New project
2. SQL Editor → uruchom `supabase_setup.sql`
3. SQL Editor → uruchom `supabase_fleet.sql`  
4. SQL Editor → uruchom `supabase_auth.sql`
5. Settings → API → skopiuj **Project URL** i **anon public key**

### 3. Klucze API
- **HERE API** – [platform.here.com](https://developer.here.com) → Base Plan (darmowy do 30k req/mies)
- **OpenAI** – [platform.openai.com](https://platform.openai.com) → API Keys
- **Supabase** – z kroku 2

### 4. Deploy na Railway
1. Wejdź na [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Wybierz to repozytorium
3. Settings → Variables → dodaj zmienne środowiskowe:

```
OPENAI_API_KEY=sk-proj-...
HERE_API_KEY=...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
PORT=3001
```

4. Deploy – Railway automatycznie wykryje Node.js i uruchomi serwer

### 5. Utwórz konto admina
1. Wejdź na `https://twoja-domena.railway.app/login`
2. Zarejestruj się swoim emailem
3. W Supabase SQL Editor uruchom:
```sql
UPDATE profiles SET is_admin = true WHERE email = 'twoj@email.com';
```
4. Panel admina: `https://twoja-domena.railway.app/admin`

---

## Lokalne uruchomienie (Windows)

```bash
# 1. Zainstaluj zależności
npm install

# 2. Utwórz plik .env (skopiuj z .env.example i uzupełnij klucze)

# 3. Uruchom
node server.js
# lub kliknij START.bat
```

Aplikacja: http://localhost:3001

---

## Zmienne środowiskowe

| Zmienna | Opis | Wymagane |
|---------|------|----------|
| `OPENAI_API_KEY` | Klucz OpenAI (GPT-4o-mini) | Tak |
| `HERE_API_KEY` | Klucz HERE Routing API v8 | Tak |
| `SUPABASE_URL` | URL projektu Supabase | Tak |
| `SUPABASE_ANON_KEY` | Klucz anon Supabase | Tak |
| `PORT` | Port serwera (domyślnie 3001) | Nie |

---

## Stack techniczny

- **Backend**: Node.js + Express
- **Routing**: HERE Routing API v8 (truck profile)
- **Geocoding**: Nominatim (OpenStreetMap)
- **AI**: OpenAI GPT-4o-mini
- **Baza danych**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth (JWT)
- **Mapy**: Leaflet.js + HERE Map Tiles
- **Frontend**: Vanilla JS (bez frameworka)

---

## Licencja

Własnościowa. Wszelkie prawa zastrzeżone.  
Kontakt: kalkulator.transportowy@gmail.com
