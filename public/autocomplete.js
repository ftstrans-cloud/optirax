/* =========================
   AUTOCOMPLETE (Nominatim)
========================= */

let acDebounceTimer = null;
const acCache = {};

async function fetchSuggestions(query) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  if (acCache[q]) return acCache[q];

  try {
    const url = "/api/geocode?q=" + encodeURIComponent(q);
    const r = await fetch(url);
    const data = await r.json();
    const results = (data || []).map(x => ({
      label: x.display_name,
      short: buildShortLabel(x),
      lat: x.lat,
      lon: x.lon,
    }));
    acCache[q] = results;
    return results;
  } catch {
    return [];
  }
}

function buildShortLabel(x) {
  const a = x.address || {};
  const parts = [];
  const city = a.city || a.town || a.village || a.hamlet || a.county || "";
  const country = a.country || "";
  if (city) parts.push(city);
  if (a.state && a.state !== city) parts.push(a.state);
  if (country) parts.push(country);
  return parts.join(", ") || x.display_name.split(",").slice(0, 2).join(",");
}

function createDropdown() {
  const el = document.createElement("div");
  el.className = "ac-dropdown";
  el.style.cssText = `
    position:absolute; z-index:9999; left:0; right:0; top:100%;
    background:var(--panel2, #2b3658);
    border:1px solid rgba(255,255,255,.18);
    border-radius:10px; margin-top:3px;
    box-shadow:0 8px 32px rgba(0,0,0,.45);
    max-height:220px; overflow-y:auto;
    display:none;
  `;
  return el;
}

function showDropdown(dropdown, items, input) {
  dropdown.innerHTML = "";
  if (!items.length) { dropdown.style.display = "none"; return; }

  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "ac-item";
    row.style.cssText = `
      padding:9px 12px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.07);
      font-size:13px; line-height:1.35;
    `;
    row.innerHTML = `
      <div style="font-weight:600;">${escapeHtml(item.short)}</div>
      <div style="font-size:11px;opacity:.6;margin-top:2px;">${escapeHtml(item.label)}</div>
    `;
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      input.value = item.short;
      dropdown.style.display = "none";
    });
    row.addEventListener("mouseover", () => row.style.background = "rgba(255,255,255,.09)");
    row.addEventListener("mouseout",  () => row.style.background = "");
    dropdown.appendChild(row);
  });

  dropdown.style.display = "block";
}

function attachAutocomplete(input) {
  if (input._acAttached) return;
  input._acAttached = true;

  // wrapper musi mieć position:relative
  const wrapper = input.closest(".routeRow") || input.parentElement;
  wrapper.style.position = "relative";

  const dropdown = createDropdown();
  // wstawiamy po input wewnątrz wrappera
  input.insertAdjacentElement("afterend", dropdown);

  input.addEventListener("input", () => {
    clearTimeout(acDebounceTimer);
    const val = input.value.trim();
    if (val.length < 2) { dropdown.style.display = "none"; return; }
    acDebounceTimer = setTimeout(async () => {
      const items = await fetchSuggestions(val);
      showDropdown(dropdown, items, input);
    }, 280);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { dropdown.style.display = "none"; }
    if (e.key === "ArrowDown") {
      const first = dropdown.querySelector(".ac-item");
      if (first) first.focus();
      e.preventDefault();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => { dropdown.style.display = "none"; }, 180);
  });
}

// Podpina autocomplete do wszystkich inputów w routeList (teraz i przyszłych)
function attachAutocompleteToAll() {
  const list = document.getElementById("routeList");
  if (!list) return;
  list.querySelectorAll("input[type=text]").forEach(attachAutocomplete);
}

// MutationObserver – automatycznie podpina do nowych inputów
(function initAcObserver() {
  const list = document.getElementById("routeList");
  if (!list) {
    document.addEventListener("DOMContentLoaded", () => {
      const l = document.getElementById("routeList");
      if (l) observeList(l);
    });
    return;
  }
  observeList(list);
})();

function observeList(list) {
  attachAutocompleteToAll();
  const obs = new MutationObserver(() => attachAutocompleteToAll());
  obs.observe(list, { childList: true, subtree: true });
}



/* =========================
   WKLEJANIE Z GOOGLE MAPS
========================= */

function parseGoogleMapsUrl(url) {
  try {
    const str = (url || "").trim();
    if (!str) return null;

    // -------------------------------------------------------
    // FORMAT 1: /maps/dir/ORIGIN/STOP1/.../DESTINATION
    // np. google.com/maps/dir/Warszawa/Berlin/Hamburg
    // np. google.com/maps/dir/Warszawa,+Polska/Berlin,+Niemcy/
    // -------------------------------------------------------
    const dirMatch = str.match(/\/maps\/dir\/([^?#@]*)/);
    if (dirMatch) {
      const raw = dirMatch[1];
      const parts = raw
        .split("/")
        .map(s => decodeURIComponent(s).replace(/\+/g, " ").trim())
        .filter(s => s.length > 0 && !s.startsWith("@"));

      if (parts.length >= 2) {
        return {
          origin:      parts[0],
          destination: parts[parts.length - 1],
          stops:       parts.slice(1, -1),
        };
      }
      // Jeden punkt – może być samo „skąd"
      if (parts.length === 1) {
        return { origin: parts[0], destination: "", stops: [] };
      }
    }

    // -------------------------------------------------------
    // FORMAT 2: ?saddr=...&daddr=... (stary format)
    // np. maps.google.com/maps?saddr=Warszawa&daddr=Berlin
    // np. daddr może mieć +to: dla punktów pośrednich
    // -------------------------------------------------------
    let urlObj;
    try {
      urlObj = new URL(str.includes("://") ? str : "https://maps.google.com/" + str);
    } catch {
      urlObj = null;
    }

    if (urlObj) {
      const saddr = urlObj.searchParams.get("saddr");
      const daddr = urlObj.searchParams.get("daddr");
      if (saddr && daddr) {
        // Podziel PRZED dekodowaniem ('+to:' może być zakodowane różnie)
        const stops_raw = daddr.split(/(?:\+to:|%2Bto:|%20to:)/i)
          .map(s => decodeURIComponent(s.replace(/\+/g, " ")).trim())
          .filter(Boolean);
        return {
          origin:      decodeURIComponent(saddr.replace(/\+/g, " ")).trim(),
          destination: stops_raw[stops_raw.length - 1],
          stops:       stops_raw.slice(0, -1),
        };
      }

      // FORMAT 3: ?q=Warszawa (pojedyncze miejsce)
      const q = urlObj.searchParams.get("q");
      if (q) {
        return { origin: decodeURIComponent(q.replace(/\+/g, " ")).trim(), destination: "", stops: [] };
      }
    }

    // -------------------------------------------------------
    // FORMAT 4: /maps/place/NAZWA/@lat,lon/...
    // np. google.com/maps/place/Warszawa/@52.229,21.012,12z
    // -------------------------------------------------------
    const placeMatch = str.match(/\/maps\/place\/([^/@?#]+)/);
    if (placeMatch) {
      const name = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ").trim();
      if (name) return { origin: name, destination: "", stops: [] };
    }

    // -------------------------------------------------------
    // FORMAT 5: @lat,lon – same współrzędne w URL
    // np. google.com/maps/@52.2297,21.0122,15z
    // -------------------------------------------------------
    const coordMatch = str.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordMatch) {
      return {
        origin:      `${coordMatch[1]},${coordMatch[2]}`,
        destination: "",
        stops:       [],
      };
    }

    // -------------------------------------------------------
    // FORMAT 6: sam tekst „lat,lon" lub „lat lon" wklejony bezpośrednio
    // -------------------------------------------------------
    const bareCoord = str.match(/^(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)$/);
    if (bareCoord) {
      return {
        origin:      `${bareCoord[1]},${bareCoord[2]}`,
        destination: "",
        stops:       [],
      };
    }

    return null;
  } catch {
    return null;
  }
}

function pasteGoogleMaps() {
  const raw = (document.getElementById("gmapsInput")?.value || "").trim();
  if (!raw) { alert("Wklej link z Google Maps."); return; }

  const parsed = parseGoogleMapsUrl(raw);

  if (!parsed || !parsed.origin) {
    alert(
      "Nie rozpoznano formatu linku Google Maps.\n\n" +
      "Obsługiwane formaty:\n" +
      "• google.com/maps/dir/Warszawa/Berlin/Hamburg\n" +
      "• google.com/maps/dir/Warszawa,+Polska/Berlin,+Niemcy\n" +
      "• maps.google.com/?saddr=Warszawa&daddr=Berlin\n" +
      "• google.com/maps/place/Warszawa\n" +
      "• google.com/maps/@52.229,21.012,12z\n\n" +
      "Wskazówka: w Google Maps kliknij Udostępnij → Kopiuj link"
    );
    return;
  }

  // Wypełnij pola trasy
  if (typeof setRouteToUI === "function") {
    setRouteToUI(parsed);
  }

  document.getElementById("gmapsInput").value = "";
  document.getElementById("gmapsPasteBox").style.display = "none";

  // Pokaż co wczytano
  const info = document.getElementById("routeInfo");
  if (info) {
    const pts = [parsed.origin, ...parsed.stops, parsed.destination].filter(Boolean);
    if (pts.length >= 2) {
      info.textContent = '✅ Wczytano z Google Maps:\n' + pts.join(' → ') + '\n\nKliknij Pobierz km zeby pobrac trase.';
    } else if (pts.length === 1) {
      info.textContent = '✅ Wczytano punkt z Google Maps:\n' + pts[0] + '\n\nUzupelnij Dokad i kliknij Pobierz km.';
    }
  }
}

function toggleGmapsPaste() {
  const box = document.getElementById("gmapsPasteBox");
  if (!box) return;
  const isOpen = box.style.display !== "none";
  box.style.display = isOpen ? "none" : "block";
  if (!isOpen) setTimeout(() => document.getElementById("gmapsInput")?.focus(), 50);
}

window.pasteGoogleMaps = pasteGoogleMaps;
window.toggleGmapsPaste = toggleGmapsPaste;

/* =========================
   NLP PASTE – AI parser adresów
========================= */

function toggleNlpPaste() {
  const box = document.getElementById("nlpPasteBox");
  if (!box) return;
  // Zamknij Google Maps box jeśli otwarty
  const gmBox = document.getElementById("gmapsPasteBox");
  if (gmBox) gmBox.style.display = "none";

  const isOpen = box.style.display !== "none";
  box.style.display = isOpen ? "none" : "block";
  if (!isOpen) setTimeout(() => document.getElementById("nlpInput")?.focus(), 50);
}

async function parseNlpStops() {
  const text = document.getElementById("nlpInput")?.value?.trim();
  const status = document.getElementById("nlpStatus");
  const btn = document.querySelector("#nlpPasteBox .btn");

  if (!text) { if (status) status.textContent = "⚠️ Wklej najpierw tekst."; return; }

  if (status) status.textContent = "⏳ AI analizuje tekst...";
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/parse-stops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      if (status) status.textContent = "❌ " + (data.error || "Błąd parsowania");
      return;
    }

    if (!data.origin) {
      if (status) status.textContent = "❌ Nie udało się wyciągnąć adresów — spróbuj inaczej sformułować tekst.";
      return;
    }

    // Wstaw do UI trasy
    if (typeof setRouteToUI === "function") {
      setRouteToUI({
        origin:      data.origin,
        stops:       Array.isArray(data.stops) ? data.stops : [],
        destination: data.destination || "",
      });
    }

    // Podsumowanie
    const pts = [data.origin, ...(data.stops||[]), data.destination].filter(Boolean);
    if (status) status.textContent = `✅ Wczytano ${pts.length} punkt${pts.length === 1 ? "" : pts.length < 5 ? "y" : "ów"}: ${pts.join(" → ")}`;

    // Zamknij box
    document.getElementById("nlpPasteBox").style.display = "none";
    document.getElementById("nlpInput").value = "";

    // Pokaż info w routeInfo
    const info = document.getElementById("routeInfo");
    if (info) info.textContent = `✅ Trasa z AI:\n${pts.join(" → ")}\n\nKliknij 'Pobierz km' żeby pobrać trasę.`;

  } catch(err) {
    if (status) status.textContent = "❌ Błąd sieci: " + err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.toggleNlpPaste  = toggleNlpPaste;
window.parseNlpStops   = parseNlpStops;
