

/* =========================
   API: POBIERZ TRASĘ
========================= */
async function getRoute(){
console.log("getRoute() start:", getRouteFromUI());
  const baseInput = document.getElementById("base_distance_km");
  const routeInfoEl = document.getElementById("routeInfo");
  const { origin, destination, stops } = getRouteFromUI();
  const useMulti = stops.length > 0;


  if (!origin || !destination) {
    routeInfoEl.textContent = "Uzupełnij Skąd i Dokąd.";
    return;
  }

  routeInfoEl.textContent = "Szukam trasy...";

  try {
    const url = useMulti
  ? "/api/route/multi"
  : "/api/route";

    const activePreset = document.querySelector(".vehicleBtn.active")?.dataset?.preset || "tir40";
    const preset = (typeof VEHICLE_PRESETS !== "undefined" && VEHICLE_PRESETS[activePreset]) || {};

    // Zbierz zaznaczone kraje do ominięcia
    const avoidCountries = [...document.querySelectorAll(".avoidCountryChk:checked")]
      .map(el => el.value);
    console.log("avoidCountries:", avoidCountries);

    const truckParams = {
      transportMode:  preset.transportMode  || "truck",
      grossWeightKg: +document.getElementById("truck_grossWeight")?.value || 40000,
      axleWeightKg:  +document.getElementById("truck_axleWeight")?.value  || 11500,
      heightCm:      +document.getElementById("truck_height")?.value      || 400,
      widthCm:       +document.getElementById("truck_width")?.value       || 255,
      lengthCm:      +document.getElementById("truck_length")?.value      || 1360,
      axleCount:     +document.getElementById("truck_axleCount")?.value   || 5,
      avoidCountries,
    };
    const payload = useMulti
      ? { origin, destination, stops, truckParams }
      : { origin, destination, truckParams };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
	window.lastRouteTollsGeo = data.tolls_geo || null;
	console.log("tolls_geo:", data.tolls_geo);
	console.log("tolls(v0):", data.tolls);


	const rui = getRouteFromUI();
		window.lastRoutePayload = {
		origin: rui.origin,
		destination: rui.destination,
		stops: rui.stops,
		points_resolved: data.points_resolved || null,
		title: (rui.origin && rui.destination) ? `${rui.origin} → ${rui.destination}` : "Wycena trasy"
	};

    if (!res.ok) {
      routeInfoEl.textContent = data.error || "Błąd wyznaczania trasy.";
      return;
    }

    baseInput.value = data.distance_km;
    updateMapFromRoute(data);

    // === ALTERNATYWNE TRASY ===
    renderAlternativeRoutes(data.alternatives || []);

const { base, empty, total } = updateTotalDistance();
applyAutoFields();

// --- MYTO Z HERE (jedno źródło prawdy) ---
const tg0 = window.lastRouteTollsGeo;
const driverDays = +document.getElementById("driver_days")?.value || 0;
const gbpEur = +document.getElementById("gbp_eur")?.value || 1.17;

const routeText =
  (data.origin_resolved || origin || "") + " " +
  (data.destination_resolved || destination || "") + " " +
  (Array.isArray(data.points_resolved) ? data.points_resolved.join(" ") : "");

const kmPerDayUi = +document.getElementById("km_per_day")?.value || 600;

const v = calcDailyVignettesFromGeo(
  tg0,
  driverDays,
  gbpEur,
  routeText,
  Number(data.distance_km || 0),
  kmPerDayUi
);

window.lastRouteVignettes = v;
const tgAdj = applyVignetteOverrides(tg0, v);
window.lastRouteTollsGeoAdj = tgAdj;

// Myto = HERE (per-km toll) + winiety NL/GB — jedno źródło, readonly
const baseTolls = (tgAdj?.total_eur != null) ? Number(tgAdj.total_eur) : 0;
const totalTolls = baseTolls + Number(v.total_eur || 0);
const tollsEl = document.getElementById("tolls_eur");
if (tollsEl) {
  tollsEl.value = totalTolls.toFixed(2);
}
// Promy/tunel – pole manualne, nie nadpisujemy

// Label źródła myto
const sourceEl = document.getElementById("tollsSource");
if (sourceEl) {
  const hasHere = tg0?.by_country?.some(x => x.source === "HERE");
  sourceEl.textContent = hasHere
    ? `Źródło: HERE Routing API (${data.routing_engine || "HERE"})`
    : "Źródło: offline €/km (brak danych HERE)";
}
	
	run();

    let pointsText = "";
    if (Array.isArray(data.points_resolved) && data.points_resolved.length) {
      pointsText = "Punkty:\n- " + data.points_resolved.join("\n- ") + "\n\n";
    } else if (data.origin_resolved || data.destination_resolved) {
      pointsText =
        "Skąd: " + (data.origin_resolved || origin) + "\n" +
        "Dokąd: " + (data.destination_resolved || destination) + "\n\n";
    }

    routeInfoEl.textContent =
      pointsText +
      `Trasa z mapy: ${base} km\n` +
      `Pusty dolot: ${empty} km\n` +
      `RAZEM do kalkulacji: ${total} km\n` +
      `Czas (bazowy): ${data.duration_h} h`;

  } catch (e) {
    console.error(e);
    routeInfoEl.textContent = "Nie mogę połączyć się z serwerem (route).";
  }
}

/* =========================
   BOOT + EXPORT dla onclick
========================= */
window.addEventListener("load", () => {
  console.log("APP BOOT");

  initRouteBuilder();
  initMap();

  // auto
  document.getElementById("empty_km")?.addEventListener("input", () => { updateTotalDistance(); applyAutoFields(); });
  document.getElementById("km_per_day")?.addEventListener("input", applyAutoFields);
  document.getElementById("daily_extra_eur")?.addEventListener("input", applyAutoFields);
  document.getElementById("auto_driver_days")?.addEventListener("change", applyAutoFields);

});

function renderResult(input, result) {
  const k1 = document.getElementById("kpi_total");
  const k2 = document.getElementById("kpi_price");
  const k3 = document.getElementById("kpi_margin");

  if (k1) k1.textContent = (result.total_cost_eur ?? "—") + " EUR";

  const isOffer = (result.calc_mode === "offer" && Number(result.offer_price_eur || 0) > 0);

  if (isOffer) {
    if (k2) k2.textContent = (result.offer_price_eur ?? "—") + " EUR";
    if (k3) k3.textContent = (result.margin_eur ?? "—") + " EUR";
  } else {
    if (k2) k2.textContent = (result.suggested_price_eur ?? "—") + " EUR";
    if (k3) k3.textContent = (result.margin_eur ?? "—") + " EUR";
  }

  // ✅ WINIETY – bierzemy z globala (NIE z "v" lokalnego)
  const v = window.lastRouteVignettes || null;

  const vEl = document.getElementById("vignetteTotal");
  if (vEl) {
    if (v?.rows?.length) {
      const line = v.rows
        .map(x => `${x.country}: ${x.qty} dni (${Number(x.cost_eur || 0).toFixed(2)} €)`)
        .join(" | ");
      vEl.textContent = `Winiety dzienne: ${line} | Razem: ${Number(v.total_eur || 0).toFixed(2)} EUR`;
    } else {
      vEl.textContent = "";
    }
  }

  // === TABELA Pozycja / Wartość ===
  const tbody = document.getElementById("costTable");
  if (tbody) {
    const row = (label, value, iconId) => {
      const ic = iconId
        ? `<svg class="cost-ic" viewBox="0 0 24 24"><use href="#${iconId}"/></svg>`
        : `<span class="cost-ic-sp"></span>`;
      return `
      <tr>
        <td>${ic}${label}</td>
        <td style="text-align:right;">${value}</td>
      </tr>
    `;
    };

    tbody.innerHTML = "";
    tbody.innerHTML += row("Dystans (km)", result.distance_km ?? "—", "i-route");
    tbody.innerHTML += row("Paliwo (EUR)", result.fuel_cost_eur ?? "—", "i-fuel");
    tbody.innerHTML += row("Kierowca (EUR)", result.driver_cost_eur ?? "—", "i-truck");
    tbody.innerHTML += row("Myto (EUR)", result.tolls_eur ?? "—", "i-map");
    tbody.innerHTML += row("Promy (EUR)", result.ferries_eur ?? "—", "i-ship");
    tbody.innerHTML += row("Inne koszty (EUR)", result.other_costs_eur ?? "—", "i-clipboard");
    if (Number(result.reefer_eur) > 0) {
      tbody.innerHTML += row("Chłodnia / agregat (EUR)", result.reefer_eur, "i-leaf");
    }
    if (Number(result.fixed_costs_eur) > 0) {
      tbody.innerHTML += row("Koszty stałe zestawu (EUR)", result.fixed_costs_eur, "i-settings");
    }
    tbody.innerHTML += row("<b>Koszt całkowity (EUR)</b>", `<b>${result.total_cost_eur ?? "—"}</b>`, "i-calc");

    if (isOffer) {
      tbody.innerHTML += row("Cena zlecenia (EUR)", result.offer_price_eur ?? "—", "i-money");
      tbody.innerHTML += row("<b>Marża (EUR)</b>", `<b>${result.margin_eur ?? "—"}</b>`);
      tbody.innerHTML += row("Marża (%)", (result.margin_pct ?? "—") + "%");
    } else {
      tbody.innerHTML += row("Cena sugerowana (EUR)", result.suggested_price_eur ?? "—", "i-money");
      tbody.innerHTML += row("Marża (EUR)", result.margin_eur ?? "—");
    }
  }

  // === Koszt / km + Stawka oczekiwana / km ===
  const perKmEl = document.getElementById("perKm");
  if (perKmEl) {
    const km = Number(result.distance_km || 0);
    const total = Number(result.total_cost_eur || 0);
    const price = Number(result.price_eur || result.suggested_price_eur || result.offer_price_eur || 0);
    if (km > 0) {
      const costKm = (total / km).toFixed(2);
      const rateKm = price > 0 ? (price / km).toFixed(2) : null;
      perKmEl.textContent = rateKm
        ? `Koszt: ${costKm} €/km · Stawka oczekiwana: ${rateKm} €/km`
        : `Koszt / km: ${costKm} €/km`;
    } else perKmEl.textContent = "";
  }
  // wiersz stawki oczekiwanej w tabeli (price ÷ km)
  if (tbody) {
    const km = Number(result.distance_km || 0);
    const price = Number(result.price_eur || result.suggested_price_eur || result.offer_price_eur || 0);
    if (km > 0 && price > 0) {
      tbody.innerHTML += `<tr><td><b>Stawka oczekiwana (€/km)</b></td><td style="text-align:right;"><b>${(price/km).toFixed(2)}</b></td></tr>`;
    }
  }

  // === Myto per kraj ===
  const tollsBody = document.getElementById("tollsTable");
  const tollsTotalEl = document.getElementById("tollsTotal");

  const tg = window.lastRouteTollsGeoAdj || window.lastRouteTollsGeo;

  if (tollsBody) {
    tollsBody.innerHTML = "";

    const isVignetteCountry = (name) => /holand|nether|nl\b|\bgb\b|united kingdom|wielka brytania|england|scotland|szwajcar|swiss/i.test(String(name||""));

    if (tg?.by_country?.length) {
      tg.by_country.forEach(x => {
        const isHere   = x.source === "HERE";
        const isVig    = isVignetteCountry(x.country);
        // Dla HERE: nie pokazuj stawki €/km (km są proporcjonalne, nie rzeczywiste)
        // Dla offline: pokaż stawkę
        const kmCell   = isHere ? `<span style="opacity:.45;font-size:11px;">~${x.km ?? "—"}</span>` : (x.km ?? "—");
        const rateCell = isHere
          ? `<span style="opacity:.4;font-size:10px;">${isVig ? "winieta" : "HERE"}</span>`
          : (x.rate_eur_per_km ?? "—");
        tollsBody.innerHTML += `
          <tr>
            <td>${x.country ?? "—"}</td>
            <td style="text-align:right;">${kmCell}</td>
            <td style="text-align:right;">${rateCell}</td>
            <td style="text-align:right;font-weight:600;">${Number(x.cost_eur||0).toFixed(2)}</td>
          </tr>
        `;
      });
    } else {
      tollsBody.innerHTML = `<tr><td colspan="4" style="opacity:.75;">Brak danych myta.</td></tr>`;
    }

    // Winiety jako osobne wiersze
    if (v?.rows?.length) {
      v.rows.forEach(r => {
        tollsBody.innerHTML += `
          <tr style="opacity:.85;">
            <td>${r.country}</td>
            <td style="text-align:right;">${r.qty} ${r.unit}</td>
            <td style="text-align:right;">${r.rate} ${r.rate_ccy}/${r.unit}</td>
            <td style="text-align:right;font-weight:600;">${Number(r.cost_eur||0).toFixed(2)}</td>
          </tr>
        `;
      });
    }

    // Podsumowanie
    const base = Number(tg?.total_eur || 0);
    const add  = Number(v?.total_eur  || 0);
    const src  = tg?.by_country?.some(x => x.source === "HERE") ? "HERE" : "offline €/km";

    if (tollsTotalEl) {
      tollsTotalEl.textContent = add > 0
        ? `Myto (${src}): ${base.toFixed(2)} € | Winiety: ${add.toFixed(2)} € | Razem: ${(base+add).toFixed(2)} €`
        : `Myto (${src}) razem: ${base ? base.toFixed(2) : "—"} EUR`;
    }
  }

  
  const ev = window.lastEvaluation;

if (ev) {
  const scoreEl = document.getElementById("routeScore");
  const scoreVal = document.getElementById("scoreValue");
  const eurKm = document.getElementById("eurKmValue");
  const box = document.querySelector(".route-evaluation");

  if (scoreEl) {
    scoreEl.textContent = ev.label;
    scoreEl.style.color = ev.color;
  }

  if (scoreVal) scoreVal.textContent = ev.score;
  if (eurKm) eurKm.textContent = ev.eurPerKm;

  if (box) box.style.borderColor = ev.color;
}

if (result.margin_pct < 0) {
  const scoreEl = document.getElementById("routeScore");
  if (scoreEl) {
    scoreEl.textContent = "NIE BIERZ (STRATA)";
  }
}
  
}


// ===== EXPORT DLA onclick="" (JEDEN RAZ) =====
window.getRoute = getRoute;
window.run = run;
window.addRoutePoint = addRoutePoint;
window.clearRouteMiddle = clearRouteMiddle;

// ===== PODPIĘCIE PRZYCISKU (opcjonalnie) =====
window.addEventListener("load", () => {
  const btn = document.getElementById("btnReportAI");
  if (btn) {
    btn.addEventListener("click", () => window.generateReport());
  }
});

const HISTORY_KEY = "ak_history_v1";
const HISTORY_AUTO_ID = "AUTO_LAST";
const DB_USER = "default"; // przyszłość: login użytkownika

// --- Historia: Supabase przez serwer, z fallback localStorage ---
async function hLoad() {
  try {
    const r = await fetch(`/api/history?user_id=${DB_USER}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const rows = await r.json();
    // Konwertuj format bazy → format app.js
    return rows.map(row => ({
      id:         row.id,
      ts:         row.ts,
      name:       row.name,
      client:     row.client,
      note:       row.note,
      route: {
        origin:      row.origin,
        destination: row.destination,
        stops:       row.stops || [],
      },
      calc:       row.calc,
      input:      row.input,
      tolls_geo:  row.tolls_geo,
      vignettes:  row.vignettes,
    }));
  } catch(e) {
    console.warn("Supabase niedostępne, fallback localStorage:", e.message);
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  }
}

async function hSave(items) {
  // Przy zapisie do Supabase wywołujemy osobno — hSave używane tylko przy starym bulk save
  // Nowe zapisy idą przez hSaveItem
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch {}
}

async function hSaveItem(item) {
  // Zapisz jeden wpis do Supabase + localStorage backup
  try {
    await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, user_id: DB_USER }),
    });
  } catch(e) {
    console.warn("Supabase save failed, tylko localStorage:", e.message);
  }
  // Backup lokalny
  try {
    const local = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    local.unshift(item);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(local.slice(0, 200)));
  } catch {}
}

async function hDeleteItem(id) {
  try {
    await fetch(`/api/history/${id}?user_id=${DB_USER}`, { method: "DELETE" });
  } catch(e) { console.warn("Supabase delete failed:", e.message); }
  try {
    const local = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    localStorage.setItem(HISTORY_KEY, JSON.stringify(local.filter(x => x.id !== id)));
  } catch {}
}

function hId(){
  return "H" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

function openSaveHistoryModal(){
  // podpowiedzi do pól
  const r = window.lastRoutePayload || null;
  const calc = window.lastCalc || null;

  const nameEl = document.getElementById("h_name");
  const clientEl = document.getElementById("h_client");
  const noteEl = document.getElementById("h_note");

  if (nameEl && !nameEl.value) {
    const title = r?.title || (r?.origin && r?.destination ? `${r.origin} → ${r.destination}` : "Wycena trasy");
    nameEl.value = title;
  }
  if (clientEl && !clientEl.value) clientEl.value = "";
  if (noteEl && !noteEl.value) noteEl.value = "";

  document.getElementById("historyModal").style.display = "flex";
}
function closeSaveHistoryModal(){
  document.getElementById("historyModal").style.display = "none";
}

function toggleHistory(forceClose = false){
  const drawer = document.getElementById("historyDrawer");
  const back = document.getElementById("historyBackdrop");
  if (!drawer || !back) return;

  const isOpen = drawer.classList.contains("open");
  const next = forceClose ? false : !isOpen;

  drawer.classList.toggle("open", next);
  back.classList.toggle("open", next);
  drawer.setAttribute("aria-hidden", next ? "false" : "true");

  if (next) {
    // odśwież listę przy otwarciu
    try { renderHistory(); } catch {}
  }
}

// ESC zamyka drawer
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleHistory(true);
});

function toggleHistoryPanel(forceOpen){
  const sec = document.querySelector('[data-collap="historia"]');
  const body = document.getElementById("historyPanelBody");
  if (!sec || !body) return;

  const isOpen = !sec.classList.contains("closed");
  const next = (forceOpen === true) ? true : (forceOpen === false ? false : !isOpen);

  sec.classList.toggle("closed", !next);

  if (next) renderHistory();
}

async function saveCurrentToHistory(){
  const calc = window.lastCalc;
  const input = window.lastInput;
  if (!calc || !input) {
    alert("Brak danych do zapisu. Kliknij najpierw „Policz”.");
    return;
  }

  const r = window.lastRoutePayload || {};
  const tolls_geo = window.lastRouteTollsGeo || null;

  // ✅ nowe: zapisuj też wersję „po winietach” i same winiety
  const tolls_geo_adj = window.lastRouteTollsGeoAdj || null;
  const vignettes = window.lastRouteVignettes || null;

  const name = (document.getElementById("h_name")?.value || "").trim() || (r.title || "Wycena");
  const client = (document.getElementById("h_client")?.value || "").trim();
  const note = (document.getElementById("h_note")?.value || "").trim();

  const item = {
    id: hId(),
    ts: Date.now(),
    name,
    client,
    note,

    route: {
      origin: r.origin || "",
      destination: r.destination || "",
      stops: Array.isArray(r.stops) ? r.stops : [],
      points_resolved: r.points_resolved || null,
    },

    input,
    result: calc,

    // ✅ zapis danych myta i winiet
    tolls_geo,
    tolls_geo_adj,
    vignettes,
  };

  await hSaveItem(item);
  window.lastHistoryId = item.id;
  renderHistory();
  closeSaveHistoryModal();
  if (typeof toggleHistoryPanel === "function") toggleHistoryPanel(true);
}

function clearHistoryConfirm(){
  if (!confirm("Na pewno wyczyścić historię wycen?")) return;
  hSave([]);
  renderHistory();
}

async function renderHistory(){
  const el = document.getElementById("historyList");
  if (!el) return;

  let items = await hLoad();

  // Filtruj drafty (AUTO_LAST lokalny + ewentualne drafty z Supabase które
  // przeleciały przez API z is_draft=true). UI historii pokazuje tylko stałe wpisy.
  items = items.filter(it => it.id !== HISTORY_AUTO_ID && it.is_draft !== true);

  if (!items.length) {
    el.innerHTML = `<div style="opacity:.75;font-size:13px;">Brak zapisów. Kliknij "+ Zapisz do historii".</div>`;
    return;
  }

  el.innerHTML = "";

  items.forEach(it => {
    const dt = new Date(it.ts).toLocaleString();
    const mode = it.result?.calc_mode === "offer" ? "OFFER" : "SUGGEST";
    const cost = it.result?.total_cost_eur ?? "—";
    const price = (it.result?.calc_mode === "offer" && it.result?.offer_price_eur > 0)
      ? it.result.offer_price_eur
      : (it.result?.suggested_price_eur ?? "—");
    const margin = it.result?.margin_eur ?? "—";

    const routeTxt = it.route?.origin && it.route?.destination
      ? `${it.route.origin} → ${it.route.destination}${(it.route.stops?.length ? ` (+${it.route.stops.length})` : "")}`
      : "—";

   const card = document.createElement("div");
    card.className = "historyItem";

    card.innerHTML = `
      <div class="historyTop">
        <label class="history-check" title="Zaznacz do sumowania kółka">
          <input type="checkbox" class="round-check" data-id="${it.id}" style="margin-right:8px;accent-color:var(--signal);width:15px;height:15px;">
        </label>
        <div style="flex:1">
          <div class="historyName">${escapeHtml(it.name)}</div>
          <div class="historyMeta">${dt}${it.client ? " • " + escapeHtml(it.client) : ""}</div>
        </div>
        <div class="badge">${mode}</div>
      </div>

      <div class="historyLine">${escapeHtml(routeTxt)}</div>
      ${it.note ? `<div class="historyMeta" style="margin-top:4px;">${escapeHtml(it.note)}</div>` : ""}

      <div class="historyBadges">
        <div class="badge">Koszt: <b>${cost}</b> €</div>
        <div class="badge">Cena: <b>${price}</b> €</div>
        <div class="badge">Marża: <b>${margin}</b> €</div>
      </div>

      <div class="historyBtns">
        <button type="button" class="btn secondary" data-act="load" data-id="${it.id}">⚡ Wczytaj</button>
        <button type="button" class="btn secondary" data-act="reload" data-id="${it.id}">🗺 Odśwież trasę</button>
        <button type="button" class="btn secondary" data-act="duplicate" data-id="${it.id}">Duplikuj</button>
        <button type="button" class="btn secondary" data-act="delete" data-id="${it.id}">Usuń</button>
      </div>
    `;

    el.appendChild(card);
  });

  // Pasek sumowania kółka
  let roundBar = document.getElementById("roundSummaryBar");
  if (!roundBar) {
    roundBar = document.createElement("div");
    roundBar.id = "roundSummaryBar";
    roundBar.style.cssText = "margin-top:12px;padding:14px;background:var(--panel);border:1px solid var(--signal);border-radius:12px;display:none;";
    el.parentNode.appendChild(roundBar);
  }

  el.addEventListener("change", function(e) {
    if (!e.target.classList.contains("round-check")) return;
    const checked = el.querySelectorAll(".round-check:checked");
    const btn = document.getElementById("roundSumBtn");
    if (btn) btn.disabled = checked.length < 2;
    if (btn) btn.textContent = checked.length >= 2
      ? `Podsumuj ${checked.length} tras (kółko)`
      : "Zaznacz min. 2 trasy";
  });

  el.querySelectorAll("button[data-act]").forEach(btn => {
    btn.onclick = () => {
      const act = btn.getAttribute("data-act");
      const id = btn.getAttribute("data-id");
      if (act === "load") return hRestore(id, false);
      if (act === "reload") return hRestore(id, true);
      if (act === "delete") return hDelete(id);
      if (act === "duplicate") return hDuplicate(id);
    };
  });

  // Przycisk "Podsumuj kółko"
  const btnWrap = document.getElementById("roundBtnWrap");
  if (btnWrap) {
    btnWrap.innerHTML = `<button id="roundSumBtn" type="button" class="btn btn-navy" style="width:100%;margin-top:10px;" disabled onclick="sumRound()">Zaznacz min. 2 trasy</button>`;
  }
}

// ===== SUMOWANIE KÓŁKA / rundy tras =====
function sumRound() {
  const el = document.getElementById("historyList");
  if (!el) return;
  const checked = [...el.querySelectorAll(".round-check:checked")];
  if (checked.length < 2) return;

  let sumKm = 0, sumCost = 0, sumPrice = 0, sumMargin = 0;
  const routes = [];

  checked.forEach(cb => {
    const id = cb.dataset.id;
    const it = hFind(id);
    if (!it) return;
    const r = it.result || {};
    sumKm     += Number(r.distance_km   || 0);
    sumCost   += Number(r.total_cost_eur|| 0);
    sumMargin += Number(r.margin_eur    || 0);
    const price = r.calc_mode === "offer"
      ? Number(r.offer_price_eur     || 0)
      : Number(r.suggested_price_eur || 0);
    sumPrice += price;
    if (it.route?.origin && it.route?.destination)
      routes.push(`${it.route.origin} → ${it.route.destination}`);
  });

  const avgEurKm   = sumKm   > 0 ? (sumCost / sumKm).toFixed(2)   : "—";
  const avgRateKm  = sumKm   > 0 ? (sumPrice/ sumKm).toFixed(2)   : "—";
  const marginPct  = sumPrice> 0 ? ((sumMargin/sumPrice)*100).toFixed(1) : "—";

  const bar = document.getElementById("roundSummaryBar");
  if (!bar) return;

  bar.style.display = "block";
  bar.innerHTML = `
    <div style="font-family:'IBM Plex Mono';font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--signal);margin-bottom:12px;">
      📊 Podsumowanie kółka (${checked.length} tras)
    </div>
    <div style="font-size:12px;color:var(--ink-faint);margin-bottom:10px;">${routes.join("  ·  ")}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div style="background:var(--panel-edge);border-radius:8px;padding:10px 12px;">
        <div style="font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.5px;">Łączny dystans</div>
        <div style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;">${Math.round(sumKm).toLocaleString()} km</div>
      </div>
      <div style="background:var(--panel-edge);border-radius:8px;padding:10px 12px;">
        <div style="font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.5px;">Łączny koszt</div>
        <div style="font-size:20px;font-weight:800;">${sumCost.toFixed(0)} €</div>
      </div>
      <div style="background:var(--panel-edge);border-radius:8px;padding:10px 12px;">
        <div style="font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.5px;">Łączny przychód</div>
        <div style="font-size:20px;font-weight:800;">${sumPrice.toFixed(0)} €</div>
      </div>
      <div style="background:var(--navy);border-radius:8px;padding:10px 12px;">
        <div style="font-size:11px;color:#9fb2d4;text-transform:uppercase;letter-spacing:.5px;">Łączna marża</div>
        <div style="font-size:20px;font-weight:800;color:#fff;">${sumMargin.toFixed(0)} € <span style="font-size:14px;opacity:.8;">(${marginPct}%)</span></div>
      </div>
    </div>
    <div style="display:flex;gap:16px;font-size:13px;color:var(--ink-soft);border-top:1px solid var(--panel-edge);padding-top:10px;">
      <span>Koszt/km: <b>${avgEurKm} €</b></span>
      <span>Stawka/km: <b>${avgRateKm} €</b></span>
      <span>Trasy: <b>${checked.length}</b></span>
    </div>
    <button type="button" onclick="document.getElementById('roundSummaryBar').style.display='none';document.querySelectorAll('.round-check').forEach(c=>c.checked=false);"
      style="margin-top:10px;background:none;border:none;font-size:12px;color:var(--ink-faint);cursor:pointer;">✕ Zamknij podsumowanie</button>
  `;
  try { bar.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch(e) {}
}

function hFind(id){
  try{ return JSON.parse(localStorage.getItem("ak_history_v1")||"[]").find(x=>x.id===id)||null; }catch{ return null; }
}

async function hDelete(id){
  await hDeleteItem(id);
  renderHistory();
}

async function hDuplicate(id){
  const it = hFind(id);
  if (!it) return;
  const copy = JSON.parse(JSON.stringify(it));
  copy.id = hId();
  copy.ts = Date.now();
  copy.name = it.name + " (kop.)";
  await hSaveItem(copy);
  renderHistory();
}

// 2 klikami: klik “Wczytaj” i koniec

function hRestore(id, refreshRoute = false){
  const it = hFind(id);
  if (!it) return;

  // 1️⃣ Przywróć pola kalkulatora
  const input = it.input || {};
  Object.entries(input).forEach(([k,v]) => {
    const el = document.getElementById(k);
    if (el != null) el.value = v;
  });

  // 2️⃣ Tryb + oferta
  const mode = it.result?.calc_mode || "suggest";
  if (typeof setCalcMode === "function") {
    setCalcMode(mode);
  } else {
    const hidden = document.getElementById("calc_mode");
    if (hidden) hidden.value = mode;
  }

  const offerEl = document.getElementById("offer_price_eur");
  if (offerEl) offerEl.value = (it.result?.offer_price_eur || "");

  // 3️⃣ Przywróć trasę do UI
  if (typeof setRouteToUI === "function") {
    setRouteToUI(it.route);
  }

  // 4️⃣ Przywróć myto geo (dla szybkiego trybu)
  window.lastRouteTollsGeo = it.tolls_geo || null;
  window.lastRouteTollsGeoAdj = it.tolls_geo_adj || null;
  window.lastRouteVignettes = it.vignettes || null;
  
  try{
  const tg = window.lastRouteTollsGeoAdj || window.lastRouteTollsGeo;
  const v = window.lastRouteVignettes;
  const base = tg?.total_eur != null ? Number(tg.total_eur) : 0;
  const add = v?.total_eur != null ? Number(v.total_eur) : 0;
  const te = document.getElementById("tolls_eur");
  if (te) te.value = (base + add).toFixed(2);
}catch(e){ console.warn("restore tolls+vignettes failed", e); }

  if (refreshRoute) {
    // 🗺 pełne przeliczenie trasy z backendu
	console.log("RESTORE route:", it.route);
	console.log("UI route now:", getRouteFromUI());
    setTimeout(() => getRoute(), 80);
  } else {
    // ⚡ szybkie przeliczenie tylko kosztów
    run();
  }
}

// proste escapowanie do HTML (żeby nie rozwalić DOM)
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

// odpal przy starcie
document.addEventListener("DOMContentLoaded", renderHistory);

(function initResizableLayout(){
  const root = document.documentElement;

  const splitLeft  = document.getElementById("splitLeft");
  const splitRight = document.getElementById("splitRight");
  const splitMapH  = document.getElementById("splitMapH");
  const infoEl     = document.getElementById("mapSizeInfo");

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // restore
  const savedLeft  = Number(localStorage.getItem("ui_leftW") || "");
  const savedRight = Number(localStorage.getItem("ui_rightW") || "");
  const savedMapH  = Number(localStorage.getItem("ui_mapH") || "");

  if (savedLeft)  root.style.setProperty("--leftW",  savedLeft + "px");
  if (savedRight) root.style.setProperty("--rightW", savedRight + "px");
  if (savedMapH)  root.style.setProperty("--mapH",   savedMapH + "px");

  function invalidateLeaflet(){
    if (window.map && typeof window.map.invalidateSize === "function") {
      setTimeout(() => window.map.invalidateSize(), 80);
    }
  }

  function updateInfo(){
    const leftW = getComputedStyle(root).getPropertyValue("--leftW").trim();
    const rightW = getComputedStyle(root).getPropertyValue("--rightW").trim();
    const mapH = getComputedStyle(root).getPropertyValue("--mapH").trim();
    if (infoEl) infoEl.textContent = `Układ: lewa ${leftW}, prawa ${rightW}, mapa wysokość ${mapH}`;
  }
  updateInfo();

  // Drag helper
  function drag(el, onMove){
    if (!el) return;
    let active = false;

    el.addEventListener("pointerdown", (e) => {
      active = true;
      el.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      document.body.style.cursor = getComputedStyle(el).cursor;
    });

    el.addEventListener("pointermove", (e) => {
      if (!active) return;
      onMove(e);
      updateInfo();
      invalidateLeaflet();
    });

    el.addEventListener("pointerup", () => {
      active = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    });
  }

  // 1) szerokość LEWEJ kolumny
  drag(splitLeft, (e) => {
    const rect = document.querySelector(".app3").getBoundingClientRect();
    const x = e.clientX - rect.left;

    const minLeft = Number(getComputedStyle(root).getPropertyValue("--minLeft")) || 320;
    const minMap  = Number(getComputedStyle(root).getPropertyValue("--minMap"))  || 420;

    // prawa część to: handle + mapa + handle + prawaKolumna
    const rightW = parseFloat(getComputedStyle(root).getPropertyValue("--rightW")) || 480;
    const handle = parseFloat(getComputedStyle(root).getPropertyValue("--handle")) || 10;
    const gap    = parseFloat(getComputedStyle(root).getPropertyValue("--gap")) || 12;

    const maxLeft = rect.width - (rightW + minMap + handle*2 + gap*4);
    const newLeft = clamp(x, minLeft, maxLeft);

    root.style.setProperty("--leftW", newLeft + "px");
    localStorage.setItem("ui_leftW", String(Math.round(newLeft)));
  });

  // 2) szerokość PRAWEJ kolumny
  drag(splitRight, (e) => {
    const rect = document.querySelector(".app3").getBoundingClientRect();
    const x = rect.right - e.clientX;

    const minRight = Number(getComputedStyle(root).getPropertyValue("--minRight")) || 340;
    const minMap   = Number(getComputedStyle(root).getPropertyValue("--minMap"))  || 420;

    const leftW = parseFloat(getComputedStyle(root).getPropertyValue("--leftW")) || 380;
    const handle = parseFloat(getComputedStyle(root).getPropertyValue("--handle")) || 10;
    const gap    = parseFloat(getComputedStyle(root).getPropertyValue("--gap")) || 12;

    const maxRight = rect.width - (leftW + minMap + handle*2 + gap*4);
    const newRight = clamp(x, minRight, maxRight);

    root.style.setProperty("--rightW", newRight + "px");
    localStorage.setItem("ui_rightW", String(Math.round(newRight)));
  });

  // 3) wysokość MAPY
  drag(splitMapH, (e) => {
    const mapEl = document.getElementById("map");
    if (!mapEl) return;

    const rect = mapEl.getBoundingClientRect();
    const newH = e.clientY - rect.top;

    const minMapH = Number(getComputedStyle(root).getPropertyValue("--minMapH")) || 320;
    const maxMapH = Math.max(minMapH, window.innerHeight - 220); // bezpieczny limit

    const h = clamp(newH, minMapH, maxMapH);
    root.style.setProperty("--mapH", Math.round(h) + "px");
    localStorage.setItem("ui_mapH", String(Math.round(h)));
  });

})();


/* =========================
   ALTERNATYWNE TRASY
========================= */
// Kolory jak Google Maps: główna ciemnoniebieska, alternatywne jaśniejsze
const ALT_COLORS = ["#1a73e8", "#6ba3f5", "#93bef7"];
const ALT_WEIGHTS = [6, 4, 4];
const ALT_OPACITY = [1, 0.65, 0.55];
const ALT_NAMES  = ["Trasa 1 (główna)", "Trasa 2 (alternatywna)", "Trasa 3 (alternatywna)"];
let altRouteLines = [];

function clearAltLines() {
  altRouteLines.forEach(l => { try { window.map?.removeLayer(l); } catch {} });
  altRouteLines = [];
}

function renderAlternativeRoutes(alternatives) {
  const panel = document.getElementById("altRoutesPanel");
  const list  = document.getElementById("altRoutesList");
  clearAltLines();

  if (!alternatives || alternatives.length <= 1) {
    if (panel) panel.style.display = "none";
    return;
  }

  if (panel) panel.style.display = "block";
  if (!list) return;
  list.innerHTML = "";

  alternatives.forEach((alt, idx) => {
    const color   = ALT_COLORS[idx]  || "#93bef7";
    const weight  = ALT_WEIGHTS[idx] || 4;
    const opacity = ALT_OPACITY[idx] || 0.55;
    const name    = ALT_NAMES[idx]   || `Trasa ${idx+1}`;

    // narysuj linię na mapie – alternatywy pod spodem, główna na wierzchu
    if (alt.geometry?.coordinates?.length > 1) {
      const latlngs = alt.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      const line = L.polyline(latlngs, { color, weight, opacity }).addTo(window.map);
      line.bindTooltip(name, { sticky: true });

      // kliknięcie na linię mapy = wybór trasy
      line.on("click", () => selectAltRoute(idx, alternatives, list));

      // kursor pointer na linii
      line.on("mouseover", function() { this.setStyle({ weight: weight + 2 }); });
      line.on("mouseout",  function() { this.setStyle({ weight: idx === window._selectedAltIdx ? weight + 2 : weight }); });

      altRouteLines.push(line);
    }

    // główna trasa na wierzchu
    if (idx === 0 && altRouteLines[0]) altRouteLines[0].bringToFront();

    // karta do wyboru
    const card = document.createElement("div");
    card.className = "altRouteCard" + (idx === 0 ? " selected" : "");
    card.style.borderLeftColor = color;
    card.style.borderLeftWidth = "4px";
    card.innerHTML = `
      <div class="altTitle" style="color:${color};">${name}</div>
      <div class="altMeta">
        📏 ${alt.distance_km} km &nbsp;•&nbsp;
        ⏱ ${alt.duration_h} h &nbsp;•&nbsp;
        💰 myto: ${alt.tolls_geo?.total_eur ?? "—"} €
      </div>
    `;

    card.addEventListener("click", () => selectAltRoute(idx, alternatives, list));

    list.appendChild(card);
  });
}

// Wybór trasy alternatywnej (z karty lub kliknięcia na mapie)
window._selectedAltIdx = 0;
function selectAltRoute(idx, alternatives, list) {
  window._selectedAltIdx = idx;
  const alt = alternatives[idx];

  // zaznacz kartę
  if (list) {
    list.querySelectorAll(".altRouteCard").forEach((c, i) => {
      c.classList.toggle("selected", i === idx);
    });
  }

  // kolory linii na mapie
  altRouteLines.forEach((l, i) => {
    const w = ALT_WEIGHTS[i] || 4;
    const o = ALT_OPACITY[i] || 0.55;
    l.setStyle({
      weight:  i === idx ? w + 2 : w,
      opacity: i === idx ? 1.0   : (i === 0 ? 0.4 : 0.3),
    });
    if (i === idx) l.bringToFront();
  });

  // wstaw dane wybranej trasy
  const baseInput = document.getElementById("base_distance_km");
  if (baseInput) baseInput.value = alt.distance_km;
  if (alt.tolls_geo) {
    window.lastRouteTollsGeo = alt.tolls_geo;
    window.lastRouteTollsGeoAdj = null;
    window.lastRouteVignettes = null;
  }

  updateTotalDistance();
  applyAutoFields();

  const rui = getRouteFromUI();
  const driverDays = +document.getElementById("driver_days")?.value || 0;
  const gbpEur = +document.getElementById("gbp_eur")?.value || 1.17;
  const kmPerDayUi = +document.getElementById("km_per_day")?.value || 0;
  const v = calcDailyVignettesFromGeo(alt.tolls_geo, driverDays, gbpEur, rui.origin + " " + rui.destination, alt.distance_km, kmPerDayUi);
  window.lastRouteVignettes = v;
  const tgAdj = applyVignetteOverrides(alt.tolls_geo, v);
  window.lastRouteTollsGeoAdj = tgAdj;
  const baseTolls = tgAdj?.total_eur != null ? Number(tgAdj.total_eur) : 0;
  document.getElementById("tolls_eur").value = (baseTolls + Number(v.total_eur || 0)).toFixed(2);
  run();
}

window.renderAlternativeRoutes = renderAlternativeRoutes;

// ============================================================
// PRESETY POJAZDÓW
// ============================================================
const VEHICLE_PRESETS = {
  tir40:  { label:"TIR 40t",        transportMode:"truck", grossWeightKg:40000, axleWeightKg:11500, heightCm:400, widthCm:255, lengthCm:1360, axleCount:5, info:"ciągnik 2 osie + naczepa 3 osie · 40 000 kg · 400×255×1360 cm" },
  jumbo:  { label:"Tandem Jumbo 120m³", transportMode:"truck", grossWeightKg:22000, axleWeightKg:10000, heightCm:300, widthCm:248, lengthCm:1500, axleCount:5, info:"solo 3 osie + przyczepa 2 osie · do 22 000 kg · 120 m³" },
  solo:   { label:"Solo (firanka)", transportMode:"truck", grossWeightKg:12000, axleWeightKg:7500,  heightCm:340, widthCm:248, lengthCm:720,  axleCount:3, info:"skrzynia/firanka solo · 3 osie · do 12 000 kg · 340×248×720 cm" },
  bus35:  { label:"Bus do 3,5t",    transportMode:"truck", grossWeightKg:3500,  axleWeightKg:1800,  heightCm:270, widthCm:210, lengthCm:600,  axleCount:2, info:"do 3 500 kg · 2 osie · 270×210×600 cm" },
  busBig: { label:"Bus pow. 3,5t",  transportMode:"truck", grossWeightKg:7500,  axleWeightKg:3500,  heightCm:330, widthCm:240, lengthCm:850,  axleCount:2, info:"3,5–7,5 t · 2 osie · 330×240×850 cm" },
  custom: { label:"Własne",         transportMode:"truck", grossWeightKg:null, info:"Wprowadź własne parametry" },
};

function applyVehiclePreset(preset) {
  const p = VEHICLE_PRESETS[preset];
  if (!p) return;

  const fields = document.getElementById("truckCustomFields");
  const info   = document.getElementById("vehiclePresetInfo");

  if (preset === "custom") {
    if (fields) fields.style.display = "grid";
  } else {
    if (fields) fields.style.display = "none";
    if (p.grossWeightKg) {
      document.getElementById("truck_grossWeight").value = p.grossWeightKg;
      document.getElementById("truck_axleWeight").value  = p.axleWeightKg;
      document.getElementById("truck_height").value      = p.heightCm;
      document.getElementById("truck_width").value       = p.widthCm;
      document.getElementById("truck_length").value      = p.lengthCm;
      document.getElementById("truck_axleCount").value   = p.axleCount;
    }
  }

  if (info) info.textContent = p.label + ": " + p.info;

  document.querySelectorAll(".vehicleBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.preset === preset);
    b.style.fontWeight  = b.dataset.preset === preset ? "700" : "";
    b.style.borderColor = b.dataset.preset === preset ? "var(--accent, #6d7cff)" : "";
  });

  // Odśwież trasę jeśli już była pobrana (żeby HERE przeliczył myto dla nowego pojazdu)
  const hasRoute = Number(document.getElementById("base_distance_km")?.value) > 0;
  if (hasRoute && typeof getRoute === "function") {
    const routeInfoEl = document.getElementById("routeInfo");
    if (routeInfoEl) routeInfoEl.textContent = "Przeliczam trasę dla nowego profilu pojazdu...";
    setTimeout(() => getRoute(), 100);
  }
}

// Podpięcie przycisków presetów
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".vehicleBtn").forEach(btn => {
    btn.addEventListener("click", () => applyVehiclePreset(btn.dataset.preset));
  });
  // Domyślnie TIR 40t
  applyVehiclePreset("tir40");
});


