/* =========================
   KALKULACJE (Twoje)
========================= */

// ===== KOSZTY STAŁE ZESTAWU (leasing/ZUS/ubezp./serwis rozłożone na dni trasy) =====
function computeFixedCostEur(driverDays){
  const on = document.getElementById("fixed_enabled")?.checked;
  if (!on) return { eur: 0, note: "" };

  const leasing = +document.getElementById("fx_leasing")?.value || 0;
  const zus     = +document.getElementById("fx_zus")?.value || 0;
  const ubezp   = +document.getElementById("fx_ubezp")?.value || 0;
  const serwis  = +document.getElementById("fx_serwis")?.value || 0;
  const office  = +document.getElementById("fx_office")?.value || 0;
  const vehicle = +document.getElementById("fx_vehicle")?.value || 0;
  // lump (łączny koszt/mc) nadpisuje rozbicie, jeśli wpisany > 0
  const lump    = +document.getElementById("fx_lump")?.value || 0;
  const monthly = lump > 0 ? lump : (leasing + zus + ubezp + serwis + office + vehicle);

  const workDays = +document.getElementById("fx_work_days")?.value || 20;

  // dni trasy: pole fx_trip_days; jeśli 0/puste → bierz dni kierowcy (driverDays)
  let tripDays = +document.getElementById("fx_trip_days")?.value || 0;
  if (tripDays <= 0) tripDays = driverDays || 1;
  // pusty dolot/powrót: dolicz dni powrotu jeśli włączony suwak
  const incReturn = document.getElementById("fx_inc_return")?.checked;
  if (incReturn) tripDays += (+document.getElementById("fx_return_days")?.value || 0);

  const daily = workDays > 0 ? monthly / workDays : 0;
  const eur = daily * tripDays;

  const note = monthly > 0
    ? `${Math.round(monthly)} € \u00f7 ${workDays} dni \u00d7 ${tripDays} dni trasy = ${Math.round(eur)} \u20ac`
    : "";
  return { eur: Math.round(eur * 100) / 100, note };
}

function updateTotalDistance(){
  const base = Number(document.getElementById("base_distance_km")?.value || 0);
  const empty = Number(document.getElementById("empty_km")?.value || 0);
  const total = Math.round((base + empty) * 10) / 10;

  const distEl = document.getElementById("distance_km");
  if (distEl) distEl.value = total;

  return { base, empty, total };
}

function calcDriverDays(distanceKm, kmPerDay){
  const km = Number(distanceKm) || 0;
  const perDay = Math.max(1, Number(kmPerDay) || 550);
  let days = Math.ceil(km / perDay);

  let weekendAdded = false;
  if (days > 6){ days += 1; weekendAdded = true; }
  if (km > 0 && days === 0) days = 1;

  return { days, weekendAdded };
}

function applyAutoFields(){
  const autoDays  = document.getElementById("auto_driver_days")?.checked;
  const autoOther = document.getElementById("auto_other_costs")?.checked;

  const kmPerDay   = Number(document.getElementById("km_per_day")?.value  || 600);
  const dailyExtra = Number(document.getElementById("daily_extra_eur")?.value || 150);
  const driverRate = Number(document.getElementById("driver_eur_per_day")?.value || 120);

  const totalKm = Number(document.getElementById("distance_km")?.value || 0);
  const { days, weekendAdded } = calcDriverDays(totalKm, kmPerDay);

  if (autoDays) {
    const el = document.getElementById("driver_days");
    if (el) el.value = String(days);
    // Ustaw też stawkę kierowcy jeśli jest zero
    const rateEl = document.getElementById("driver_eur_per_day");
    if (rateEl && Number(rateEl.value) === 0) rateEl.value = "120";
  }

  if (autoOther) {
    const el = document.getElementById("other_costs_eur");
    if (el) { el.value = String(Math.round(days * dailyExtra * 100) / 100); el.readOnly = true; }
  } else {
    const el = document.getElementById("other_costs_eur");
    if (el) el.readOnly = false;
  }

  const note = document.getElementById("autoNote");
  if (note){
    note.textContent = totalKm > 0
      ? `AUTO: ${days} dni (${totalKm} km ÷ ${kmPerDay} km/dzień)${weekendAdded ? " + przerwa weekendowa" : ""}${autoOther ? ` • inne = ${days}×${dailyExtra}€` : ""}`
      : "Ustaw dystans (Pobierz km), żeby auto-przeliczyć dni i koszty.";
  }
}

function round2(x){ return Math.round(x * 100) / 100; }

function textHasGB(s){
  const t = String(s || "").toLowerCase();
  return t.includes("uk") || t.includes("united kingdom") || t.includes("wielka brytania") || t.includes("england") || t.includes("scotland") || t.includes("london");
}
function textHasNL(s){
  const t = String(s || "").toLowerCase();
  return t.includes("netherlands") || t.includes("holandia") || t.includes("niderland") || t.includes("amsterdam") || t.includes("rotterdam");
}

// Bezpieczna liczba: zwraca fallback gdy NaN/Infinity/puste
function safeNum(x, fallback = 0){
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function calculateCosts(data){
  // GUARD: kurs EUR/PLN musi być > 0, inaczej paliwo = Infinity/NaN i cała wycena bez sensu.
  // Puste pole (+"" → 0) lub tekst (NaN) → fallback 4.3 (typowy kurs).
  const eurPln = safeNum(data.eur_pln) > 0 ? safeNum(data.eur_pln) : 4.3;
  const distance = safeNum(data.distance_km);
  const fuelPer100 = safeNum(data.fuel_l_per_100km);
  const fuelPricePln = safeNum(data.fuel_price_pln_per_l);

  const fuel_l = distance * fuelPer100 / 100;
  const fuel_cost_pln = fuel_l * fuelPricePln;
  const fuel_cost_eur = fuel_cost_pln / eurPln;

  const driver_cost_eur = safeNum(data.driver_days) * safeNum(data.driver_eur_per_day);

  // CHŁODNIA: spalanie agregatu (l/h) × h/dzień × dni trasy × cena paliwa
  const reefer_l = safeNum(data.reefer_l_per_h) * safeNum(data.reefer_h_per_day) * safeNum(data.driver_days);
  const reefer_eur = reefer_l * fuelPricePln / eurPln;

  // NOTE: tolls_eur already includes vignettes (NL/GB) — set by app.js before run()
  // Do NOT re-calculate vignettes here to avoid double-counting
  const fixed = computeFixedCostEur(data.driver_days);

  const total_cost_eur =
    fuel_cost_eur
    + safeNum(data.tolls_eur)
    + safeNum(data.ferries_eur)
    + driver_cost_eur
    + safeNum(data.other_costs_eur)
    + reefer_eur
    + fixed.eur;

	let price_eur = 0;
	let offer_price_eur = 0;

	if (data.calc_mode === "offer" && safeNum(data.offer_price_eur) > 0) {
		// Odwrócony kalkulator: mam cenę zlecenia → liczę marżę
	offer_price_eur = safeNum(data.offer_price_eur);
	price_eur = offer_price_eur;
	} else {
  // Klasyczny tryb: liczę cenę sugerowaną z target marży
	price_eur = total_cost_eur * (1 + safeNum(data.target_margin_pct) / 100);
	}

	const margin_eur = price_eur - total_cost_eur;
	const margin_pct = price_eur > 0 ? (margin_eur / price_eur) * 100 : 0;

  return {
    distance_km: round2(distance),
    tolls_eur: round2(safeNum(data.tolls_eur)),
    ferries_eur: round2(safeNum(data.ferries_eur)),
    other_costs_eur: round2(safeNum(data.other_costs_eur)),
    reefer_eur: round2(reefer_eur),
    reefer_l: round2(reefer_l),

    fixed_costs_eur: round2(fixed.eur),

    fuel_l: round2(fuel_l),
    fuel_cost_pln: round2(fuel_cost_pln),
    fuel_cost_eur: round2(fuel_cost_eur),
    driver_cost_eur: round2(driver_cost_eur),
    total_cost_eur: round2(total_cost_eur),
    suggested_price_eur: round2(data.calc_mode === "offer" ? 0 : price_eur),
	offer_price_eur: round2(offer_price_eur),
	margin_eur: round2(margin_eur),
	margin_pct: round2(margin_pct),
	calc_mode: data.calc_mode,
  };
}

function run(fromPolicz = false) {

console.log("RUN CLICK", fromPolicz ? "(POLICZ)" : "(auto)");

  const { base, empty, total } = updateTotalDistance();
  applyAutoFields();

  const data = {
    distance_km: total,
    base_distance_km: base,
    empty_km: empty,

    fuel_l_per_100km: +document.getElementById("fuel_l_per_100km").value,
    fuel_price_pln_per_l: +document.getElementById("fuel_price_pln_per_l").value,
    eur_pln: +document.getElementById("eur_pln").value,
	gbp_eur: +document.getElementById("gbp_eur").value,  
    tolls_eur: +document.getElementById("tolls_eur").value,
    ferries_eur: +document.getElementById("ferries_eur").value,
    driver_days: +document.getElementById("driver_days").value,
    driver_eur_per_day: +document.getElementById("driver_eur_per_day").value,
    other_costs_eur: +document.getElementById("other_costs_eur").value,
    reefer_l_per_h: +document.getElementById("reefer_l_per_h")?.value || 0,
    reefer_h_per_day: +document.getElementById("reefer_h_per_day")?.value || 0,
    target_margin_pct: +document.getElementById("target_margin_pct").value,
	
	calc_mode: document.getElementById("calc_mode")?.value || "suggest",
	offer_price_eur: +document.getElementById("offer_price_eur")?.value || 0,
  };
  
  if (data.calc_mode !== "offer") {
  data.offer_price_eur = 0;
}
  
  console.log("MODE:", data.calc_mode, "OFFER:", data.offer_price_eur);

  const result = calculateCosts(data);

  result.base_distance_km = round2(base);
  result.empty_km = round2(empty);
  result.distance_km = round2(total);

  window.lastCalc = result;

  // FIX: nowa kalkulacja = zerujemy powiązanie z poprzednim ręcznym zapisem,
  // żeby PDF nie ciągnął nazwy/klienta ze starej trasy z historii.
  window.lastHistoryId = null;
  // Nowa kalkulacja — resetuj ID autosave żeby nie nadpisać innej trasy
  window._autoSaveId = null;

  const evalData = evaluateRoute(result);
	window.lastEvaluation = evalData;
  
  window.lastInput = data;

  renderResult(data, result, fromPolicz);

  // pokaż wzór kosztów stałych pod sekcją + podpowiedź auto dla dni trasy
  try {
    const fxn = document.getElementById("fxNote");
    if (fxn) {
      const f = computeFixedCostEur(data.driver_days);
      fxn.textContent = f.note || "";
      const tripEl = document.getElementById("fx_trip_days");
      if (tripEl && (+tripEl.value || 0) <= 0) tripEl.placeholder = "auto: " + (data.driver_days || 1);
    }
  } catch(e){}

  // ── AUTOSAVE po auto-run (Pobierz km bez kliknięcia POLICZ) ──────────
  // Jeśli user nie kliknie POLICZ w ciągu 30s, zapisujemy cicho jako non-draft.
  // ── AUTOSAVE po auto-run (Pobierz km bez kliknięcia POLICZ) ──────────
  if (!fromPolicz) {
    autoSaveAfterRun(); // draft do localStorage (backup sesji)
    clearTimeout(window._deferredSaveTimer);
    window._deferredSaveTimer = setTimeout(function deferredSave() {
      if (window._lastSavedFromPolicz) {
        console.log("[autosave] pominięto — POLICZ już zapisał");
        return;
      }
      const r2 = window.lastRoutePayload || {};
      const calc2 = window.lastCalc;
      if (!r2.origin || !r2.destination || !calc2) {
        console.log("[autosave] brak danych trasy — pominięto");
        return;
      }
      const orig  = r2.origin.split(",")[0].trim();
      const dest  = r2.destination.split(",")[0].trim();
      const price = calc2.suggested_price_eur || calc2.offer_price_eur || calc2.total_cost_eur || 0;
      const autoName = `${orig} → ${dest} · ${Number(price).toFixed(0)} €`;
      const token = localStorage.getItem("optirax_token") || "";
      const newId = "H" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
      console.log("[autosave] zapisuję:", autoName);
      fetch("/api/history", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          id: newId, ts: Date.now(), name: autoName, client: "", note: "",
          vehicle_id: null, vehicle_reg: null,
          route: { origin: r2.origin, destination: r2.destination, stops: r2.stops || [] },
          calc: calc2, input: window.lastInput,
          tolls_geo: window.lastRouteTollsGeo, vignettes: window.lastRouteVignettes,
        }),
      })
      .then(function(res) {
        console.log("[autosave] odpowiedź:", res.status);
        if (res.ok) {
          // Zapamiętaj ID — POLICZ nadpisze ten rekord zamiast tworzyć nowy
          window._autoSaveId = newId;
          if (typeof renderHistory === "function") renderHistory();
        }
      })
      .catch(function(e) { console.warn("[autosave] błąd fetch:", e); });
    }, 8000);
  } else {
    clearTimeout(window._deferredSaveTimer);
    window._lastSavedFromPolicz = true;
    setTimeout(function() { window._lastSavedFromPolicz = false; }, 2000);
  }

	const isOffer = (result.calc_mode === "offer" && result.offer_price_eur > 0);

	document.getElementById("summary").textContent =
		"Koszt całkowity: " + result.total_cost_eur + " EUR\n" +
		"Dystans: " + result.base_distance_km + " km + pusty dolot " + result.empty_km + " km = " + result.distance_km + " km\n" +
		"Paliwo: " + result.fuel_cost_eur + " EUR | Kierowca: " + result.driver_cost_eur + " EUR\n" +
		"Myto: " + result.tolls_eur + " EUR | Promy: " + result.ferries_eur + " EUR | Inne: " + result.other_costs_eur + " EUR\n" +
	(isOffer
		? ("Cena zlecenia: " + result.offer_price_eur + " EUR\n" +
       "Marża: " + result.margin_eur + " EUR (" + result.margin_pct + "%)")
		: ("Proponowana cena: " + result.suggested_price_eur + " EUR\n" +
       "Marża: " + result.margin_eur + " EUR (" + result.margin_pct + "%)"));
}

function applyVignetteOverrides(tg, v){
  if (!tg?.by_country?.length) return tg;

  const hasNL = !!v?.rows?.some(r => String(r.country).startsWith("NL"));
  const hasGB = !!v?.rows?.some(r => String(r.country).startsWith("GB"));

  if (!hasNL && !hasGB) return tg;

  const isNL = (c) => /holand|niderl|nether|nl\b/i.test(String(c||""));
  const isGB = (c) => /\bgb\b|uk|united kingdom|wielka brytania|england|scotland/i.test(String(c||""));

  let removed = 0;
  const kept = [];

  for (const x of tg.by_country){
    const c = x.country;
    const isHereToll = x.source === "HERE"; // HERE = rzeczywiste myto (tunel, autostrady)
    const isOffline  = !isHereToll;         // offline = szacowany €/km

    // Dla NL: zawsze zeruj €/km (winieta zastępuje), ale nie usuwaj jeśli HERE podało rzeczywiste myto
    if (hasNL && isNL(c)) {
      if (isOffline) {
        // pomiń – winieta zastępuje szacunek offline
        removed += Number(x.cost_eur || 0);
        continue;
      }
      // HERE podało rzeczywiste myto NL (np. A2 itp.) – zachowaj, winieta DODATKOWO
    }

    // Dla GB: zeruj TYLKO offline (szacunek €/km), NIE zeruj rzeczywistego myto HERE (tunel!)
    if (hasGB && isGB(c)) {
      if (isOffline) {
        removed += Number(x.cost_eur || 0);
        continue;
      }
      // HERE tunel Channel Tunnel = realne myto – zachowaj!
    }

    kept.push(x);
  }

  const total = Math.max(0, Number(tg.total_eur || 0) - removed);
  return { ...tg, by_country: kept, total_eur: Math.round(total*100)/100 };
}

function evaluateRoute(result){
  const margin = Number(result.margin_pct || 0);
  const km = Number(result.distance_km || 0);
  const total = Number(result.total_cost_eur || 0);

  const eurPerKm = km > 0 ? total / km : 0;

  // 🚨 HARD RULE — NEGATYWNA MARŻA = NIE BIERZ
  if (margin < 0) {
    return {
      score: -5,
      label: "NIE BIERZ",
      color: "#ef4444",
      eurPerKm: eurPerKm.toFixed(2)
    };
  }

  let score = 0;

  // 🔥 MARŻA
  if (margin < 5) score -= 2;
  else if (margin < 10) score -= 1;
  else if (margin < 15) score += 1;
  else if (margin < 25) score += 2;
  else score += 3;

  // 💰 €/km
  if (eurPerKm < 0.9) score -= 2;
  else if (eurPerKm < 1.1) score -= 1;
  else if (eurPerKm < 1.3) score += 1;
  else score += 2;

  // 📏 DŁUGOŚĆ
  if (km > 1500) score += 1;
  if (km < 500) score -= 1;

  let label, color;

  if (score <= -2) {
    label = "NIE BIERZ";
    color = "#ef4444";
  } else if (score <= 0) {
    label = "NA STYK";
    color = "#f59e0b";
  } else if (score <= 3) {
    label = "DOBRA";
    color = "#22c55e";
  } else {
    label = "BIERZ W CIEMNO";
    color = "#16a34a";
  }

  return {
    score,
    label,
    color,
    eurPerKm: eurPerKm.toFixed(2)
  };
}

window.run = run;