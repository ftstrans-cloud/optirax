import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { Resend } from "resend";

dotenv.config();

// ============================================================
// EMAIL NOTIFICATIONS (Resend)
// Zmienne: RESEND_API_KEY, NOTIFICATION_EMAIL, NOTIFICATION_FROM
// ============================================================
const RESEND_API_KEY     = process.env.RESEND_API_KEY || "";
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "kontakt@optirax.pl";
const NOTIFICATION_FROM  = process.env.NOTIFICATION_FROM  || "OPTIRAX <onboarding@resend.dev>";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!RESEND_API_KEY) {
  console.warn("⚠️  Brak RESEND_API_KEY – powiadomienia mailowe wyłączone");
} else {
  console.log("📧 Resend skonfigurowany – powiadomienia na:", NOTIFICATION_EMAIL);
}

/**
 * Wysyła powiadomienie do właściciela aplikacji.
 * Nie blokuje requesta — błąd loguje, nie rzuca dalej.
 * @param {string} subject - temat maila
 * @param {string} html    - treść HTML
 */
async function notifyOwner(subject, html) {
  if (!resend) return; // nie skonfigurowany – po prostu pomiń
  try {
    await resend.emails.send({
      from:    NOTIFICATION_FROM,
      to:      NOTIFICATION_EMAIL,
      subject: subject,
      html:    html,
    });
    console.log("📧 Wysłano powiadomienie:", subject);
  } catch (e) {
    console.error("📧 Błąd wysyłki maila:", e.message);
    // nie rzucamy dalej – mail jest "best effort"
  }
}

/** Formatuje datę dla maila */
function fmtDate(d = new Date()) {
  return d.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
}

// Klucze API – wczytane raz na starcie
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";

console.log("Supabase URL:", SUPABASE_URL ? SUPABASE_URL.slice(0,40)+"..." : "BRAK");
console.log("Supabase KEY:", SUPABASE_KEY ? SUPABASE_KEY.slice(0,20)+"..." : "BRAK");

console.log("🔥 OPTIRAX SERVER – HERE Routing API v8 🔥");

// ============================================================
// HERE API KEY
// Pobierz na: https://platform.here.com  (Base Plan, darmowy do 30k req/mies)
// ============================================================
const HERE_API_KEY = process.env.HERE_API_KEY || "";
if (!HERE_API_KEY) {
  console.warn("⚠️  Brak HERE_API_KEY w .env – routing używa OSRM + offline fallback");
}

// ============================================================
// ISO → polska nazwa wyświetlana w UI/PDF
// ============================================================
const ISO_TO_PL = {
  "POL":"Polska",     "PL":"Polska",
  "DEU":"Niemcy",     "DE":"Niemcy",
  "CZE":"Czechy",     "CZ":"Czechy",
  "AUT":"Austria",    "AT":"Austria",
  "ITA":"Włochy",     "IT":"Włochy",
  "FRA":"Francja",    "FR":"Francja",
  "BEL":"Belgia",     "BE":"Belgia",
  "NLD":"Holandia",   "NL":"Holandia",
  "SVK":"Słowacja",   "SK":"Słowacja",
  "HUN":"Węgry",      "HU":"Węgry",
  "SVN":"Słowenia",   "SI":"Słowenia",
  "HRV":"Chorwacja",  "HR":"Chorwacja",
  "GBR":"Wielka Brytania","GB":"Wielka Brytania",
  "CHE":"Szwajcaria", "CH":"Szwajcaria",
  "ROU":"Rumunia",    "RO":"Rumunia",
  "BGR":"Bułgaria",   "BG":"Bułgaria",
  "SRB":"Serbia",     "RS":"Serbia",
  "ESP":"Hiszpania",  "ES":"Hiszpania",
  "PRT":"Portugalia", "PT":"Portugalia",
  "SWE":"Szwecja",    "SE":"Szwecja",
  "DNK":"Dania",      "DK":"Dania",
  "NOR":"Norwegia",   "NO":"Norwegia",
  "FIN":"Finlandia",  "FI":"Finlandia",
  "LUX":"Luksemburg", "LU":"Luksemburg",
  "IRL":"Irlandia",   "IE":"Irlandia",
  "GRC":"Grecja",     "GR":"Grecja",
  "LTU":"Litwa",      "LT":"Litwa",
  "LVA":"Łotwa",      "LV":"Łotwa",
  "EST":"Estonia",    "EE":"Estonia",
};

// ============================================================
// STAWKI MYTO €/km  – fallback gdy brak HERE lub dla OSRM
// Kraje z winietą dzienną (NL, GB, CH) mają 0 – liczone osobno w app.js
// ============================================================
const TOLL_RATE = {
  "Polska":          0.16,
  "Niemcy":          0.35,
  "Czechy":          0.15,
  "Austria":         0.50,
  "Włochy":          0.20,
  "Francja":         0.40,
  "Belgia":          0.21,
  "Holandia":        0.00,   // winieta dzienna
  "Słowacja":        0.20,
  "Węgry":           0.55,
  "Słowenia":        0.20,
  "Chorwacja":       0.12,
  "Wielka Brytania": 0.00,   // winieta dzienna
  "Szwajcaria":      1.00,   // płaska stawka 40t, kraj wykluczony z HERE
  "Rumunia":         0.09,
  "Bułgaria":        0.08,
  "Serbia":          0.08,
  "Hiszpania":       0.18,
  "Portugalia":      0.18,
  "Szwecja":         0.00,
  "Dania":           0.00,
  "Norwegia":        0.00,
  "Finlandia":       0.00,
  "Luksemburg":      0.00,
  "Litwa":           0.00,
  "Łotwa":           0.00,
  "Estonia":         0.00,
  "Irlandia":        0.00,
  "Grecja":          0.07,
  // aliasy angielskie (gdy HERE zwróci EN zamiast PL)
  "United Kingdom":  0.00,
  "Netherlands":     0.00,
  "Germany":         0.35,
  "France":          0.40,
  "Italy":           0.20,
  "Belgium":         0.21,
  "Switzerland":     0.00,
  "Austria":         0.50,
  "Hungary":         0.55,
  "Czech Republic":  0.15,
  "Czechia":         0.15,
};

// ============================================================
// HELPERS
// ============================================================
const round2 = x => Math.round(Number(x) * 100) / 100;
const round1 = x => Math.round(Number(x) * 10) / 10;

function extractCountry(display) {
  if (!display) return "??";
  const parts = display.split(",").map(s => s.trim());
  return parts[parts.length - 1] || "??";
}

function getRouteScore(margin) {
  if (margin > 300) return { label: "🟢 Dobra", color: "#2ecc71" };
  if (margin >= 0)  return { label: "🟡 Średnia", color: "#f1c40f" };
  return { label: "🔴 Strata", color: "#e74c3c" };
}

// ============================================================
// FLEXIBLE POLYLINE DECODER  (format HERE Routing API v8)
// Spec: https://github.com/heremaps/flexible-polyline
// ============================================================
function decodeFlexiblePolyline(encoded) {
  if (!encoded) return [];

  const ENC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const DEC = {};
  for (let i = 0; i < ENC.length; i++) DEC[ENC[i]] = i;

  let i = 0;

  function readVarint() {
    let r = 0, s = 0, c;
    do {
      c = DEC[encoded[i++]];
      r |= (c & 0x1F) << s;
      s += 5;
    } while (c & 0x20);
    return r;
  }

  function toSigned(v) { return (v & 1) ? ~(v >>> 1) : (v >>> 1); }

  readVarint(); // version
  const hdr  = readVarint();
  const prec = hdr & 0xF;
  const dim  = (hdr >> 4) & 0x7;
  if (dim > 0) readVarint(); // precision3d

  const factor = Math.pow(10, prec);
  const pts = [];
  let lat = 0, lon = 0;

  while (i < encoded.length) {
    lat += toSigned(readVarint());
    lon += toSigned(readVarint());
    if (dim > 0) readVarint(); // 3rd dimension – ignorujemy
    pts.push([lat / factor, lon / factor]);
  }

  return pts;
}

// ============================================================
// HERE ROUTING API v8  – truck profile
// ============================================================
async function hereRoute(waypoints, truckParams = {}) {
  const {
    transportMode = "truck",
    grossWeightKg = 40000,
    axleWeightKg  = 11500,
    heightCm      = 400,
    widthCm       = 255,
    lengthCm      = 1360,
    axleCount     = 5,
    trailersCount = 1,
    currency      = "EUR",
    avoidCountries = [], // tablica kodów ISO-3 np. ["CHE","SRB"]
  } = truckParams;

  const origin      = `${waypoints[0][0]},${waypoints[0][1]}`;
  const destination = `${waypoints[waypoints.length-1][0]},${waypoints[waypoints.length-1][1]}`;
  const vias        = waypoints.slice(1,-1).map(([la,lo]) => `&via=${la},${lo}`).join("");
  const altParam    = waypoints.length === 2 ? "&alternatives=2" : "";

  // Dla busa: transportMode=bus, bez parametrów vehicle (HERE nie przyjmuje ich dla bus)
  const isBus = transportMode === "bus";
  const vehicleParams = isBus ? "" :
    `&vehicle[grossWeight]=${grossWeightKg}` +
    `&vehicle[weightPerAxle]=${axleWeightKg}` +
    `&vehicle[height]=${heightCm}` +
    `&vehicle[width]=${widthCm}` +
    `&vehicle[length]=${lengthCm}` +
    `&vehicle[axleCount]=${axleCount}` +
    `&vehicle[trailersCount]=${trailersCount}`;

  // Omijanie krajów – HERE v8: avoid[countries]=CHE,SRB
  // HERE v8 exclude[countries] wymaga kodów ISO-3166-1 alpha-3 (3 litery: CHE, SRB...)
  const ISO2_TO_3 = {
    CH:"CHE", RS:"SRB", MK:"MKD", BA:"BIH", ME:"MNE",
    AL:"ALB", MD:"MDA", BY:"BLR", UA:"UKR", TR:"TUR",
  };
  const avoidParam = avoidCountries.length > 0
    ? "&exclude[countries]=" + avoidCountries.map(x => ISO2_TO_3[x] || x).join(",")
    : "";
  if (avoidCountries.length > 0) console.log("Wykluczam kraje:", avoidParam);

  const url =
    `https://router.hereapi.com/v8/routes?apiKey=${HERE_API_KEY}` +
    `&transportMode=${transportMode}&origin=${origin}&destination=${destination}` +
    vias + altParam +
    `&return=polyline,summary,tolls&currency=${currency}` +
    vehicleParams + avoidParam;

  console.log("HERE URL (bez klucza):", url.replace(HERE_API_KEY, "KEY").slice(0, 300));

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text();
    console.error("HERE ERROR:", r.status, txt.slice(0, 400));
    throw new Error(`HERE ${r.status}: ${txt.slice(0,300)}`);
  }
  const data = await r.json();
  console.log("HERE OK – routes:", data.routes?.length, "| sections[0] polyline:", !!data.routes?.[0]?.sections?.[0]?.polyline);
  return data;
}

function parseHereRoute(hereData, routeIdx = 0) {
  const routes = hereData?.routes;
  if (!routes?.length) return null;
  const route    = routes[routeIdx] || routes[0];
  const sections = route?.sections || [];
  if (!sections.length) return null;

  // Dystans i czas
  let totalLengthM = 0, totalDurationS = 0;
  sections.forEach(s => {
    totalLengthM   += s.summary?.length   || 0;
    totalDurationS += s.summary?.duration || 0;
  });
  const distance_km = round1(totalLengthM / 1000);
  const duration_h  = round2(totalDurationS / 3600);

  // Geometria – flexible polyline → GeoJSON [lon,lat]
  const allCoords = [];
  sections.forEach(s => {
    if (s.polyline) {
      decodeFlexiblePolyline(s.polyline).forEach(([la,lo]) => allCoords.push([lo, la]));
    }
  });
  const geometry = { type: "LineString", coordinates: allCoords };
  console.log("HERE geometry coords:", allCoords.length, "| distance:", distance_km, "km");
  if (allCoords.length > 0) {
    console.log("HERE first coord:", allCoords[0], "last:", allCoords[allCoords.length-1]);
  }

  // Myto z HERE per-section
  // NLD – pomijamy całkowicie, bo do lipca 2025 obowiązuje winieta dzienna 12€
  // która zastępuje wszystkie opłaty drogowe. HERE błędnie sumuje bramki A2/A20.
  // NLD jest liczone przez calcDailyVignettesFromGeo w app.js.
  const SKIP_COUNTRIES = new Set(["NLD", "CHE"]);

  const tollCostByCode = {};
  // Deduplikacja: dla tego samego systemu opłat (np. A2 Autostrada Wielkopolska)
  // HERE zwraca osobny wpis per węzeł — sumujemy TYLKO raz per system per kraj
  const seenTollSystems = new Set();

  sections.forEach(section => {
    (section.tolls || []).forEach(toll => {
      const code = toll.countryCode || "??";
      if (SKIP_COUNTRIES.has(code)) return;

      // Klucz deduplikacji: kraj + nazwa systemu
      const sysKey = `${code}::${toll.tollSystem || toll.name || "?"}`;

      if (!tollCostByCode[code]) tollCostByCode[code] = 0;

      // Najtańszy fare per toll
      let cheapestEur = Infinity;
      (toll.fares || []).forEach(fare => {
        const eur =
          fare.price?.currency === "EUR"          ? (fare.price.value || 0) :
          fare.convertedPrice?.currency === "EUR" ? (fare.convertedPrice.value || 0) : 0;
        if (eur > 0 && eur < cheapestEur) cheapestEur = eur;
      });

      if (cheapestEur === Infinity) return;

      // Dla KONCESYJNYCH autostrad (A2 Wlkp, A4 Stalexport) — płacimy raz za całą trasę,
      // nie per węzeł. Deduplikuj po nazwie systemu.
      const isConcession = /autostrada|stalexport|eurotoll/i.test(sysKey);
      if (isConcession) {
        if (seenTollSystems.has(sysKey)) return; // już dodano
        seenTollSystems.add(sysKey);
      }

      tollCostByCode[code] += cheapestEur;

      if (code === "POL" || code === "GBR") {
        const fares = (toll.fares||[]).map(f => `${f.name||""} ${f.price?.value||""}${f.price?.currency||""} (${f.convertedPrice?.value||""}EUR)`).join(" | ");
        console.log(`  [${code}] ${toll.tollSystem||toll.name||"?"} → ${isConcession&&seenTollSystems.has(sysKey)?"SKIP":"ADD"} ${cheapestEur.toFixed(2)}€`);
      }
    });
  });
  console.log("HERE tollCostByCode:", JSON.stringify(tollCostByCode));

  let by_country, total_eur;

  if (Object.keys(tollCostByCode).length > 0) {
    // HERE zwróciło rzeczywiste myto — km per kraj z geometrii (ray-casting)
    const geoTolls = tollsFromGeometryFallback(geometry);
    const geoByName = {};
    geoTolls.by_country.forEach(x => { geoByName[x.country] = x.km; });

    by_country = Object.entries(tollCostByCode)
      .map(([code, cost_eur]) => {
        const name = ISO_TO_PL[code] || code;
        const km = geoByName[name] || round1(distance_km / Object.keys(tollCostByCode).length);
        return {
          country: name,
          km,
          rate_eur_per_km: km > 0 ? round2(cost_eur / km) : 0,
          cost_eur: round2(cost_eur),
          source: "HERE",
        };
      })
      .sort((a,b) => b.cost_eur - a.cost_eur);

    // Dodaj NL z geometrii (km) nawet gdy pomijamy myto HERE —
    // potrzebne do kalkulacji winiety dziennej w app.js
    if (geoByName["Holandia"] && !by_country.find(x => x.country === "Holandia")) {
      by_country.push({
        country: "Holandia",
        km: geoByName["Holandia"],
        rate_eur_per_km: 0,
        cost_eur: 0,
        source: "geo-only", // tylko km, koszt przez winietę
      });
    }

    // Dodaj Szwajcarię z geometrii — tymczasowo 1.00 EUR/km dla 40t (kraj wykluczony z HERE)
    if (geoByName["Szwajcaria"] && !by_country.find(x => x.country === "Szwajcaria")) {
      const cheKm = geoByName["Szwajcaria"];
      const cheRate = 1.00;
      by_country.push({
        country: "Szwajcaria",
        km: cheKm,
        rate_eur_per_km: cheRate,
        cost_eur: round2(cheKm * cheRate),
        source: "geo-flat",
      });
    }

    // Dodaj Hiszpanię z geometrii jeśli HERE nie zwrócił — fallback na średnią stawkę
    if (geoByName["Hiszpania"] && !by_country.find(x => x.country === "Hiszpania")) {
      const espKm = geoByName["Hiszpania"];
      const espRate = TOLL_RATE["Hiszpania"] ?? 0.18;
      by_country.push({
        country: "Hiszpania",
        km: espKm,
        rate_eur_per_km: espRate,
        cost_eur: round2(espKm * espRate),
        source: "geo-fallback",
      });
    }

    console.log("by_country debug:", JSON.stringify(by_country.map(x => `${x.country}:${x.km}km/${x.cost_eur}€/${x.source}`)));
    console.log("geoByName keys:", Object.keys(geoByName));

    total_eur = round2(by_country.reduce((s,x) => s + x.cost_eur, 0));
  } else {
    // HERE nie zwróciło myto (np. trasa multi bez toll sections) – fallback offline
    console.log("HERE: brak toll sections, używam offline fallback dla geometrii HERE");
    const fallback = tollsFromGeometryFallback(geometry);
    by_country = fallback.by_country;
    total_eur  = fallback.total_eur;
  }

  return { distance_km, duration_h, geometry, tolls_geo: { total_eur, by_country } };
}

// ============================================================
// OSRM + OFFLINE FALLBACK  (bez Turf.js – własny ray-casting)
// ============================================================
const EU_A3 = new Set([
  // UE
  "AUT","BEL","BGR","HRV","CYP","CZE","DNK","EST","FIN","FRA","DEU","GRC",
  "HUN","IRL","ITA","LVA","LTU","LUX","MLT","NLD","POL","PRT","ROU","SVK",
  "SVN","ESP","SWE","GBR",
  // poza-UE Europa (transport)
  "CHE","NOR","SRB","BIH","MKD","MNE","ALB","LIE","TUR","UKR","BLR","MDA",
  "ISL","XKX",
]);
let countryFeatures = [];

function loadBorders() {
  try {
    const fp = path.join(process.cwd(), "data", "europe_countries.geojson");
    if (!fs.existsSync(fp)) { console.warn("⚠️  Brak europe_countries.geojson"); return; }
    const geo = JSON.parse(fs.readFileSync(fp, "utf8"));
    countryFeatures = (geo?.features || []).filter(f => EU_A3.has(f?.id));
    console.log("✅ Borders loaded:", countryFeatures.length, "krajów");
  } catch(e) { console.warn("⚠️  loadBorders:", e.message); }
}

function haversineKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLat = r(b.lat-a.lat), dLon = r(b.lon-a.lon);
  const h = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointInPolygon(lat, lon, geom) {
  if (!geom?.coordinates) return false;
  const rings = geom.type === "MultiPolygon" ? geom.coordinates.flat(1) : geom.coordinates;
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length-1; i < ring.length; j = i++) {
      const [xi,yi] = ring[i], [xj,yj] = ring[j];
      if (((yi>lat) !== (yj>lat)) && (lon < (xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside;
    }
    if (inside) return true;
  }
  return false;
}

function countryIso3(lat, lon) {
  for (const f of countryFeatures) {
    if (pointInPolygon(lat, lon, f.geometry)) return f.id || "???";
  }
  return "???";
}

const ISO3_TO_NAME = {
  POL:"Polska",CZE:"Czechy",DEU:"Niemcy",AUT:"Austria",ITA:"Włochy",
  SVK:"Słowacja",HUN:"Węgry",SVN:"Słowenia",FRA:"Francja",BEL:"Belgia",
  NLD:"Holandia",GBR:"Wielka Brytania",ESP:"Hiszpania",PRT:"Portugalia",
  ROU:"Rumunia",BGR:"Bułgaria",HRV:"Chorwacja",SWE:"Szwecja",DNK:"Dania",
  NOR:"Norwegia",FIN:"Finlandia",LUX:"Luksemburg",LTU:"Litwa",LVA:"Łotwa",
  EST:"Estonia",IRL:"Irlandia",GRC:"Grecja",CHE:"Szwajcaria",SRB:"Serbia",
};

function tollsFromGeometryFallback(geometry) {
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return { total_eur: 0, by_country: [] };

  const step = Math.max(1, Math.floor(coords.length / 500));
  const samples = [];
  for (let i = 0; i < coords.length; i += step) samples.push({ lat: coords[i][1], lon: coords[i][0] });

  const kmByIso3 = {};
  for (let i = 0; i < samples.length-1; i++) {
    const iso3 = countryIso3(samples[i].lat, samples[i].lon);
    kmByIso3[iso3] = (kmByIso3[iso3] || 0) + haversineKm(samples[i], samples[i+1]);
  }

  let total = 0;
  const by_country = Object.entries(kmByIso3)
    .filter(([iso3,km]) => iso3 !== "???" && km > 0.2)
    .map(([iso3,km]) => {
      const name = ISO3_TO_NAME[iso3] || iso3;
      const rate = TOLL_RATE[name] ?? 0;
      const cost = km * rate;
      total += cost;
      return { country:name, km:round1(km), rate_eur_per_km:rate, cost_eur:round2(cost), source:"OSRM+offline" };
    })
    .sort((a,b) => b.km - a.km);

  return { total_eur:round2(total), by_country };
}

async function osrmFetch(coordsStr, alternatives=false) {
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&alternatives=${alternatives}&steps=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("OSRM failed: " + r.status);
  const data = await r.json();
  return alternatives ? (data?.routes || []) : (data?.routes?.[0] || null);
}

// ============================================================
// MASTER ROUTE  – HERE lub OSRM
// ============================================================
async function getRouteData(geocodedPoints, truckParams={}, alternatives=false) {
  if (HERE_API_KEY) {
    try {
      const waypoints = geocodedPoints.map(p => [p.lat, p.lon]);
      const hereData  = await hereRoute(waypoints, truckParams);
      const routes    = hereData?.routes || [];
      if (!routes.length) throw new Error("HERE: 0 tras");

      if (alternatives && routes.length > 1) {
        return routes.map((_,i) => parseHereRoute(hereData,i)).filter(Boolean);
      }
      const parsed = parseHereRoute(hereData, 0);
      if (!parsed) throw new Error("HERE: błąd parsowania");
      return parsed;
    } catch(err) {
      console.warn("⚠️  HERE fallback OSRM:", err.message);
    }
  }

  // OSRM fallback
  const coordsStr = geocodedPoints.map(p => `${p.lon},${p.lat}`).join(";");
  if (alternatives) {
    const osrmRoutes = await osrmFetch(coordsStr, true);
    return osrmRoutes.slice(0,3).map(r => ({
      distance_km: round1(r.distance/1000),
      duration_h:  round2(r.duration/3600),
      geometry:    r.geometry,
      tolls_geo:   tollsFromGeometryFallback(r.geometry),
    }));
  }
  const r = await osrmFetch(coordsStr, false);
  if (!r) throw new Error("OSRM: brak trasy");
  return {
    distance_km: round1(r.distance/1000),
    duration_h:  round2(r.duration/3600),
    geometry:    r.geometry,
    tolls_geo:   tollsFromGeometryFallback(r.geometry),
  };
}

// ============================================================
// GEOCODING – Nominatim
// ============================================================
const geoCache = new Map();

async function geocode(q) {
  const key = (q || "").trim();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key);

  // SHORTCUT: jeśli wejście to "lat,lon" (coords z Google Maps URL data block)
  // to nie pytaj Nominatim - po prostu użyj coords bezpośrednio
  const coordsMatch = key.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
  if (coordsMatch) {
    const lat = Number(coordsMatch[1]);
    const lon = Number(coordsMatch[2]);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      const out = { lat, lon, display: `${lat.toFixed(6)}, ${lon.toFixed(6)}` };
      geoCache.set(key, out);
      console.log(`[geocode] coords passthrough: ${key}`);
      return out;
    }
  }

  // Mapowanie polskich nazw krajów na angielskie (Nominatim lepiej rozumie EN)
  const PL_TO_EN = {
    "Hiszpania":"Spain","Włochy":"Italy","Niemcy":"Germany","Francja":"France",
    "Belgia":"Belgium","Holandia":"Netherlands","Czechy":"Czechia","Słowacja":"Slovakia",
    "Austria":"Austria","Szwajcaria":"Switzerland","Wielka Brytania":"United Kingdom",
    "Anglia":"England","Portugalia":"Portugal","Dania":"Denmark","Szwecja":"Sweden",
    "Norwegia":"Norway","Finlandia":"Finland","Rumunia":"Romania","Bułgaria":"Bulgaria",
    "Chorwacja":"Croatia","Słowenia":"Slovenia","Węgry":"Hungary","Grecja":"Greece",
    "Serbia":"Serbia","Polska":"Poland","Estonia":"Estonia","Łotwa":"Latvia","Litwa":"Lithuania"
  };

  // Wyczyść typowe człony administracyjne (PL/EN/IT/DE/FR/ES)
  const cleanAddress = (s) => {
    let r = s;
    // Polskie nazwy krajów → angielskie
    for (const [pl, en] of Object.entries(PL_TO_EN)) {
      r = r.replace(new RegExp(`\\b${pl}\\b`, "gi"), en);
    }
    return r
      .replace(/\bProvincia\s+di\b/gi, "")
      .replace(/\bProwincja\s+\w+/gi, "")        // "Prowincja Livorno"
      .replace(/\bKreis\b|\bLandkreis\b/gi, "")
      .replace(/\bComarca\b/gi, "")
      .replace(/\bGmina\b|\bPowiat\b/gi, "")
      .replace(/\bDépartement\b/gi, "")
      .replace(/\bDistrict\b/gi, "")
      .replace(/\bCounty\b/gi, "")
      .replace(/\bregion\s+\w+/gi, "")
      .replace(/\bWspólnota\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/,\s*,/g, ",")
      .trim();
  };

  // Strip ulicy z numerami: "Carrer de la Terra Alta, 32, 38, 08211 Castellar"
  // → "Castellar" (od pierwszego elementu który nie jest liczbą / ulicą / kodem)
  const stripStreet = (s) => {
    const parts = s.split(",").map(p => p.trim()).filter(Boolean);
    // Usuń elementy które są: same cyfry, kod pocztowy (5 cyfr), zaczynają od ulicy
    const cleaned = parts.filter(p => {
      if (/^\d+$/.test(p)) return false;                          // czysty numer
      if (/^\d{2,5}([-\s]\w+)?$/.test(p)) return false;            // 08211 / 08211 Castellar
      if (/^(Carrer|Calle|Avenida|Avinguda|Via|Strasse|Rue|ul\.?|ulica|Nave|s\/n)\b/i.test(p)) return false;
      return true;
    });
    return cleaned.join(", ");
  };

  // Lista kandydatów do prób:
  const candidates = [key];                                        // 1. oryginał
  const cleaned = cleanAddress(key);
  if (cleaned !== key) candidates.push(cleaned);                   // 2. po cleaning

  const noStreet = stripStreet(cleaned);
  if (noStreet && noStreet !== cleaned) candidates.push(noStreet); // 3. bez ulicy

  // 4. ostatnie 2-3 człony (miasto + region + kraj)
  const parts = noStreet.split(",").map(s => s.trim()).filter(Boolean);
  for (let i = parts.length; i >= 1; i--) {
    const sub = parts.slice(Math.max(0, parts.length - i)).join(", ");
    if (!candidates.includes(sub) && sub.length > 2) candidates.push(sub);
  }

  // 5. od prawej (od kraju) skracaj
  const partsFull = key.split(",").map(s => s.trim()).filter(Boolean);
  for (let i = partsFull.length - 1; i >= 1; i--) {
    const shorter = partsFull.slice(0, i).join(", ");
    if (!candidates.includes(shorter)) candidates.push(shorter);
  }

  for (const candidate of candidates) {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(candidate);
    try {
      const r = await fetch(url, { headers: { "User-Agent": "optirax-kalkulator/2.0", "Accept-Language": "pl,en" } });
      if (!r.ok) continue;
      const data = await r.json();
      if (data?.length) {
        console.log(`[geocode] "${key.slice(0,40)}" → matched via "${candidate.slice(0,40)}"`);
        const out = { lat: Number(data[0].lat), lon: Number(data[0].lon), display: data[0].display_name };
        geoCache.set(key, out);
        return out;
      }
    } catch(e) { continue; }
  }

  console.log(`[geocode] FAILED: "${key.slice(0,80)}"`);
  return null;
}

// ============================================================
// OPENAI
// ============================================================
console.log("OPENAI KEY START:", process.env.OPENAI_API_KEY?.slice(0,12));

let client = null;
if (process.env.OPENAI_API_KEY) {
  try {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("✅ OpenAI client initialized");
  } catch(err) { console.warn("⚠️  OpenAI init error:", err.message); }
} else {
  console.warn("⚠️  Brak OPENAI_API_KEY – AI report disabled");
}

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ============================================================
// AUTH MIDDLEWARE – weryfikacja JWT Supabase
// ============================================================
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Brak tokenu autoryzacji" });

  try {
    // Weryfikuj token przez Supabase API
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return res.status(401).json({ error: "Nieprawidłowy token" });
    const user = await r.json();
    req.user = user;
    req.userId = user.id;
    next();
  } catch(e) {
    return res.status(401).json({ error: "Błąd weryfikacji tokenu" });
  }
}

// Sprawdź czy trial aktywny
async function requireActiveSubscription(req, res, next) {
  try {
    // Użyj tokenu usera (nie anon key) żeby ominąć RLS
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${req.userId}&select=plan,trial_ends_at,is_active`, {
      headers: {
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${token}`,
        "Accept":        "application/json",
      },
    });
    const data = await r.json();
    const profile = Array.isArray(data) ? data[0] : null;

    if (!profile) return next(); // brak profilu = przepuść (nowy user)
    if (!profile.is_active) {
      return res.status(403).json({ error: "Konto nieaktywne", code: "INACTIVE" });
    }
    if (profile.plan === "trial" && profile.trial_ends_at && new Date(profile.trial_ends_at) < new Date()) {
      return res.status(403).json({ error: "Trial wygasł", code: "TRIAL_EXPIRED" });
    }
    req.userPlan = profile.plan;
    next();
  } catch(e) {
    next(); // przy błędzie przepuść
  }
}

// Admin check
async function requireAdmin(req, res, next) {
  try {
    const data = await sbFetch("profiles", "GET", null,
      `?id=eq.${req.userId}&select=is_admin`);
    if (!data?.[0]?.is_admin) return res.status(403).json({ error: "Brak uprawnień admina" });
    next();
  } catch(e) {
    return res.status(403).json({ error: "Brak uprawnień" });
  }
}

app.get("/api/health", (req, res) => res.json({
  ok: true,
  ts: new Date().toISOString(),
  hereApiKey: HERE_API_KEY ? "set" : "missing",
  routingEngine: HERE_API_KEY ? "HERE Routing API v8 (truck ✅)" : "OSRM + offline fallback",
}));

// Publiczny endpoint z kluczem HERE do tile'ów mapy (tylko klucz map tiles, nie routing)
app.get("/api/config", (req, res) => res.json({
  hereApiKey: HERE_API_KEY || "",
}));

// Proxy do Nominatim (autocomplete adresów) - omija CORS
app.get("/api/geocode", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json([]);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "OPTIRAX/1.0 (kontakt@optirax.pl)" }
    });
    if (!r.ok) return res.status(r.status).json({ error: `Nominatim ${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Rozwija skrócone linki (maps.app.goo.gl, goo.gl/maps) do pełnego URL
app.post("/api/expand-url", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Brak URL" });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Nieprawidłowy URL" });

    // Google Maps wymaga przeglądarkowego User-Agent
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pl,en;q=0.9",
    };

    let currentUrl = url;
    let hops = 0;
    while (hops < 10) {
      const r = await fetch(currentUrl, { method: "GET", redirect: "manual", headers });
      const loc = r.headers.get("location");
      console.log(`[expand-url] hop ${hops}: ${r.status} -> ${loc?.slice(0,100) || "(no redirect)"}`);
      if (loc && (r.status >= 300 && r.status < 400)) {
        currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
        hops++;
      } else if (r.status === 200) {
        // Dla niektórych skróconych linków Google odpowiada HTML z meta redirect
        const html = await r.text();
        // Szukaj prawdziwego URL w HTML (Google embedduje go w meta refresh / og:url / canonical)
        const metaMatch = html.match(/<meta[^>]+(?:url=|content=")([^">]*\/maps\/[^">]+)/i);
        if (metaMatch) {
          currentUrl = metaMatch[1].replace(/&amp;/g, "&");
          console.log(`[expand-url] meta redirect found: ${currentUrl.slice(0,100)}`);
        }
        break;
      } else {
        break;
      }
    }
    console.log(`[expand-url] final: ${currentUrl.slice(0,150)}`);
    res.json({ url: currentUrl });
  } catch(e) {
    console.error("[expand-url] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// AUTH ENDPOINTS
// ============================================================

// Rejestracja
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, full_name, company, plan } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email i hasło są wymagane" });

    // Walidacja planu (whitelist)
    const validPlans = ["solo", "pro", "team"];
    const selectedPlan = validPlans.includes(plan) ? plan : null;

    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        data: { full_name, company, selected_plan: selectedPlan }
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(400).json({ error: data.msg || data.error_description || "Błąd rejestracji" });

    // Powiadomienie do właściciela (nie blokuje rejestracji)
    const planLabel = {
      solo: "Solo (79 zł)",
      pro:  "Pro (149 zł)",
      team: "Team (299 zł)",
    }[selectedPlan] || "Nie wybrał planu z landingu";

    notifyOwner(
      `🎉 Nowa rejestracja: ${email}`,
      `
        <h2>Nowa rejestracja w OPTIRAX</h2>
        <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:6px 12px;color:#666;">Email:</td><td style="padding:6px 12px;"><b>${email}</b></td></tr>
          <tr><td style="padding:6px 12px;color:#666;">Imię i nazwisko:</td><td style="padding:6px 12px;">${full_name || "—"}</td></tr>
          <tr><td style="padding:6px 12px;color:#666;">Firma:</td><td style="padding:6px 12px;">${company || "—"}</td></tr>
          <tr><td style="padding:6px 12px;color:#666;">Wybrany plan:</td><td style="padding:6px 12px;"><b>${planLabel}</b></td></tr>
          <tr><td style="padding:6px 12px;color:#666;">Data:</td><td style="padding:6px 12px;">${fmtDate()}</td></tr>
        </table>
        <p style="font-size:13px;color:#666;margin-top:16px;">
          ⚠️ To rejestracja — nie wiadomo czy aktywował konto klikając link w mailu.<br>
          Jeśli za 24h nie przyjdzie mail "pierwsze logowanie" — warto napisać follow-up.
        </p>
      `
    );

    res.json({ ok: true, message: "Sprawdź email aby aktywować konto" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Logowanie
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(401).json({ error: "Nieprawidłowy email lub hasło" });

    // Pobierz profil
    const profile = await sbFetch("profiles", "GET", null, `?id=eq.${data.user.id}`);

    // Powiadomienie o PIERWSZYM logowaniu (aktywacja konta)
    // Detekcja: jeśli w user_metadata nie ma flagi first_login_at — to pierwsze logowanie.
    const meta = data.user?.user_metadata || {};
    if (!meta.first_login_at) {
      // Ustaw flagę w Supabase (żeby kolejne logowania nie triggerowały maila)
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: "PUT",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${data.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: { ...meta, first_login_at: new Date().toISOString() }
          }),
        });
      } catch(e) {
        console.error("Nie udało się ustawić first_login_at:", e.message);
      }

      const planLabel = {
        solo: "Solo (79 zł)",
        pro:  "Pro (149 zł)",
        team: "Team (299 zł)",
      }[meta.selected_plan] || "Bez planu z landingu";

      notifyOwner(
        `✅ Aktywacja konta: ${email}`,
        `
          <h2>Pierwsze logowanie w OPTIRAX</h2>
          <p style="font-family:sans-serif;font-size:14px;">User <b>${email}</b> aktywował konto i zalogował się po raz pierwszy. Konto jest realne — można zacząć follow-up.</p>
          <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:6px 12px;color:#666;">Email:</td><td style="padding:6px 12px;"><b>${email}</b></td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Imię i nazwisko:</td><td style="padding:6px 12px;">${meta.full_name || "—"}</td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Firma:</td><td style="padding:6px 12px;">${meta.company || "—"}</td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Wybrany plan:</td><td style="padding:6px 12px;"><b>${planLabel}</b></td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Data:</td><td style="padding:6px 12px;">${fmtDate()}</td></tr>
          </table>
          <p style="font-size:13px;color:#666;margin-top:16px;">
            💡 Sugestia: napisz personalny mail "Witaj w OPTIRAX, jakie trasy najczęściej liczysz?" za 2-3h.
          </p>
        `
      );
    }

    res.json({
      token:        data.access_token,
      refresh_token: data.refresh_token,
      user:         data.user,
      profile:      profile?.[0] || null,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Odśwież token
app.post("/api/auth/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(401).json({ error: "Token wygasł, zaloguj się ponownie" });
    res.json({ token: data.access_token, refresh_token: data.refresh_token });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Pobierz dane usera używając access_token (po aktywacji konta z linku w mailu)
app.post("/api/auth/me-from-token", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Brak tokenu" });

    // Pobierz usera używając tokenu
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return res.status(401).json({ error: "Nieprawidłowy lub wygasły token" });
    const user = await r.json();

    // Pobierz profil
    const profileData = await sbFetch("profiles", "GET", null, `?id=eq.${user.id}`);

    res.json({ user, profile: profileData?.[0] || null });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Reset hasła – wyślij mail z linkiem
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Podaj adres email" });

    // Supabase wyśle maila z linkiem do reset hasła
    // Po kliknięciu w link user trafi na /reset-password z access_token w hash
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    // Supabase celowo NIE mówi czy email istnieje (ochrona przed enumeracją)
    // Zawsze zwracamy sukces, niezależnie od wyniku
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      console.error("forgot-password Supabase error:", errData);
    }

    res.json({
      ok: true,
      message: "Jeśli konto istnieje, wysłaliśmy link do resetu hasła. Sprawdź skrzynkę."
    });
  } catch(e) {
    console.error("forgot-password error:", e);
    // Nawet przy błędzie zwracamy sukces (ochrona przed enumeracją emaili)
    res.json({
      ok: true,
      message: "Jeśli konto istnieje, wysłaliśmy link do resetu hasła. Sprawdź skrzynkę."
    });
  }
});

// Reset hasła – ustaw nowe hasło (po kliknięciu w link z maila)
// Frontend musi mieć access_token z hash URL i wysłać go w nagłówku Authorization
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { password } = req.body;
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: "Brak tokenu z linka resetującego" });
    if (!password) return res.status(400).json({ error: "Podaj nowe hasło" });
    if (password.length < 8) return res.status(400).json({ error: "Hasło musi mieć co najmniej 8 znaków" });

    // Supabase PUT /auth/v1/user — aktualizuje dane usera (w tym hasło)
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(400).json({
        error: data.msg || data.error_description || "Token wygasł, poproś o nowy link"
      });
    }

    res.json({ ok: true, message: "Hasło zostało zmienione. Możesz się zalogować." });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Profil zalogowanego usera
app.get("/api/auth/profile", requireAuth, async (req, res) => {
  try {
    const data = await sbFetch("profiles", "GET", null, `?id=eq.${req.userId}`);
    const profile = data?.[0];
    if (!profile) return res.status(404).json({ error: "Profil nie istnieje" });

    const trialDaysLeft = profile.plan === "trial"
      ? Math.max(0, Math.ceil((new Date(profile.trial_ends_at) - new Date()) / 86400000))
      : null;

    res.json({ ...profile, trial_days_left: trialDaysLeft });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================
app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await sbFetch("admin_users", "GET", null, "?order=created_at.desc");
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { plan, trial_ends_at, is_active } = req.body;
    const update = {};
    if (plan !== undefined) update.plan = plan;
    if (trial_ends_at !== undefined) update.trial_ends_at = trial_ends_at;
    if (is_active !== undefined) update.is_active = is_active;

    await sbFetch("profiles", "PATCH", update, `?id=eq.${req.params.id}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Przedłuż trial o N dni
app.post("/api/admin/users/:id/extend-trial", requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = req.body.days || 14;
    const profile = await sbFetch("profiles", "GET", null, `?id=eq.${req.params.id}`);
    const p = profile?.[0];
    if (!p) return res.status(404).json({ error: "User nie znaleziony" });

    const base = new Date(p.trial_ends_at) > new Date() ? new Date(p.trial_ends_at) : new Date();
    base.setDate(base.getDate() + days);

    await sbFetch("profiles", "PATCH",
      { trial_ends_at: base.toISOString(), plan: "trial", is_active: true },
      `?id=eq.${req.params.id}`);

    res.json({ ok: true, new_trial_ends_at: base.toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// SUPABASE – klient REST
// ============================================================

async function sbFetch(table, method = "GET", body = null, params = "") {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Brak konfiguracji Supabase w .env");
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const opts = {
    method,
    headers: {
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
  };
  if (method === "POST") opts.headers["Prefer"] = "return=representation";
  if (method === "PATCH") opts.headers["Prefer"] = "return=minimal";
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase ${r.status}: ${txt.slice(0, 200)}`);
  }
  if (method === "DELETE" || opts.headers["Prefer"] === "return=minimal") return null;
  return r.json();
}

// ---- Historia wycen ----
app.get("/api/history", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const uid = req.userId;
    const data = await sbFetch("quotes", "GET", null,
      `?auth_user_id=eq.${uid}&order=ts.desc&limit=200`);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/history", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const item = req.body;
    if (!item?.id) return res.status(400).json({ error: "Brak id" });
    const row = {
      id:          item.id,
      user_id:     "default",
      auth_user_id: req.userId,
      ts:          item.ts || Date.now(),
      name:        item.name || "",
      client:      item.client || "",
      note:        item.note || "",
      origin:      item.route?.origin || "",
      destination: item.route?.destination || "",
      stops:       item.route?.stops || [],
      distance_km: item.calc?.distance_km ?? null,
      duration_h:  item.calc?.duration_h ?? null,
      total_cost:  item.calc?.total_cost_eur ?? null,
      price_eur:   item.calc?.price_eur ?? null,
      margin_eur:  item.calc?.margin_eur ?? null,
      margin_pct:  item.calc?.margin_pct ?? null,
      tolls_eur:   item.calc?.tolls_eur ?? null,
      fuel_eur:    item.calc?.fuel_cost_eur ?? null,
      driver_eur:  item.calc?.driver_cost_eur ?? null,
      other_eur:   item.calc?.other_costs_eur ?? null,
      tolls_geo:   item.tolls_geo || null,
      vignettes:   item.vignettes || null,
      calc:        item.calc || null,
      input:       item.input || null,
    };
    const data = await sbFetch("quotes", "POST", row);
    res.json(data?.[0] || row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/history/:id", requireAuth, async (req, res) => {
  try {
    const uid = req.userId;
    await sbFetch("quotes", "DELETE", null,
      `?id=eq.${req.params.id}&auth_user_id=eq.${uid}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- Tracker spalania ----
// ============================================================
// FLOTA – pojazdy, naczepy, kierowcy
// ============================================================
function fleetRoutes(entity) {
  // GET lista
  app.get(`/api/fleet/${entity}`, requireAuth, requireActiveSubscription, async (req, res) => {
    try {
      const uid = req.userId;
      const data = await sbFetch(entity, "GET", null,
        `?auth_user_id=eq.${uid}&active=neq.false&order=created_at.desc`);
      res.json(data || []);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST utwórz/aktualizuj
  app.post(`/api/fleet/${entity}`, requireAuth, requireActiveSubscription, async (req, res) => {
    try {
      const body = { ...req.body, user_id: "default", auth_user_id: req.userId };
      if (!body.id) body.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      const url = `${SUPABASE_URL}/rest/v1/${entity}`;
      console.log(`FLEET POST ${entity}:`, JSON.stringify(body).slice(0,200));
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "apikey":        SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type":  "application/json",
          "Prefer":        "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      console.log(`FLEET POST ${entity} response ${r.status}:`, text.slice(0,300));
      if (!r.ok) return res.status(r.status).json({ error: text });
      const data = JSON.parse(text);
      res.json(Array.isArray(data) ? data[0] : data);
    } catch(e) {
      console.error(`FLEET POST ${entity} error:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE (soft delete)
  app.delete(`/api/fleet/${entity}/:id`, requireAuth, async (req, res) => {
    try {
      const uid = req.userId;
      await sbFetch(entity, "PATCH", { active: false },
        `?id=eq.${req.params.id}&auth_user_id=eq.${uid}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
}

fleetRoutes("vehicles");
fleetRoutes("trailers");
fleetRoutes("drivers");

app.get("/api/fuel", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const uid = req.userId;
    const data = await sbFetch("fuel_trips", "GET", null,
      `?auth_user_id=eq.${uid}&order=created_at.desc&limit=500`);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fuel", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const t = req.body;
    if (!t?.id) return res.status(400).json({ error: "Brak id" });
    const row = {
      id:            t.id,
      user_id:       "default",
      auth_user_id:  req.userId,
      reg:           t.reg || "",
      driver:        t.driver || "",
      date_out:      t.dateOut || "",
      date_in:       t.dateIn || "",
      km:            t.km,
      fuel_base1:    t.b1,
      fuel_cards:    t.cards,
      fuel_base2:    t.b2,
      fuel_total:    t.total,
      burn_real:     t.real,
      burn_computer: t.comp || null,
      diff_l100:     t.diff || null,
      diff_liters:   t.diffL || null,
      badge:         t.badge || "ft-ok",
    };
    const data = await sbFetch("fuel_trips", "POST", row);
    res.json(data?.[0] || row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/fuel/:id", requireAuth, async (req, res) => {
  try {
    const uid = req.userId;
    await sbFetch("fuel_trips", "DELETE", null,
      `?id=eq.${req.params.id}&auth_user_id=eq.${uid}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ---- /api/route  (A→B, z alternatywami) ----
app.post("/api/route", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { origin, destination, truckParams } = req.body || {};
    if (!origin || !destination) return res.status(400).json({ error: "Podaj skąd i dokąd." });

    const [a, b] = await Promise.all([geocode(origin), geocode(destination)]);
    if (!a) return res.status(400).json({ error: `Nie znaleziono: ${origin}` });
    if (!b) return res.status(400).json({ error: `Nie znaleziono: ${destination}` });

    const routes = await getRouteData([a,b], truckParams||{}, true);
    const alts   = Array.isArray(routes) ? routes : [routes];
    const main   = alts[0];
    const revenue = req.body.revenue || 0;
    const margin  = revenue - main.tolls_geo.total_eur;
    const score   = getRouteScore(margin);

    // Powiadomienie o PIERWSZEJ kalkulacji trasy (najmocniejszy sygnał — user realnie używa)
    const meta = req.user?.user_metadata || {};
    if (!meta.first_route_at) {
      const token = (req.headers.authorization || "").slice(7);
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: "PUT",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: { ...meta, first_route_at: new Date().toISOString() }
          }),
        });
      } catch(e) {
        console.error("Nie udało się ustawić first_route_at:", e.message);
      }

      notifyOwner(
        `🚛 Pierwsza kalkulacja: ${req.user.email}`,
        `
          <h2>User zrobił pierwszą kalkulację trasy!</h2>
          <p style="font-family:sans-serif;font-size:14px;">To najmocniejszy sygnał aktywacji — <b>${req.user.email}</b> realnie używa aplikacji. Najlepszy moment na personalny mail/telefon.</p>
          <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:6px 12px;color:#666;">Email:</td><td style="padding:6px 12px;"><b>${req.user.email}</b></td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Firma:</td><td style="padding:6px 12px;">${meta.company || "—"}</td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Trasa:</td><td style="padding:6px 12px;">${a.display} → ${b.display}</td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Dystans:</td><td style="padding:6px 12px;">${main.distance_km} km</td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Koszt tras:</td><td style="padding:6px 12px;">${main.tolls_geo.total_eur} EUR</td></tr>
            <tr><td style="padding:6px 12px;color:#666;">Data:</td><td style="padding:6px 12px;">${fmtDate()}</td></tr>
          </table>
        `
      );
    }

    return res.json({
      origin_resolved:      a.display,
      destination_resolved: b.display,
      distance_km:  main.distance_km,
      duration_h:   main.duration_h,
      geometry:     main.geometry,
      tolls_geo:    main.tolls_geo,
      total_cost:   main.tolls_geo.total_eur,
      margin, score,
      routing_engine: HERE_API_KEY ? "HERE" : "OSRM",
      // ← pełna lista alternatyw z geometrią (potrzebna do rysowania na mapie)
      alternatives: alts.map((alt,idx) => ({
        idx,
        distance_km: alt.distance_km,
        duration_h:  alt.duration_h,
        geometry:    alt.geometry,
        tolls_geo:   alt.tolls_geo,
        total_cost:  alt.tolls_geo.total_eur,
      })),
      points: [
        { type:"start", lat:a.lat, lng:a.lon, label:a.display, country:extractCountry(a.display) },
        { type:"end",   lat:b.lat, lng:b.lon, label:b.display, country:extractCountry(b.display) },
      ],
    });
  } catch(err) {
    console.error("ROUTE ERROR:", err);
    return res.status(500).json({ error:"Route failed", details:err.message });
  }
});

// ---- /api/route/multi  (wielopunktowa, bez alternatyw) ----
app.post("/api/route/multi", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { origin, destination, stops, truckParams } = req.body || {};
    if (!origin || !destination) return res.status(400).json({ error: "Podaj skąd i dokąd." });

    const pointsText = [origin, ...(stops||[]), destination]
      .map(x => (x||"").trim()).filter(Boolean);
    if (pointsText.length < 2) return res.status(400).json({ error: "Za mało punktów." });

    const geocoded = await Promise.all(pointsText.map(p => geocode(p)));
    for (let i=0; i<geocoded.length; i++) {
      if (!geocoded[i]) return res.status(400).json({ error: `Nie znaleziono: ${pointsText[i]}` });
    }

    const route  = await getRouteData(geocoded, truckParams||{}, false);
    const revenue = req.body.revenue || 0;
    const score   = getRouteScore(revenue - route.tolls_geo.total_eur);

    return res.json({
      points_resolved: geocoded.map(p => p.display),
      origin_resolved:      geocoded[0].display,
      destination_resolved: geocoded[geocoded.length-1].display,
      distance_km: route.distance_km,
      duration_h:  route.duration_h,
      geometry:    route.geometry,
      tolls_geo:   route.tolls_geo,
      total_cost:  route.tolls_geo.total_eur,
      score,
      routing_engine: HERE_API_KEY ? "HERE" : "OSRM",
      points: geocoded.map((p,idx) => ({
        type: idx===0 ? "start" : idx===geocoded.length-1 ? "end" : "via",
        lat: p.lat, lng: p.lon, label: p.display, country: extractCountry(p.display),
      })),
    });
  } catch(err) {
    console.error("ROUTE MULTI ERROR:", err);
    return res.status(500).json({ error: "Błąd wyznaczania trasy (multi)" });
  }
});

// ---- /api/parse-stops  (NLP wyciąganie adresów z tekstu) ----
app.post("/api/parse-stops", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "Brak tekstu." });

    if (!client) {
      return res.status(503).json({ error: "Brak klucza OpenAI — parser niedostępny." });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: `Jesteś asystentem spedytora. Z podanego tekstu wyciągnij wszystkie lokalizacje/adresy w kolejności w jakiej się pojawiają.
Zwróć TYLKO obiekt JSON (bez markdown, bez \`\`\`), format:
{
  "origin": "pierwszy punkt",
  "stops": ["punkt 2", "punkt 3"],
  "destination": "ostatni punkt"
}
Zasady:
- Akceptuj KAŻDY format adresu: samo miasto, miasto + kraj, kod pocztowy + miasto, pełny adres z ulicą
- Skróty krajów (PL, DE, FR, GB, IT, ES, BE, NL itd.) traktuj jako część adresu
- Kolejność w tekście = kolejność trasy
- Ignoruj słowa nie będące adresami (załadunek, rozładunek, loading, delivery, via, do, +, →)
- Jeśli jest tylko 2 lokalizacje: origin + destination, stops = []
- Zachowaj oryginalną pisownię lokalizacji z tekstu
- Zwróć error TYLKO gdy w tekście nie ma żadnych rozpoznawalnych lokalizacji`
        },
        { role: "user", content: text.slice(0, 2000) }
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    if (parsed.error) return res.status(422).json({ error: parsed.error });
    return res.json(parsed);

  } catch(err) {
    console.error("PARSE-STOPS ERROR:", err.message);
    return res.status(500).json({ error: "Błąd parsowania: " + err.message });
  }
});


app.post("/api/report", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const calc = req.body?.calc || req.body?.result || req.body;
    if (!calc || typeof calc !== "object") return res.status(400).json({ error: "Brak danych kalkulatora" });

    if (!client) {
      return res.json({ report: "Raport AI jest chwilowo niedostępny (brak klucza API). Kalkulator działa poprawnie." });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Jesteś analitykiem transportu drogowego w Europie. Twoim zadaniem jest ocenić rentowność trasy dla firmy transportowej. Skup się na: kosztach, marży, ryzykach operacyjnych, sytuacji rynkowej. Pisz krótko, konkretnie i profesjonalnie. Unikaj ogólnych tekstów AI."
        },
        {
          role: "user",
          content: `Jesteś profesjonalnym asystentem spedytora. Oceń trasę i podaj:\n1. Podsumowanie\n2. Analizę kosztów\n3. Rekomendowaną cenę\n4. Ryzyka\n\nDane kalkulacji:\n${JSON.stringify(calc, null, 2)}`
        }
      ]
    });

    return res.json({ report: response.choices[0].message.content });
  } catch(err) {
    console.error("REPORT ERROR:", err.message);
    return res.json({ report: "Nie udało się wygenerować raportu AI. Kalkulator działa poprawnie." });
  }
});

// ============================================================
loadBorders();
app.use(express.static(path.join(process.cwd(), "public")));

// Strony
app.get("/login", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "login.html")));

app.get("/admin", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "admin.html")));

// Callback po aktywacji konta / kliknięciu magic link
app.get("/auth/callback", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "auth-callback.html")));

// Reset hasła – ekran z formularzem nowego hasła
app.get("/reset-password", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "reset-password.html")));

// Główna strona – wstrzykuje klucz HERE jako meta tag
app.get("/", (req, res) => {
  const filePath = path.join(process.cwd(), "public", "index.html");
  let html = fs.readFileSync(filePath, "utf8");
  // Wstrzyknij meta z kluczem HERE zaraz po <head>
  html = html.replace(
    "<head>",
    `<head>\n<meta name="here-api-key" content="${HERE_API_KEY || ""}">`
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Serwer: http://localhost:${PORT}`);
  console.log(`🗺  Routing: ${HERE_API_KEY ? "HERE Routing API v8 – truck profile ✅" : "OSRM + offline (dodaj HERE_API_KEY do .env)"}`);
});
// TEMP: pełny dump toll sections dla debugowania
