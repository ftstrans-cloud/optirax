/* =========================
   MAPA + TRASA
========================= */
let map = null;
let routeLine = null;
let routeMarkers = [];

function setRouteToUI(route){
  if (!route) return;
  initRouteBuilder(); // zbuduje Skąd/Dokąd
  const list = document.getElementById("routeList");
  if (!list) return;

  // ustaw Skąd i Dokąd
  const wrappers = Array.from(list.children);
  const firstInput = wrappers[0]?.querySelector("input");
  const lastInput = wrappers[wrappers.length - 1]?.querySelector("input");
  if (firstInput) firstInput.value = route.origin || "";
  if (lastInput) lastInput.value = route.destination || "";

  // wstaw stop-y
  const stops = Array.isArray(route.stops) ? route.stops : [];
  stops.forEach(s => {
    addRoutePoint();
    const w = Array.from(list.children).slice(1, -1).pop(); // ostatni stop
    const inp = w?.querySelector("input");
    if (inp) inp.value = s;
  });

  // odśwież podpisy/przyciski
  updateRouteButtons();
}

let autoSaveTimer = null;

const APP_CONFIG = {
  company: "Optirax",
  contact: "tel. +48 797 997 422 • email: ___@___.pl",
  nip: "NIP: KPRM Warszawa",
  // jeśli chcesz logo: wstaw URL do PNG/SVG (albo data:image/...):
  logoUrl: "assets/traseo_logo.jpg", // np. "https://twojadomena.pl/logo.png"
};

function money(x){
  return (x == null || Number.isNaN(Number(x)))
    ? "—"
    : (Number(x).toFixed(2) + " €");
}

function autoSaveAfterRun(){
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    try { autoSaveNow(); } catch (e) { console.warn("autoSaveNow failed", e); }
  }, 400); // 0.4s po ostatnim run
}

function autoSaveNow(){
  const calc = window.lastCalc;
  const input = window.lastInput;
  if (!calc || !input) return;

  const r = window.lastRoutePayload || {};
  const tolls_geo = window.lastRouteTollsGeo || null;
  const tolls_geo_adj = window.lastRouteTollsGeoAdj || null;
  const vignettes = window.lastRouteVignettes || null;

  // autoSave tylko lokalnie (sync) — pełny zapis do Supabase przez "Zapisz"
  let items = [];
  try { items = JSON.parse(localStorage.getItem("ak_history_v1") || "[]"); } catch {}

  const idx = items.findIndex(x => x.id === HISTORY_AUTO_ID);
  const autoItem = {
    id: HISTORY_AUTO_ID,
    ts: Date.now(),
    name: "AUTO – ostatnia kalkulacja",
    client: "",
    note: "",

    route: {
      origin: r.origin || "",
      destination: r.destination || "",
      stops: Array.isArray(r.stops) ? r.stops : [],
      points_resolved: r.points_resolved || null,
    },

    input,
    result: calc,
    tolls_geo,
    tolls_geo_adj,
    vignettes,
  };

  if (idx >= 0) items[idx] = autoItem;
  else items.unshift(autoItem);

  hSave(items.slice(0, 60));
  renderHistory();
}

// Normalizuje nazwę kraju → kod 2-literowy
// Obsługuje nazwy HERE (angielski) i OSRM (polski) jednocześnie
function normC(countryName){
  const c = String(countryName || "").toLowerCase().trim();

  // Holandia / Netherlands / NLD / NL
  if (
    c === "nl" || c === "nld" ||
    c.includes("netherlands") || c.includes("nederland") ||
    c.includes("holandia") || c.includes("niderland")
  ) return "NL";

  // Wielka Brytania / United Kingdom / GBR / GB
  if (
    c === "gb" || c === "gbr" || c === "uk" ||
    c.includes("united kingdom") || c.includes("great britain") ||
    c.includes("wielka brytania") || c.includes("england") ||
    c.includes("scotland") || c.includes("wales")
  ) return "GB";

  return "";
}

function applyVignettesToTollsGeo(tg, driverDays, kmTotal, gbpEur){
  if (!tg?.by_country?.length) return { tg, vignetteRows: [], vignetteTotal: 0 };

  const by = tg.by_country.map(x => ({
    ...x, // ✅ było ".x" (to psuło JS)
    _key: normC(x.country),
    km: Number(x.km || 0),
    rate_eur_per_km: Number(x.rate_eur_per_km || 0),
    cost_eur: Number(x.cost_eur || 0),
  }));

  // ✅ proporcjonalnie do km, zaokrąglaj w górę
  const daysFor = (km) => {
    if (!kmTotal || kmTotal <= 0) return 0;
    const raw = (Number(driverDays || 0) * (km / kmTotal));
    return km > 0 ? Math.max(1, Math.ceil(raw)) : 0; // ✅ ceil zamiast round
  };

  let vignetteTotal = 0;
  const vignetteRows = [];

  // NL
  const nl = by.find(x => x._key === "NL");
  if (nl && nl.km > 0) {
    const days = daysFor(nl.km);
    const cost = days * 12; // EUR/dzień
    vignetteTotal += cost;
    vignetteRows.push({ country: "NL (winieta dzienna)", days, cost_eur: +cost.toFixed(2) });

    // WYŁĄCZ €/km dla NL
    nl.rate_eur_per_km = 0;
    nl.cost_eur = 0;
  }

  // GB (jeśli w ogóle wystąpi w tg.by_country — zwykle nie, bo UE geo nie obejmuje GB)
  const gb = by.find(x => x._key === "GB");
  if (gb && gb.km > 0) {
    const days = daysFor(gb.km);
    const cost = days * 10 * Number(gbpEur || 1.15); // 10 GBP/dzień -> EUR
    vignetteTotal += cost;
    vignetteRows.push({ country: "GB (winieta dzienna)", days, cost_eur: +cost.toFixed(2) });

    // WYŁĄCZ €/km dla GB
    gb.rate_eur_per_km = 0;
    gb.cost_eur = 0;
  }

  const rest = by.reduce((sum, x) => sum + (Number(x.cost_eur) || 0), 0);
  const newTotal = +(rest + vignetteTotal).toFixed(2);

  const newTg = {
    ...tg, // ✅ było ".tg"
    total_eur: newTotal,
    by_country: by.map(x => ({
      country: x.country,
      km: +x.km.toFixed(1),
      rate_eur_per_km: x.rate_eur_per_km,
      cost_eur: +x.cost_eur.toFixed(2),
    }))
  };

  return { tg: newTg, vignetteRows, vignetteTotal: +vignetteTotal.toFixed(2) };
}

function hasGBInRoutePayload() {
  const r = window.lastRoutePayload || {};
  const txt = [
    r.origin_resolved, r.destination_resolved,
    ...(r.points_resolved || [])
  ].filter(Boolean).join(" | ").toLowerCase();

  // Nominatim zwykle daje "United Kingdom"
  return txt.includes("united kingdom") || txt.includes("wielka brytania") || txt.includes("uk");
}

function calcDailyVignettesFromGeo(tg, driverDays, gbpEur, routeText = "", totalRouteKm = 0, kmPerDayUi = 0) {
  const rows = [];

  const by = Array.isArray(tg?.by_country) ? tg.by_country : [];
  const euKm = by.reduce((s, x) => s + (Number(x.km) || 0), 0);

  const routeKm = Math.max(0, Number(totalRouteKm || 0));
  const rt = String(routeText || "").toLowerCase();

  const gbInText =
    rt.includes("united kingdom") || rt.includes("wielka brytania") ||
    rt.includes("zjednoczone królestwo") || rt.includes("england") ||
    rt.includes("great britain") || rt.includes("scotland") || rt.includes("wales") ||
    rt.includes(" gb") || rt.includes(" uk");

  const nlInText =
    rt.includes("netherlands") || rt.includes("holandia") || rt.includes("nederland") ||
    rt.includes("amsterdam") || rt.includes("rotterdam") || rt.includes("utrecht") ||
    rt.includes("niderl");

  const nonEuKmEst = (routeKm > 0 && euKm > 0) ? Math.max(0, routeKm - euKm) : 0;
  const totalKmForDays = (euKm + (gbInText ? nonEuKmEst : 0)) || euKm || routeKm || 0;

  const daysTotal = Math.max(0, Number(driverDays || 0));
  // km/dzień – z UI, albo z trasy/dni, albo domyślnie 550
  const kmPerDay = (Number(kmPerDayUi) > 0)
    ? Number(kmPerDayUi)
    : (daysTotal > 0 && totalKmForDays > 0 ? (totalKmForDays / daysTotal) : 550);

  const daysForKm = (kmInCountry) => {
    if (!kmInCountry || kmInCountry <= 0 || !kmPerDay || kmPerDay <= 0) return 0;
    return Math.max(1, Math.ceil(kmInCountry / kmPerDay));
  };

  const NL_EUR_PER_DAY = 12;
  const GB_GBP_PER_DAY = 10;
  const kGbpEur = (Number(gbpEur) > 0) ? Number(gbpEur) : 1.17;

  let kmNL = 0, kmGB = 0;

  for (const x of by) {
    const code = normC(x.country);
    const km = Number(x.km) || 0;
    if (!km) continue;
    if (code === "NL") kmNL += km;
    if (code === "GB") kmGB += km;
  }

  // NL: jeśli nie ma w by_country (wykluczone z HERE), estymuj z geometrii offline
  // Używamy stałej ~200km dla trasy przez NL (Rotterdam-granica DE ~150km, Amsterdam ~200km)
  // Lepsza estymacja: szukaj "Holandia" w offline geo jeśli dostępne
  const nlOfflineKm = (() => {
    const offlineNL = (window._lastOfflineTolls?.by_country || []).find(x => normC(x.country) === "NL");
    return offlineNL?.km || 0;
  })();
  const kmNLFinal = (kmNL > 0) ? kmNL : (nlInText ? (nlOfflineKm || 200) : 0);

  // GB km: z HERE jeśli dostępne, inaczej estymacja (totalKm - euKm)
  const kmGBFinal = (kmGB > 0) ? kmGB : (gbInText ? nonEuKmEst : 0);

  const daysNL = kmNLFinal > 0 ? daysForKm(kmNLFinal) : 0;
  const daysGB = kmGBFinal > 0 ? daysForKm(kmGBFinal) : 0;

  // BEZ cappowania do driverDays – winieta zależy od km w kraju, nie od łącznych dni

  if (daysNL > 0) {
    const costEur = daysNL * NL_EUR_PER_DAY;
    rows.push({ country: "NL (winieta)", unit: "dzień", qty: daysNL, rate: NL_EUR_PER_DAY, rate_ccy: "EUR", cost_eur: +costEur.toFixed(2) });
  }
  if (daysGB > 0) {
    const costEur = daysGB * GB_GBP_PER_DAY * kGbpEur;
    rows.push({ country: "GB (winieta)", unit: "dzień", qty: daysGB, rate: GB_GBP_PER_DAY, rate_ccy: "GBP", cost_eur: +costEur.toFixed(2) });
  }

  const total = rows.reduce((s, r) => s + (Number(r.cost_eur) || 0), 0);
  return { rows, total_eur: +total.toFixed(2) };
}
function openPdfReport(){

  // lokalne helpery (żeby PDF nie znikał przez scope/redeclaration)
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  const moneyPdf = (x) =>
    (x == null || Number.isNaN(Number(x))) ? "—" : (Number(x).toFixed(2) + " €");

  const num1 = (x) =>
    (x == null || Number.isNaN(Number(x))) ? "—" : String(Number(x).toFixed(1));

  const num2 = (x) =>
    (x == null || Number.isNaN(Number(x))) ? "—" : String(Number(x).toFixed(2));

  const calc = window.lastCalc;
  const input = window.lastInput;
  if (!calc || !input) { alert("Najpierw policz trasę."); return; }

  const r = window.lastRoutePayload || {};
  const tgBase = window.lastRouteTollsGeo || null;

  // ✅ bierz wersję po override (bez NL/GB per-km), jeśli istnieje
  const tg = window.lastRouteTollsGeoAdj || tgBase;

  // winiety już policzone wcześniej w app.js
  const daily = window.lastRouteVignettes || { rows: [], total_eur: 0 };

  const isOffer = (calc.calc_mode === "offer" && Number(calc.offer_price_eur) > 0);
  const price = isOffer ? Number(calc.offer_price_eur) : Number(calc.suggested_price_eur);

  // Dane klienta: preferuj ostatnio zapisany rekord historii, potem pola modala
  let clientName = "";
  let offerName = "";
  let note = "";

  try {
    const items = (typeof hLoad === "function") ? hLoad() : [];
    const lastId = window.lastHistoryId;
    const it = lastId ? items.find(x => x.id === lastId) : null;

    offerName = (it?.name || document.getElementById("h_name")?.value || "").trim();
    clientName = (it?.client || document.getElementById("h_client")?.value || "").trim();
    note = (it?.note || document.getElementById("h_note")?.value || "").trim();
  } catch {}

  const now = new Date();
  const paymentTerms = (document.getElementById("payment_terms")?.value || "—").trim();
  const nowStr = now.toLocaleString();

  // Numer oferty: YYYYMMDD-HHMM-XXXX
  const pad2 = (n) => String(n).padStart(2,"0");
  const y = now.getFullYear();
  const m = pad2(now.getMonth()+1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  const rand = Math.random().toString(16).slice(2,6).toUpperCase();
  const offerNo = `${y}${m}${d}-${hh}${mm}-${rand}`;

  const title = "Oferta transportowa";

  const routeLine =
    (r.origin || "") + " → " + (r.destination || "") +
    (Array.isArray(r.stops) && r.stops.length ? (" (punkty: " + r.stops.length + ")") : "");

  const kmTotal = Number(calc.distance_km || 0);
  const totalCost = Number(calc.total_cost_eur || 0);
  const costPerKm = (kmTotal > 0) ? (totalCost / kmTotal) : 0;
  const pricePerKm = (kmTotal > 0 && price > 0) ? (price / kmTotal) : 0;

  const marginPct = (calc.margin_pct != null && !Number.isNaN(Number(calc.margin_pct)))
    ? (Number(calc.margin_pct).toFixed(1) + "%")
    : "—";

  const reportAi = (document.getElementById("aiReport")?.textContent || "").trim();

  // --- tabela myta UE (per km) ---
  let tollRows = "";
  if (tg && Array.isArray(tg.by_country) && tg.by_country.length) {
    tollRows = tg.by_country.map(x => (
      "<tr>" +
        "<td>" + esc(x.country ?? "—") + "</td>" +
        "<td style='text-align:right;'>" + esc(num1(x.km)) + "</td>" +
        "<td style='text-align:right;'>" + esc(String(x.rate_eur_per_km ?? "—")) + "</td>" +
        "<td style='text-align:right;'>" + esc(String(x.cost_eur ?? "—")) + "</td>" +
      "</tr>"
    )).join("");
  } else {
    tollRows = "<tr><td colspan='4' style='opacity:.7;'>Brak danych myta UE (tolls_geo).</td></tr>";
  }

  // --- dopisz winiety jako wiersze w tej samej tabeli ---
  let vignetteRows = "";
  if (daily?.rows?.length) {
    vignetteRows = daily.rows.map(x => (
      "<tr>" +
        "<td>" + esc(String(x.country ?? "—")) + "</td>" +
        "<td style='text-align:right;'>" + esc(String(x.qty ?? "—")) + "</td>" +
        "<td style='text-align:right;'>" + esc(String(x.rate ?? "—")) + " " + esc(String(x.rate_ccy ?? "")) + "/" + esc(String(x.unit ?? "")) + "</td>" +
        "<td style='text-align:right;'>" + esc(moneyPdf(x.cost_eur)) + "</td>" +
      "</tr>"
    )).join("");
  }

  const aiBlock = reportAi
    ? ("<div class='card'><div class='h'>Raport AI</div><pre class='ai'>" + esc(reportAi) + "</pre></div>")
    : ("<div class='card'><div class='h'>Raport AI</div><div class='muted'>Brak (opcjonalnie)</div></div>");

  const watermarkHtml = (window.APP_CONFIG?.logoUrl)
    ? ("<div class='wm'><img class='wmImg' src='" + esc(window.APP_CONFIG.logoUrl) + "' alt='logo' /></div>")
    : ("");

  const html =
"<!doctype html><html><head>" +
"<meta charset='utf-8' />" +
"<meta name='viewport' content='width=device-width, initial-scale=1' />" +
"<title>" + esc(title) + " " + esc(offerNo) + "</title>" +
"<style>" +
"  :root{ --bg:#ffffff; --card:#ffffff; --ink:#0b1220; --mut:#516173; --line:#c7d2fe; --lineStrong:#6d7cff; --soft:#f6f8fb; }" +
"  html, body{ background:#ffffff !important; color:var(--ink) !important; }" +
"  body{ margin:0; font-family: Arial, sans-serif; background:var(--bg); color:var(--ink); }" +
"  .wm{ position:fixed; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:0; }" +
"  .wmImg{ width:90%; max-width:1200px; opacity:0.08; }" +
"  .page{ position:relative; z-index:1; padding:24px; }" +
"  .printbar{ position: sticky; top:0; background:var(--bg); padding:10px 0; }" +
"  .printbtn{ border:1px solid var(--line); background:var(--soft); padding:8px 10px; border-radius:12px; cursor:pointer; font-weight:700; }" +
"  .top{ display:flex; justify-content:space-between; gap:14px; align-items:flex-start; }" +
"  .brand{ font-weight:900; font-size:18px; }" +
"  .muted{ color:var(--mut); font-size:12px; }" +
"  .tag{ display:inline-block; padding:4px 10px; border:1px solid var(--line); border-radius:999px; font-size:12px; background:#fff; }" +
"  .card{ border:2px solid var(--lineStrong); border-radius:16px; padding:12px; margin-top:12px; background:var(--card); }" +
"  .h{ font-weight:900; margin-bottom:8px; }" +
"  .grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:12px; }" +
"  .kpi{ display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-top:12px; }" +
"  .k{ border:2px solid var(--line); border-radius:16px; padding:10px; background:var(--soft); }" +
"  .k .t{ font-size:11px; color:var(--mut); }" +
"  .k .v{ font-size:16px; font-weight:900; margin-top:4px; }" +
"  table{ width:100%; border-collapse:collapse; }" +
"  th,td{ border-bottom:1px solid var(--line); padding:8px 6px; font-size:12px; }" +
"  th{ text-align:left; background:var(--soft); border-bottom:2px solid var(--lineStrong); }" +
"  .ai{ white-space: pre-wrap; margin:0; font-size:12px; background:var(--soft); border:1px solid var(--line); padding:10px; border-radius:12px; }" +
"  .sigGrid{ display:grid; grid-template-columns: 1fr 1fr; gap:16px; }" +
"  .sig{ border-top:1px solid var(--line); padding-top:8px; font-size:12px; color:var(--mut); }" +
"  @media print{ .printbar{ display:none; } .page{ padding: 14mm; } }" +
"</style></head><body>" +
watermarkHtml +
"<div class='page'>" +

"<div class='printbar'><button class='printbtn' onclick='window.print()'>Drukuj / Zapisz jako PDF</button></div>" +

"<div class='top'>" +
"  <div>" +
"    <div class='brand'>" + esc(window.APP_CONFIG?.company || "Twoja firma") + "</div>" +
"    <div class='muted'>" + esc(window.APP_CONFIG?.contact || "") + "</div>" +
"    <div class='muted'>" + esc(window.APP_CONFIG?.nip || "") + "</div>" +
"  </div>" +
"  <div style='text-align:right;'>" +
"    <div class='tag'>" + esc(title) + "</div><br/>" +
"    <div class='muted' style='margin-top:6px;'><b>Nr oferty:</b> " + esc(offerNo) + "</div>" +
"    <div class='muted' style='margin-top:4px;'>Wygenerowano: " + esc(nowStr) + "</div>" +
"  </div>" +
"</div>" +

"<div class='card'>" +
"  <div class='h'>Dane oferty</div>" +
"  <div class='grid2'>" +
"    <div>" +
"      <div><b>Relacja:</b> " + esc(routeLine) + "</div>" +
"      <div class='muted' style='margin-top:4px;'><b>Dystans:</b> " + esc(num1(calc.distance_km)) + " km</div>" +
"      <div class='muted' style='margin-top:4px;'><b>Tryb:</b> " + (isOffer ? "Marża ze zlecenia" : "Wycena trasy") + "</div>" +
"      <div class='muted' style='margin-top:4px;'><b>Termin płatności:</b> " + esc(paymentTerms) + "</div>" +
"    </div>" +
"    <div>" +
"      <div><b>Nazwa wyceny:</b> " + esc(offerName || "—") + "</div>" +
"      <div class='muted' style='margin-top:4px;'><b>Klient:</b> " + esc(clientName || "—") + "</div>" +
"      <div class='muted' style='margin-top:4px;'><b>Notatka:</b> " + esc(note || "—") + "</div>" +
"    </div>" +
"  </div>" +
"</div>" +

"<div class='kpi'>" +
"  <div class='k'><div class='t'>Koszt całkowity</div><div class='v'>" + esc(moneyPdf(calc.total_cost_eur)) + "</div><div class='muted'>Koszt/km: " + esc(num2(costPerKm)) + " €/km</div></div>" +
"  <div class='k'><div class='t'>" + (isOffer ? "Cena zlecenia" : "Cena sugerowana") + "</div><div class='v'>" + esc(moneyPdf(price)) + "</div><div class='muted'>Cena/km: " + esc(num2(pricePerKm)) + " €/km</div></div>" +
"  <div class='k'><div class='t'>Marża</div><div class='v'>" + esc(moneyPdf(calc.margin_eur)) + " <span class='muted'>(" + esc(marginPct) + ")</span></div></div>" +
"</div>" +

"<div class='grid2'>" +
"  <div class='card'>" +
"    <div class='h'>Koszty</div>" +
"    <table>" +
"      <tr><td>Paliwo</td><td style='text-align:right;'>" + esc(moneyPdf(calc.fuel_cost_eur)) + "</td></tr>" +
"      <tr><td>Kierowca</td><td style='text-align:right;'>" + esc(moneyPdf(calc.driver_cost_eur)) + "</td></tr>" +
"      <tr><td>Myto</td><td style='text-align:right;'>" + esc(moneyPdf(calc.tolls_eur)) + "</td></tr>" +
"      <tr><td>Promy</td><td style='text-align:right;'>" + esc(moneyPdf(calc.ferries_eur)) + "</td></tr>" +
"      <tr><td>Winiety dzienne (NL/GB)</td><td style='text-align:right;'>" + esc(moneyPdf(daily.total_eur)) + "</td></tr>" +
"      <tr><td>Inne</td><td style='text-align:right;'>" + esc(moneyPdf(calc.other_costs_eur)) + "</td></tr>" +
"      <tr><td><b>Suma</b></td><td style='text-align:right;'><b>" + esc(moneyPdf(calc.total_cost_eur)) + "</b></td></tr>" +
"    </table>" +
"  </div>" +

"  <div class='card'>" +
"    <div class='h'>Myto UE – podział na kraje</div>" +
"    <table>" +
"      <thead><tr><th>Kraj</th><th style='text-align:right;'>km</th><th style='text-align:right;'>€/km</th><th style='text-align:right;'>€</th></tr></thead>" +
"      <tbody>" + tollRows + vignetteRows + "</tbody>" +
"    </table>" +
"    <div class='muted' style='margin-top:8px;'>Razem (UE offline): " + esc(moneyPdf(tg?.total_eur)) + "</div>" +
"  </div>" +
"</div>" +

aiBlock +

"<div class='card'>" +
"  <div class='h'>Podpis / pieczątka</div>" +
"  <div class='sigGrid' style='margin-top:18px;'>" +
"    <div class='sig'>Podpis osoby przygotowującej ofertę</div>" +
"    <div class='sig'>Podpis / pieczątka klienta</div>" +
"  </div>" +
"</div>" +

"<div class='card'>" +
"  <div class='h'>Warunki / zastrzeżenia</div>" +
"  <div class='muted'>• Dokument poglądowy (v0.1+). Myto UE jest szacowane wg modelu offline; finalne stawki zależą m.in. od klasy pojazdu i taryf.</div>" +
"  <div class='muted'>• Płatność, terminy, ADR, chłodnia, postoje, godziny okien — do potwierdzenia w zleceniu.</div>" +
"</div>" +

"</div></body></html>";

  const w = window.open("", "_blank");
  if (!w) {
    alert("Przeglądarka zablokowała popup. Zezwól na otwieranie okien dla tej strony.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function setCalcMode(mode){
  const hidden = document.getElementById("calc_mode");
  const row = document.getElementById("modeOfferRow");
  const buttons = document.querySelectorAll("#modeSwitch .modeBtn");

  if (hidden) hidden.value = mode;
  buttons.forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  if (row) row.style.display = (mode === "offer") ? "grid" : "none";

  run(); // przelicz po zmianie trybu
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("#modeSwitch .modeBtn");
  if (!btn) return;
  setCalcMode(btn.dataset.mode);
});

document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "offer_price_eur") run();
});

// ============================================================
// STYLE MAPY – HERE Map Tile API v3 + OSM fallback
// ============================================================
const HERE_KEY = window._hereApiKey || "";  // wstrzyknięty przez serwer lub odczytany z meta

// Buduje URL HERE Map Tile v3
function hereTileUrl(style, scheme, apiKey, resource) {
  // resource: 'background' (tło bez label) | 'base' (tło+drogi+label) | 'label' (tylko label)
  // style: 'explore' | 'lite' | 'satellite' | 'logistics'
  // scheme: 'day' | 'night'
  const res = resource || "base";
  return `https://maps.hereapi.com/v3/${res}/mc/{z}/{x}/{y}/png?style=${style}.${scheme}&apiKey=${apiKey}&lang=pl&ppi=100&size=512`;
}

// Mapa stylów do warstw Leaflet
function buildTileLayers(apiKey) {
  const attr_here = '&copy; <a href="https://www.here.com">HERE</a>';
  const attr_osm  = '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>';

  return {
    "here-road-day": apiKey
      ? L.tileLayer(hereTileUrl("explore", "day", apiKey, "base"),    { attribution: attr_here, maxZoom: 20 })
      : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: attr_osm }),

    "here-road-night": apiKey
      ? L.tileLayer(hereTileUrl("explore", "night", apiKey, "base"),  { attribution: attr_here, maxZoom: 20 })
      : L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "&copy; Esri" }),

    "here-satellite": apiKey
      ? L.tileLayer(hereTileUrl("satellite", "day", apiKey, "base"),  { attribution: attr_here, maxZoom: 20 })
      : L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "&copy; Esri" }),

    "here-sat-night": apiKey
      ? L.tileLayer(hereTileUrl("satellite", "night", apiKey, "base"), { attribution: attr_here, maxZoom: 20 })
      : L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "&copy; Esri" }),

    "osm": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: attr_osm, maxZoom: 19 }),
  };
}

let currentTileLayer = null;
let tileLayers = {};

function switchMapStyle(style) {
  if (!map) return;

  // usuń aktywną warstwę
  if (currentTileLayer) {
    try { map.removeLayer(currentTileLayer); } catch {}
  }

  // dodaj nową
  if (tileLayers[style]) {
    tileLayers[style].addTo(map);
    currentTileLayer = tileLayers[style];
  }

  // zaktualizuj przyciski
  document.querySelectorAll(".mapStyleBtn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.style === style);
  });

  // zapisz preferencję
  try { localStorage.setItem("mapStyle", style); } catch {}
}

function initMap() {
  if (map) return;

  // Leaflet – scrollWheelZoom domyślnie true, dragging true
  map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
    dragging: true,
  }).setView([52.23, 21.01], 6);
  window.map = map;

  // Pobierz klucz HERE z serwera, potem zbuduj warstwy
  fetch("/api/config")
    .then(r => r.json())
    .then(cfg => {
      tileLayers = buildTileLayers(cfg.hereApiKey || "");

      // Domyślny styl: z localStorage lub ciemna HERE
      const savedStyle = (() => { try { return localStorage.getItem("mapStyle"); } catch { return null; } })();
      const savedTheme = document.documentElement.getAttribute("data-theme") || "dark";
      const defaultStyle = (savedStyle && tileLayers[savedStyle])
        ? savedStyle
        : (savedTheme === "light" ? "here-road-day" : "here-road-night");

      tileLayers[defaultStyle].addTo(map);
      currentTileLayer = tileLayers[defaultStyle];

      // Podepnij przyciski stylu mapy
      document.querySelectorAll(".mapStyleBtn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.style === defaultStyle);
        btn.addEventListener("click", () => switchMapStyle(btn.dataset.style));
      });

      map.invalidateSize();
    })
    .catch(() => {
      // Fallback OSM gdy serwer nie odpowiada
      const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);
      currentTileLayer = osm;
      tileLayers = { osm };
      document.querySelectorAll(".mapStyleBtn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.style === "osm");
        btn.addEventListener("click", () => switchMapStyle(btn.dataset.style));
      });
    });

  setTimeout(() => { if (map) map.invalidateSize(); }, 100);
}

window.switchMapStyle = switchMapStyle;


function clearRouteOnMap() {
  if (routeLine && map) {
    try { map.removeLayer(routeLine); } catch {}
    routeLine = null;
  }
  clearMarkersOnMap();
}
function makeFlagIcon(type, label) {
  type  = type  || "via";
  label = label || (type === "start" ? "S" : type === "end" ? "E" : ".");
  var cfg = {
    start: { bg:"#22c55e", ring:"#4ade80", shadow:"rgba(34,197,94,.6)"  },
    end:   { bg:"#ef4444", ring:"#f87171", shadow:"rgba(239,68,68,.6)"  },
    via:   { bg:"#6366f1", ring:"#818cf8", shadow:"rgba(99,102,241,.6)" },
  };
  var co  = cfg[type] || cfg.via;
  var uid = "mk" + Math.random().toString(36).slice(2,8);
  var fs  = label.length > 1 ? "7" : "11";

  var html =
    "<style>" +
    "#" + uid + "{position:relative;width:36px;height:46px;cursor:pointer;" +
      "transition:transform .25s cubic-bezier(.34,1.56,.64,1)," +
              "filter .25s ease;" +
      "filter:drop-shadow(0 4px 10px " + co.shadow + ");}" +
    "#" + uid + ":hover{transform:scale(1.45) translateY(-6px);" +
      "filter:drop-shadow(0 8px 16px " + co.shadow + ");}" +
    "#" + uid + " .pulse{position:absolute;bottom:-3px;left:50%;" +
      "width:18px;height:18px;margin-left:-9px;border-radius:50%;" +
      "background:" + co.bg + "44;" +
      "animation:pu" + uid + " 2.2s ease-out infinite;}" +
    "@keyframes pu" + uid + "{" +
      "0%{transform:scale(.7);opacity:.9;}" +
      "70%{transform:scale(2.6);opacity:0;}" +
      "100%{transform:scale(.7);opacity:0;}}" +
    "</style>" +
    "<div id='" + uid + "'>" +
      "<div class='pulse'></div>" +
      "<svg viewBox='0 0 36 46' width='36' height='46' xmlns='http://www.w3.org/2000/svg'>" +
        "<defs>" +
          "<radialGradient id='g" + uid + "' cx='35%' cy='28%'>" +
            "<stop offset='0%' stop-color='" + co.ring + "'/>" +
            "<stop offset='100%' stop-color='" + co.bg + "'/>" +
          "</radialGradient>" +
        "</defs>" +
        "<path d='M18 2C9.2 2 2 9.2 2 18c0 8.5 7.5 15.5 16 25 8.5-9.5 16-16.5 16-25C34 9.2 26.8 2 18 2Z'" +
          " fill='url(#g" + uid + ")'/>" +
        "<circle cx='18' cy='17' r='10' fill='rgba(0,0,0,.18)'/>" +
        "<circle cx='18' cy='17' r='8.5' fill='rgba(255,255,255,.15)'" +
          " stroke='rgba(255,255,255,.55)' stroke-width='1.2'/>" +
        "<text x='18' y='22' text-anchor='middle'" +
          " font-size='" + fs + "' font-family='system-ui,Arial'" +
          " font-weight='800' fill='white'>" + label + "</text>" +
      "</svg>" +
    "</div>";

  return L.divIcon({
    className:    "",
    html:         html,
    iconSize:     [36, 46],
    iconAnchor:   [18, 46],
    popupAnchor:  [0, -48],
  });
}

function clearMarkersOnMap() {
  if (!map) return;
  routeMarkers.forEach(function(m){ try{ map.removeLayer(m); }catch(e){} });
  routeMarkers = [];
}

function drawRouteMarkers(points) {
  initMap();
  clearMarkersOnMap();
  if (!Array.isArray(points) || points.length < 2) return;
  points.forEach(function(p, idx) {
    var type   = p.type || (idx === 0 ? "start" : idx === points.length-1 ? "end" : "via");
    var lbl    = type === "start" ? "S" : type === "end" ? "E" : String(idx);
    var marker = L.marker([p.lat, p.lng], { icon: makeFlagIcon(type, lbl) }).addTo(map);
    var title  = type === "start" ? "START" : type === "end" ? "STOP" : "PUNKT " + idx;
    var city   = p.label ? p.label.split(",")[0] : "";
    marker.bindPopup(
      "<b>" + title + "</b>" +
      (city ? "<br><span style='font-size:11px;opacity:.75'>" + city + "</span>" : "")
    );
    routeMarkers.push(marker);
  });
}

function drawGeometry(geometry) {
  initMap();
  clearRouteOnMap();

  if (!geometry || !geometry.coordinates || geometry.coordinates.length < 2) {
    console.warn("Brak geometrii trasy:", geometry);
    return;
  }

  // HERE i OSRM: [lon,lat] -> Leaflet: [lat,lon]
  const latlngs = geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  console.log("drawGeometry: latlngs.length=", latlngs.length, "first=", latlngs[0]);

  try {
    routeLine = L.polyline(latlngs, { color: "#6d7cff", weight: 5 }).addTo(map);
    // invalidateSize przed fitBounds żeby mapa znała swój rozmiar
    map.invalidateSize();
    setTimeout(() => {
      try {
        map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
      } catch(e) { console.warn("fitBounds error:", e); }
    }, 100);
  } catch(e) {
    console.error("drawGeometry error:", e);
  }
}


function updateMapFromRoute(data) {
  if (data && data.geometry) drawGeometry(data.geometry);
  else console.warn("Backend nie zwrócił data.geometry");

  if (Array.isArray(data.points) && data.points.length) {
    drawRouteMarkers(data.points);
  }
  console.log("updateMapFromRoute points len:", data?.points?.length);
}

/* =========================
   ROUTE BUILDER (pola)
========================= */
function initRouteBuilder(){
  const list = document.getElementById("routeList");
  if (!list) return;
  list.innerHTML = "";

  addRouteRow("Skąd", "Warszawa", { fixed: true });
  addRouteRow("Dokąd", "Leeds", { fixed: true });
  updateRouteButtons();
}

function addRouteRow(label, value = "", opts = {}){
  const list = document.getElementById("routeList");

  const wrapper = document.createElement("div");

  const tag = document.createElement("div");
  tag.className = "routeTag";
  tag.textContent = label;

  const row = document.createElement("div");
  row.className = "routeRow";
  row.dataset.fixed = opts.fixed ? "1" : "0";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = label;
  input.value = value;

  const up = document.createElement("button");
  up.type = "button";
  up.className = "iconBtn small";
  up.title = "Przesuń w górę";
  up.textContent = "↑";
  up.onclick = () => moveRouteRow(row, -1);

  const down = document.createElement("button");
  down.type = "button";
  down.className = "iconBtn small";
  down.title = "Przesuń w dół";
  down.textContent = "↓";
  down.onclick = () => moveRouteRow(row, +1);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "iconBtn delBtn";
  del.title = "Usuń punkt";
  del.textContent = "✕";
  del.onclick = () => { wrapper.remove(); updateRouteButtons(); };

  if (opts.fixed){
    del.disabled = true;
    del.style.opacity = "0.45";
    del.style.cursor = "not-allowed";
  }

  row.appendChild(input);
  row.appendChild(up);
  row.appendChild(down);
  row.appendChild(del);

  wrapper.appendChild(tag);
  wrapper.appendChild(row);

  if (!opts.fixed){
    const wrappers = Array.from(list.children);
    const last = wrappers[wrappers.length - 1];
    list.insertBefore(wrapper, last);
  } else {
    list.appendChild(wrapper);
  }

  updateRouteButtons();
}

function addRoutePoint(){ addRouteRow("Punkt pośredni", "", { fixed: false }); }

function clearRouteMiddle(){
  const list = document.getElementById("routeList");
  const wrappers = Array.from(list.children);
  wrappers.slice(1, -1).forEach(w => w.remove());
  updateRouteButtons();
}

function moveRouteRow(rowEl, dir){
  const wrapper = rowEl.parentElement; // wrapper
  const list = document.getElementById("routeList");
  const wrappers = Array.from(list.children);
  const idx = wrappers.indexOf(wrapper);
  const newIdx = idx + dir;

  if (newIdx < 0 || newIdx >= wrappers.length) return;

  if (dir < 0) list.insertBefore(wrapper, wrappers[newIdx]);
  else list.insertBefore(wrapper, wrappers[newIdx].nextSibling);

  relabelRoute();
  updateRouteButtons();
}

function relabelRoute(){
  const list = document.getElementById("routeList");
  const wrappers = Array.from(list.children);

  wrappers.forEach((w, i) => {
    const tag = w.querySelector(".routeTag");
    const row = w.querySelector(".routeRow");
    const isFirst = i === 0;
    const isLast = i === wrappers.length - 1;

    tag.textContent = isFirst ? "Skąd" : (isLast ? "Dokąd" : "Punkt pośredni");

    const fixed = isFirst || isLast;
    row.dataset.fixed = fixed ? "1" : "0";

    const del = row.querySelector(".delBtn");
    if (del){
      del.disabled = fixed;
      del.style.opacity = fixed ? "0.45" : "1";
      del.style.cursor = fixed ? "not-allowed" : "pointer";
    }
  });
}

function updateRouteButtons(){
  const list = document.getElementById("routeList");
  const wrappers = Array.from(list.children);

  wrappers.forEach((w, i) => {
    const row = w.querySelector(".routeRow");
    const upBtn = row.querySelector('button[title="Przesuń w górę"]');
    const downBtn = row.querySelector('button[title="Przesuń w dół"]');

    if (upBtn) upBtn.disabled = (i === 0);
    if (downBtn) downBtn.disabled = (i === wrappers.length - 1);
  });

  relabelRoute();
}

// getRoute() is defined in app.js (full version with multi-stop, vignettes, map)
// Duplicate removed from here to avoid overwriting window.getRoute

function getRouteFromUI(){
  const list = document.getElementById("routeList");
  const wrappers = Array.from(list.children);

  const values = wrappers
    .map(w => w.querySelector(".routeRow input").value.trim())
    .filter(Boolean);

  const origin = values[0] || "";
  const destination = values[values.length - 1] || "";
  const stops = values.slice(1, -1);

  return { origin, destination, stops };
}

// window.getRoute is exported from app.js (full version)
window.addRoutePoint = addRoutePoint;
window.clearRouteMiddle = clearRouteMiddle;