/* =========================
   KALKULACJE (Twoje)
========================= */
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
    if (el) el.value = String(Math.round(days * dailyExtra * 100) / 100);
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

function calculateCosts(data){
  const fuel_l = data.distance_km * data.fuel_l_per_100km / 100;
  const fuel_cost_pln = fuel_l * data.fuel_price_pln_per_l;
  const fuel_cost_eur = fuel_cost_pln / data.eur_pln;

  const driver_cost_eur = data.driver_days * data.driver_eur_per_day;

  // NOTE: tolls_eur already includes vignettes (NL/GB) — set by app.js before run()
  // Do NOT re-calculate vignettes here to avoid double-counting
  const total_cost_eur =
    fuel_cost_eur
    + data.tolls_eur
    + data.ferries_eur
    + driver_cost_eur
    + data.other_costs_eur;

	let price_eur = 0;
	let offer_price_eur = 0;

	if (data.calc_mode === "offer" && data.offer_price_eur > 0) {
		// Odwrócony kalkulator: mam cenę zlecenia → liczę marżę
	offer_price_eur = data.offer_price_eur;
	price_eur = offer_price_eur;
	} else {
  // Klasyczny tryb: liczę cenę sugerowaną z target marży
	price_eur = total_cost_eur * (1 + data.target_margin_pct / 100);
	}

	const margin_eur = price_eur - total_cost_eur;
	const margin_pct = price_eur > 0 ? (margin_eur / price_eur) * 100 : 0;

  return {
    distance_km: round2(data.distance_km),
    tolls_eur: round2(data.tolls_eur),
    ferries_eur: round2(data.ferries_eur),
    other_costs_eur: round2(data.other_costs_eur),

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

function run() {

console.log("RUN CLICK");

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
  
  const evalData = evaluateRoute(result);
	window.lastEvaluation = evalData;
  
  window.lastInput = data;

  renderResult(data, result);
  
  autoSaveAfterRun();

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
  if (margin < 5) score -= 1;
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