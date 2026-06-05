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
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

console.log("Supabase URL:", SUPABASE_URL ? SUPABASE_URL.slice(0,40)+"..." : "BRAK");
console.log("Supabase KEY:", SUPABASE_KEY ? SUPABASE_KEY.slice(0,20)+"..." : "BRAK");

console.log("🔥 OPTIRAX SERVER – HERE Routing API v8 🔥");

// ============================================================
// HERE API KEY
// Pobierz na: https://platform.here.com  (Base Plan, darmowy do 30k req/mies)
// ============================================================
const HERE_API_KEY = process.env.HERE_API_KEY || "";
// Osobny klucz TYLKO do map tiles (z restrykcją domeny w panelu HERE).
// Jeśli ustawiony — front dostaje JEGO, a routing serwerowy nadal używa HERE_API_KEY.
// Jeśli pusty — fallback do HERE_API_KEY (stare zachowanie).
const HERE_TILES_KEY = process.env.HERE_TILES_KEY || HERE_API_KEY;
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

// ============================================================
// DZIENNY LIMIT KALKULACJI DLA TRIAL
// Ogranicza wywołania /api/route do DAILY_CALC_LIMIT na dobę.
// Reset automatyczny gdy data się zmieni (o północy).
// Płatne plany (solo/pro/team) — bez limitu.
// ============================================================
const DAILY_CALC_LIMIT = 10;

async function requireCalcQuota(req, res, next) {
  try {
    const uid = req.userId;
    const profiles = await sbFetch("profiles", "GET", null,
      `?id=eq.${uid}&select=plan,daily_calc_count,daily_calc_date`);
    const p = profiles?.[0];
    if (!p) return next(); // brak profilu — przepuść (nie blokuj)

    // Płatni użytkownicy — brak limitu
    const plan = (p.plan || "trial").toLowerCase();
    if (plan !== "trial") return next();

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let count = p.daily_calc_count || 0;
    const lastDate = p.daily_calc_date || "";

    // Reset jeśli nowy dzień
    if (lastDate !== today) count = 0;

    if (count >= DAILY_CALC_LIMIT) {
      return res.status(429).json({
        error: "Dzienny limit kalkulacji wyczerpany.",
        limit: DAILY_CALC_LIMIT,
        used: count,
        remaining: 0,
        reset_at: today + "T23:59:59Z",
        upgrade_url: "https://app.optirax.pl",
      });
    }

    // Inkrementuj SYNCHRONICZNIE — fire-and-forget powodował race condition
    // przy szybkich kolejnych kliknięciach "Pobierz km"
    try {
      await sbFetch("profiles", "PATCH",
        { daily_calc_count: count + 1, daily_calc_date: today },
        `?id=eq.${uid}`
      );
    } catch(e) {
      console.warn("[quota] PATCH failed:", e.message);
      // Kontynuuj mimo błędu zapisu — nie blokuj użytkownika
    }

    // Przekaż info do odpowiedzi przez header (front może to wyświetlić)
    res.setHeader("X-Calc-Remaining", DAILY_CALC_LIMIT - count - 1);
    res.setHeader("X-Calc-Limit", DAILY_CALC_LIMIT);
    next();
  } catch(e) {
    // Błąd quota-check → przepuść (nie blokuj użytkownika przy problemach z DB)
    console.warn("[quota] check failed, passing through:", e.message);
    next();
  }
}
// requireAuth musi byc PRZED tym middleware.
// Dostarcza: req.companyId, req.companyFilter, req.userRole
// Backward-compat: NULL company_id -> filtr po auth_user_id
// ============================================================
const _companyCache = new Map();
const COMPANY_CACHE_TTL = 60000; // 60s

async function requireCompanyCtx(req, res, next) {
  try {
    const userId = req.userId;
    const cached = _companyCache.get(userId);
    if (cached && (Date.now() - cached.ts) < COMPANY_CACHE_TTL) {
      req.companyId     = cached.companyId;
      req.companyFilter = cached.companyFilter;
      req.userRole      = cached.role;
      return next();
    }
    const profile = await sbFetch("profiles", "GET", null,
      `?id=eq.${userId}&select=company_id,role`);
    const p = profile?.[0];
    const companyId = p?.company_id || null;
    const role      = p?.role || "owner";
    // Filtr PostgREST: firma -> company_id, solo -> auth_user_id (backward-compat)
    const companyFilter = companyId
      ? `company_id=eq.${encodeURIComponent(companyId)}`
      : `auth_user_id=eq.${encodeURIComponent(userId)}`;
    _companyCache.set(userId, { companyId, companyFilter, role, ts: Date.now() });
    req.companyId     = companyId;
    req.companyFilter = companyFilter;
    req.userRole      = role;
    next();
  } catch(e) {
    // Graceful degradation — nie blokuj przy bledzie
    req.companyId     = null;
    req.companyFilter = `auth_user_id=eq.${encodeURIComponent(req.userId)}`;
    req.userRole      = "owner";
    next();
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
  // tiles key (front), NIE routing key
  hereApiKey: HERE_TILES_KEY || "",
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

// Weryfikacja OTP signup - po kliknięciu linku aktywacyjnego z maila
// Zamienia OTP token (z URL hash) na pełny JWT + refresh token
app.post("/api/auth/verify-signup", async (req, res) => {
  try {
    const { token, email } = req.body;
    if (!token) return res.status(400).json({ error: "Brak tokenu z linka aktywacyjnego" });
    if (!email) return res.status(400).json({ error: "Brak emaila — wpisz email z którym się rejestrowałeś" });

    const r = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        type:  "signup",
        token: token,
        email: email,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("verify-signup error:", data);
      return res.status(400).json({
        error: data.msg || data.error_description ||
               "Link wygasł lub był już użyty. Zaloguj się, jeśli konto jest aktywne."
      });
    }

    // Pobierz profil
    let profile = null;
    try {
      const profileData = await sbFetch("profiles", "GET", null, `?id=eq.${data.user.id}`);
      profile = profileData?.[0] || null;
    } catch(e) {
      console.error("verify-signup profile fetch:", e.message);
    }

    res.json({
      token:         data.access_token,
      refresh_token: data.refresh_token,
      user:          data.user,
      profile:       profile,
    });
  } catch(e) {
    console.error("verify-signup error:", e);
    res.status(500).json({ error: e.message });
  }
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

    // Wskazujemy Supabase gdzie ma odesłać usera po kliknięciu w link.
    // WAŻNE: Supabase /auth/v1/recover przyjmuje redirect_to jako QUERY parameter,
    // NIE jako pole w body. Przekazanie w body jest ignorowane.
    const redirectTo = req.headers.origin
      ? `${req.headers.origin}/reset-password`
      : "https://app.optirax.pl/reset-password";

    const recoverUrl = `${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`;
    console.log("[forgot-password] redirect_to:", redirectTo);

    const r = await fetch(recoverUrl, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

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
    res.json({
      ok: true,
      message: "Jeśli konto istnieje, wysłaliśmy link do resetu hasła. Sprawdź skrzynkę."
    });
  }
});

// Reset hasła – ustaw nowe hasło używając JWT (stary flow Supabase)
// Frontend ma już JWT z URL hash bo Supabase sam zweryfikował OTP po kliknięciu linku
app.post("/api/auth/reset-password-jwt", async (req, res) => {
  try {
    const { password } = req.body;
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token)    return res.status(401).json({ error: "Brak tokenu z linka resetującego" });
    if (!password) return res.status(400).json({ error: "Podaj nowe hasło" });
    if (password.length < 8) return res.status(400).json({ error: "Hasło musi mieć co najmniej 8 znaków" });

    // PUT /auth/v1/user — aktualizuje hasło używając Bearer JWT
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
      console.error("reset-password-jwt error:", data);
      return res.status(400).json({
        error: data.msg || data.error_description || "Token wygasł, poproś o nowy link"
      });
    }

    res.json({ ok: true, message: "Hasło zostało zmienione. Możesz się zalogować." });
  } catch(e) {
    console.error("reset-password-jwt error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Reset hasła – ustaw nowe hasło (po kliknięciu w link z maila)
// Supabase teraz zwraca OTP (6-8 cyfr) zamiast JWT, więc musimy najpierw
// zweryfikować OTP -> dostać JWT -> dopiero potem ustawić hasło
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { password, token, email } = req.body;

    if (!token)    return res.status(400).json({ error: "Brak tokenu z linka resetującego" });
    if (!email)    return res.status(400).json({ error: "Brak adresu email — kliknij ponownie link z maila" });
    if (!password) return res.status(400).json({ error: "Podaj nowe hasło" });
    if (password.length < 8) return res.status(400).json({ error: "Hasło musi mieć co najmniej 8 znaków" });

    // Krok 1: zweryfikuj OTP w Supabase, otrzymaj prawdziwy JWT access_token
    const verifyR = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        type:  "recovery",
        token: token,
        email: email,
      }),
    });

    const verifyData = await verifyR.json();
    if (!verifyR.ok) {
      console.error("Reset password verify error:", verifyData);
      return res.status(400).json({
        error: verifyData.msg || verifyData.error_description ||
               "Link wygasł lub był już użyty. Poproś o nowy link."
      });
    }

    const jwtToken = verifyData.access_token;
    if (!jwtToken) {
      return res.status(400).json({ error: "Supabase nie zwrócił tokenu — spróbuj ponownie" });
    }

    // Krok 2: ustaw nowe hasło używając JWT
    const updateR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${jwtToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    const updateData = await updateR.json();
    if (!updateR.ok) {
      console.error("Reset password update error:", updateData);
      return res.status(400).json({
        error: updateData.msg || updateData.error_description || "Błąd ustawiania hasła"
      });
    }

    res.json({ ok: true, message: "Hasło zostało zmienione. Możesz się zalogować." });
  } catch(e) {
    console.error("reset-password error:", e);
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

    await sbFetch("profiles", "PATCH", update, `?id=eq.${encodeURIComponent(req.params.id)}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Przedłuż trial o N dni
app.post("/api/admin/users/:id/extend-trial", requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = req.body.days || 14;
    const profile = await sbFetch("profiles", "GET", null, `?id=eq.${encodeURIComponent(req.params.id)}`);
    const p = profile?.[0];
    if (!p) return res.status(404).json({ error: "User nie znaleziony" });

    const base = new Date(p.trial_ends_at) > new Date() ? new Date(p.trial_ends_at) : new Date();
    base.setDate(base.getDate() + days);

    await sbFetch("profiles", "PATCH",
      { trial_ends_at: base.toISOString(), plan: "trial", is_active: true },
      `?id=eq.${encodeURIComponent(req.params.id)}`);

    res.json({ ok: true, new_trial_ends_at: base.toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/send-trial-emails
// segment: "expired" | "expiring_soon" | "expiring_week"
// dry_run: true = tylko pokaż listę, nie wysyłaj
app.post("/api/admin/send-trial-emails", requireAuth, requireAdmin, async (req, res) => {
  const { segment = "expired", dry_run = false } = req.body;
  try {
    let filter = "";
    if (segment === "expired") {
      // Trial wygasł max 30 dni temu
      const cutoff = new Date(Date.now() - 30*24*3600*1000).toISOString();
      filter = `?plan=eq.trial&is_active=eq.true&trial_ends_at=lt.${new Date().toISOString()}&trial_ends_at=gt.${cutoff}&select=id,email,full_name,company,trial_ends_at,company_id`;
    } else if (segment === "expiring_soon") {
      // Wygasa za 1-3 dni
      const from = new Date().toISOString();
      const to   = new Date(Date.now() + 3*24*3600*1000).toISOString();
      filter = `?plan=eq.trial&is_active=eq.true&trial_ends_at=gt.${from}&trial_ends_at=lt.${to}&select=id,email,full_name,company,trial_ends_at,company_id`;
    } else if (segment === "expiring_week") {
      // Wygasa za 4-7 dni
      const from = new Date(Date.now() + 3*24*3600*1000).toISOString();
      const to   = new Date(Date.now() + 7*24*3600*1000).toISOString();
      filter = `?plan=eq.trial&is_active=eq.true&trial_ends_at=gt.${from}&trial_ends_at=lt.${to}&select=id,email,full_name,company,trial_ends_at,company_id`;
    } else {
      return res.status(400).json({ error: "segment musi być: expired | expiring_soon | expiring_week" });
    }

    const users = await sbFetch("profiles", "GET", null, filter);
    if (!users?.length) return res.json({ ok: true, sent: 0, users: [] });

    // Dla każdego usera policz ile zrobił wycen (personalzacja)
    const enriched = await Promise.all(users.map(async u => {
      try {
        const qs = await sbFetch("quotes", "GET", null,
          `?company_id=eq.${encodeURIComponent(u.company_id || "")}&select=id&limit=100`);
        return { ...u, quotes_count: qs?.length || 0 };
      } catch { return { ...u, quotes_count: 0 }; }
    }));

    if (dry_run) {
      return res.json({
        ok: true, dry_run: true, segment,
        count: enriched.length,
        users: enriched.map(u => ({ email: u.email, name: u.full_name, quotes: u.quotes_count, trial_ends: u.trial_ends_at }))
      });
    }

    if (!resend) return res.status(503).json({ error: "Resend nie skonfigurowany (brak RESEND_API_KEY)" });

    const results = [];
    for (const u of enriched) {
      try {
        const html = buildTrialEmail(u, segment);
        const subject = segment === "expired"
          ? `Twój trial OPTIRAX wygasł — wróć i nie trać czasu`
          : segment === "expiring_soon"
          ? `Zostały Ci ${Math.ceil((new Date(u.trial_ends_at)-new Date())/86400000)} dni trialu OPTIRAX`
          : `Tydzień do końca trialu — co dalej z OPTIRAX?`;

        await resend.emails.send({
          from: NOTIFICATION_FROM,
          to:   u.email,
          subject,
          html,
        });
        results.push({ email: u.email, ok: true });
        await new Promise(r => setTimeout(r, 200)); // rate limit
      } catch(e) {
        results.push({ email: u.email, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, segment, sent: results.filter(r=>r.ok).length, failed: results.filter(r=>!r.ok).length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function buildTrialEmail(user, segment) {
  const name  = user.full_name?.split(" ")?.[0] || "Hej";
  const firma = user.company && user.company !== "brak firmy" && user.company !== "Brak" ? user.company : "";
  const wycen = user.quotes_count || 0;
  const aktywny = wycen > 0;

  // Dwa zupełnie różne maile — aktywny user vs ten co nigdy nie spróbował
  if (!aktywny) {
    // 0 wycen — główny przypadek (20/21 userów)
    // Nie sprzedajemy — oferujemy drugą szansę
    return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#0c1322;border-radius:16px;overflow:hidden;max-width:580px;">

  <tr><td style="padding:24px 32px 18px;border-bottom:1px solid #1e2d45;">
    <span style="font-size:20px;font-weight:700;color:#e8590c;">OPTIRAX</span>
    <span style="font-size:12px;color:#475569;margin-left:10px;">Kalkulator kosztów trasy</span>
  </td></tr>

  <tr><td style="padding:28px 32px;color:#e2e8f0;font-size:15px;line-height:1.75;">
    <p style="margin:0 0 16px;">Cześć ${name}${firma ? ` z ${firma}` : ""},</p>

    <p style="margin:0 0 16px;">Widzę że trial OPTIRAX właśnie wygasł, ale nie zdążyłeś go sprawdzić.</p>

    <p style="margin:0 0 20px;">Rozumiem — zleceń nie ubywa, a nowe narzędzie zawsze odkłada się na "jak będzie spokojniej".</p>

    <div style="background:#16233f;border-left:3px solid #e8590c;border-radius:8px;padding:18px 22px;margin:0 0 24px;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#fff;">Przedłużamy Ci trial o 7 dni — za darmo.</p>
      <p style="margin:0;font-size:13px;color:#94a3b8;">Odpisz na tego maila jednym słowem: <strong style="color:#e2e8f0;">TAK</strong> — ustawiamy kolejne 7 dni i nie musisz nic robić.</p>
    </div>

    <p style="margin:0 0 12px;font-size:14px;color:#94a3b8;">Co możesz sprawdzić w 5 minut:</p>
    <p style="margin:0 0 6px;font-size:14px;color:#e2e8f0;">→ Wpisz dowolną trasę i kliknij "Pobierz km" — mapa i myto wejdą automatycznie</p>
    <p style="margin:0 0 6px;font-size:14px;color:#e2e8f0;">→ Ustaw swoje ceny paliwa, stawkę kierowcy, koszty stałe — raz</p>
    <p style="margin:0 0 24px;font-size:14px;color:#e2e8f0;">→ Policz ile zostaje na czysto z ostatniego zlecenia</p>

    <table cellpadding="0" cellspacing="0"><tr><td>
      <a href="https://app.optirax.pl" style="display:inline-block;background:#e8590c;color:#fff;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;text-decoration:none;">Wejdź i sprawdź →</a>
    </td></tr></table>

    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Masz pytanie albo coś nie działa? Odpisz tutaj — odpisuję sam.</p>
  </td></tr>

  <tr><td style="padding:14px 32px;border-top:1px solid #1e2d45;font-size:11px;color:#475569;line-height:1.6;">
    Przemek · OPTIRAX &nbsp;·&nbsp;
    <a href="https://optirax.pl" style="color:#e8590c;text-decoration:none;">optirax.pl</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
  }

  // Aktywny user (1+ wycen) — normalny upsell
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#0c1322;border-radius:16px;overflow:hidden;max-width:580px;">

  <tr><td style="padding:24px 32px 18px;border-bottom:1px solid #1e2d45;">
    <span style="font-size:20px;font-weight:700;color:#e8590c;">OPTIRAX</span>
    <span style="font-size:12px;color:#475569;margin-left:10px;">Kalkulator kosztów trasy</span>
  </td></tr>

  <tr><td style="padding:28px 32px;color:#e2e8f0;font-size:15px;line-height:1.75;">
    <p style="margin:0 0 16px;">Cześć ${name}${firma ? ` z ${firma}` : ""},</p>

    <p style="margin:0 0 16px;">Trial OPTIRAX wygasł. W trakcie tych 14 dni zrobiłeś ${wycen} ${wycen === 1 ? "wycenę" : wycen < 5 ? "wyceny" : "wycen"} — widzę że sprawdziłeś jak to działa.</p>

    <p style="margin:0 0 20px;">Żeby nadal mieć dostęp do kalkulatora, historii i floty — plan SOLO to 49 zł/mies. Bez umowy, możesz anulować kiedy chcesz.</p>

    <div style="background:#16233f;border-radius:8px;padding:16px 20px;margin:0 0 24px;font-size:13px;color:#94a3b8;">
      <strong style="color:#e2e8f0;display:block;margin-bottom:8px;">Plan SOLO — 49 zł / miesiąc</strong>
      Paliwo + myto + kierowca + koszty stałe w jednym miejscu<br>
      Historia wycen · Flota + alerty OC/przegląd/tacho · PDF oferta
    </div>

    <table cellpadding="0" cellspacing="0"><tr><td>
      <a href="https://app.optirax.pl" style="display:inline-block;background:#e8590c;color:#fff;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;text-decoration:none;">Przejdź na plan płatny →</a>
    </td></tr></table>

    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Masz pytanie? Odpisz tutaj bezpośrednio.</p>
  </td></tr>

  <tr><td style="padding:14px 32px;border-top:1px solid #1e2d45;font-size:11px;color:#475569;">
    Przemek · OPTIRAX &nbsp;·&nbsp;
    <a href="https://optirax.pl" style="color:#e8590c;text-decoration:none;">optirax.pl</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

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
    // Domyślnie tylko stałe wpisy (bez draftów z autosave).
    // ?include_drafts=1 zwraca wszystko (do debug/admin).
    const draftFilter = req.query.include_drafts === "1" ? "" : "&is_draft=eq.false";
    const data = await sbFetch("quotes", "GET", null,
      `?auth_user_id=eq.${uid}${draftFilter}&order=ts.desc&limit=200`);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Helper: zbuduj wiersz dla tabeli quotes z item-a frontowego
function buildQuoteRow(item, userId, { isDraft = false } = {}) {
  return {
    id:           item.id,
    user_id:      "default",
    auth_user_id: userId,
    ts:           item.ts || Date.now(),
    name:         item.name || "",
    client:       item.client || "",
    note:         item.note || "",
    origin:       item.route?.origin || "",
    destination:  item.route?.destination || "",
    stops:        item.route?.stops || [],
    distance_km:  item.calc?.distance_km ?? null,
    duration_h:   item.calc?.duration_h ?? null,
    total_cost:   item.calc?.total_cost_eur ?? null,
    price_eur:    item.calc?.price_eur ?? null,
    margin_eur:   item.calc?.margin_eur ?? null,
    margin_pct:   item.calc?.margin_pct ?? null,
    tolls_eur:    item.calc?.tolls_eur ?? null,
    fuel_eur:     item.calc?.fuel_cost_eur ?? null,
    driver_eur:   item.calc?.driver_cost_eur ?? null,
    other_eur:    item.calc?.other_costs_eur ?? null,
    tolls_geo:    item.tolls_geo || null,
    vignettes:    item.vignettes || null,
    calc:         item.calc || null,
    input:        item.input || null,
    is_draft:     !!isDraft,
    vehicle_id:   item.vehicle_id || null,
    vehicle_reg:  item.vehicle_reg || null,
  };
}

// Helper: znajdź draft dla danej trasy (origin + destination, te same stops)
// Zwraca id draftu albo null. Stops porównujemy luźno (po stringified arr).
async function findDraftForRoute(userId, origin, destination, stops) {
  try {
    const o = encodeURIComponent(origin || "");
    const d = encodeURIComponent(destination || "");
    const data = await sbFetch("quotes", "GET", null,
      `?auth_user_id=eq.${userId}&is_draft=eq.true&origin=eq.${o}&destination=eq.${d}&order=ts.desc&limit=10`);
    if (!Array.isArray(data) || data.length === 0) return null;

    // Dopasuj po stops (jak dwie trasy mają takie same origin+destination
    // ale różne punkty pośrednie = osobne drafty)
    const stopsStr = JSON.stringify(stops || []);
    const match = data.find(row => JSON.stringify(row.stops || []) === stopsStr);
    return match?.id || null;
  } catch {
    return null;
  }
}

app.post("/api/history", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const item = req.body;
    if (!item?.id) return res.status(400).json({ error: "Brak id" });

    // Sprawdź czy istnieje draft tej samej trasy - jeśli tak, promuj go
    // (UPDATE is_draft=false + nadpisz dane) zamiast tworzyć nowy wiersz.
    const draftId = await findDraftForRoute(
      req.userId,
      item.route?.origin,
      item.route?.destination,
      item.route?.stops
    );

    const row = buildQuoteRow(item, req.userId, { isDraft: false });

    if (draftId) {
      // PROMOTE: nadpisz draft danymi z ręcznego zapisu (nazwa/klient/notatka itd.),
      // przełącz is_draft=false. Zachowujemy id draftu - mniej śmieci w bazie.
      const patchRow = { ...row, id: undefined }; // id w URL, nie w body
      await sbFetch("quotes", "PATCH", patchRow,
        `?id=eq.${draftId}&auth_user_id=eq.${req.userId}`);
      res.json({ ...row, id: draftId, promoted_from_draft: true });
    } else {
      const data = await sbFetch("quotes", "POST", row);
      res.json(data?.[0] || row);
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// AUTOSAVE: zapisuje draft po każdym "Policz".
// Logika: jeśli istnieje draft tej samej trasy (origin+destination+stops) - UPDATE
// (ten sam id, nadpisz parametry). Inaczej INSERT z is_draft=true.
// Cel: zero spamu w bazie przy iterowaniu wariantów tej samej trasy.
app.post("/api/history/autosave", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const item = req.body;
    if (!item?.route?.origin || !item?.route?.destination) {
      return res.status(400).json({ error: "Brak origin/destination" });
    }

    const existingDraftId = await findDraftForRoute(
      req.userId,
      item.route.origin,
      item.route.destination,
      item.route.stops
    );

    if (existingDraftId) {
      // UPDATE istniejącego draftu - nadpisz parametry kalkulacji
      const row = buildQuoteRow({ ...item, id: existingDraftId }, req.userId, { isDraft: true });
      const patchRow = { ...row, id: undefined };
      await sbFetch("quotes", "PATCH", patchRow,
        `?id=eq.${existingDraftId}&auth_user_id=eq.${req.userId}&is_draft=eq.true`);
      res.json({ ok: true, id: existingDraftId, mode: "updated" });
    } else {
      // INSERT nowego draftu
      if (!item.id) return res.status(400).json({ error: "Brak id dla nowego draftu" });
      const row = buildQuoteRow(item, req.userId, { isDraft: true });
      await sbFetch("quotes", "POST", row);
      res.json({ ok: true, id: item.id, mode: "inserted" });
    }
  } catch(e) {
    // Autosave nie powinien blokować UI - loguj ale zwracaj 200 z błędem w body
    console.warn("autosave failed:", e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
});

app.delete("/api/history/:id", requireAuth, async (req, res) => {
  try {
    const uid = req.userId;
    await sbFetch("quotes", "DELETE", null,
      `?id=eq.${encodeURIComponent(req.params.id)}&auth_user_id=eq.${uid}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Przypisz pojazd do istniejącej wyceny (edycja z historii)
app.patch("/api/history/:id/vehicle", requireAuth, requireCompanyCtx, async (req, res) => {
  try {
    const uid = req.userId;
    const { vehicle_id, vehicle_reg } = req.body;
    await sbFetch("quotes", "PATCH",
      { vehicle_id: vehicle_id || null, vehicle_reg: vehicle_reg || null },
      `?id=eq.${encodeURIComponent(req.params.id)}&auth_user_id=eq.${uid}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Nadpisz istniejący zapis wyceny (POLICZ po autosave z Pobierz-km)
app.patch("/api/history/:id", requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const uid  = req.userId;
    const item = req.body;
    const row  = buildQuoteRow(item, uid, { isDraft: false });
    delete row.id; // id nie nadpisujemy
    await sbFetch("quotes", "PATCH", row,
      `?id=eq.${encodeURIComponent(req.params.id)}&auth_user_id=eq.${uid}`);
    res.json({ ok: true, id: req.params.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- Tracker spalania ----
// ============================================================
// FLOTA – pojazdy, naczepy, kierowcy
// ============================================================
function fleetRoutes(entity) {
  // GET lista
  app.get(`/api/fleet/${entity}`, requireAuth, requireActiveSubscription, requireCompanyCtx, async (req, res) => {
    try {
      const data = await sbFetch(entity, "GET", null,
        `?${req.companyFilter}&active=neq.false&order=created_at.desc`);
      res.json(data || []);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST utwórz/aktualizuj
  app.post(`/api/fleet/${entity}`, requireAuth, requireActiveSubscription, requireCompanyCtx, async (req, res) => {
    try {
      // Whitelist kolumn per encja — nieznane pola z frontu nie wywala insertu
      const ALLOWED = {
        vehicles: ["id","reg","brand","model","year","gross_weight_kg","axle_weight_kg",
                   "height_cm","width_cm","length_cm","axle_count","fuel_type","euro_class",
                   "driver_id","active","notes","oc_date","przeglad_date","tacho_date",
                   "serwis_date","serwis_km"],
        trailers: ["id","reg","type","brand","model","year","active","notes",
                   "height_cm","width_cm","length_cm","gross_weight_kg"],
        drivers:  ["id","name","phone","email","license_categories","active","notes"],
      };
      const allowed = ALLOWED[entity] || Object.keys(req.body);
      const clean = {};
      for (const k of allowed) if (k in req.body) clean[k] = req.body[k];

      const body = { ...clean, user_id: "default", auth_user_id: req.userId };
      if (req.companyId) body.company_id = req.companyId;
      if (body.id) {
        const existing = await sbFetch(entity, "GET", null,
          `?id=eq.${encodeURIComponent(body.id)}&select=company_id,auth_user_id`);
        const rec = existing?.[0];
        if (rec) {
          const sameCompany = req.companyId && rec.company_id === req.companyId;
          const sameUser    = rec.auth_user_id === req.userId;
          if (!sameCompany && !sameUser) return res.status(403).json({ error: "Brak uprawnien do tego rekordu" });
        }
      } else {
        body.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      }
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
  app.delete(`/api/fleet/${entity}/:id`, requireAuth, requireCompanyCtx, async (req, res) => {
    try {
      await sbFetch(entity, "PATCH", { active: false },
        `?id=eq.${encodeURIComponent(req.params.id)}&${req.companyFilter}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
}

fleetRoutes("vehicles");
fleetRoutes("trailers");
fleetRoutes("drivers");

// PATCH /api/fleet/vehicles/:id — aktualizacja terminów i innych pól pojazdu
app.patch("/api/fleet/vehicles/:id", requireAuth, requireCompanyCtx, async (req, res) => {
  try {
    const uid = req.userId;
    const body = req.body;
    delete body.auth_user_id;
    delete body.user_id;
    await sbFetch("vehicles", "PATCH", body,
      `?id=eq.${encodeURIComponent(req.params.id)}&auth_user_id=eq.${uid}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/fleet/alerts — pojazdy z terminami ≤30 dni
app.get("/api/fleet/alerts", requireAuth, requireCompanyCtx, async (req, res) => {
  try {
    const uid = req.userId;
    const vehicles = await sbFetch("vehicles", "GET", null,
      `?${req.companyFilter}&active=neq.false`);
    const alerts = buildAlerts(vehicles || []);
    res.json(alerts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/alerts/send — ręczne wysłanie emaila z alertami
app.post("/api/alerts/send", requireAuth, async (req, res) => {
  try {
    const uid = req.userId;
    const vehicles = await sbFetch("vehicles", "GET", null,
      `?auth_user_id=eq.${uid}&active=neq.false`);
    const alerts = buildAlerts(vehicles || []);
    if (!alerts.length) return res.json({ ok: true, sent: false, reason: "Brak alertów" });
    await sendFleetAlertEmail(alerts);
    res.json({ ok: true, sent: true, count: alerts.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function buildAlerts(vehicles) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const alerts = [];
  const dateFields = [
    { key: "oc_date",       label: "OC" },
    { key: "przeglad_date", label: "Przegląd" },
    { key: "tacho_date",    label: "Tacho" },
    { key: "serwis_date",   label: "Serwis" },
  ];
  for (const v of vehicles) {
    for (const { key, label } of dateFields) {
      if (!v[key]) continue;
      const d = new Date(v[key]);
      d.setHours(0,0,0,0);
      const daysLeft = Math.round((d - today) / 86400000);
      if (daysLeft <= 30) {
        alerts.push({ reg: v.reg, field: key, label, date: v[key], daysLeft });
      }
    }
  }
  return alerts;
}

async function sendFleetAlertEmail(alerts) {
  const rows = alerts.map(a => {
    const color = a.daysLeft < 0 ? "#ef4444" : a.daysLeft <= 7 ? "#ef4444" : "#f59e0b";
    const status = a.daysLeft < 0
      ? `PRZETERMINOWANE (${Math.abs(a.daysLeft)} dni temu)`
      : `za ${a.daysLeft} dni`;
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #334155;font-weight:600;">${a.reg}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #334155;">${a.label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #334155;">${a.date}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #334155;color:${color};font-weight:600;">${status}</td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:24px;border-radius:12px;">
      <div style="font-size:22px;font-weight:700;color:#e8590c;margin-bottom:4px;">OPTIRAX</div>
      <div style="font-size:14px;color:#94a3b8;margin-bottom:20px;">Alert terminów floty${firmLabel}</div>
      <p style="margin:0 0 16px;">Pojazdy z terminami wymagającymi uwagi (≤30 dni lub przeterminowane):</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:#1e293b;">
          <th style="padding:8px 12px;text-align:left;color:#94a3b8;">Rejestracja</th>
          <th style="padding:8px 12px;text-align:left;color:#94a3b8;">Termin</th>
          <th style="padding:8px 12px;text-align:left;color:#94a3b8;">Data</th>
          <th style="padding:8px 12px;text-align:left;color:#94a3b8;">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#64748b;">Wygenerowano: ${new Date().toLocaleString("pl-PL")}</p>
    </div>`;

  if (!resend) { console.log(`[EMAIL DISABLED] Alert dla ${to}`); return; }
  await resend.emails.send({ from: NOTIFICATION_FROM, to, subject: `🚛 OPTIRAX Alert${firmLabel}: ${alerts.length} termin(ów) floty wymaga uwagi`, html });
}

// Cron 24h — per firma, wysyla osobny email do kazdej
(async function startFleetAlertCron() {
  async function checkAllFleets() {
    try {
      console.log("[CRON] Sprawdzam terminy floty...");
      const vehicles = await sbFetch("vehicles", "GET", null, "?active=neq.false&select=*");
      if (!vehicles?.length) return;
      const groups = new Map();
      for (const v of vehicles) {
        const key = v.company_id || v.auth_user_id || "unknown";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(v);
      }
      console.log(`[CRON] ${groups.size} grup, ${vehicles.length} pojazdow`);
      for (const [groupKey, groupVehicles] of groups) {
        const alerts = buildAlerts(groupVehicles);
        if (!alerts.length) continue;
        let targetEmail = null, companyName = null;
        try {
          const looksLikeId = groupKey.length > 20 && !groupKey.includes("@");
          if (looksLikeId) {
            const cos = await sbFetch("companies", "GET", null,
              `?id=eq.${encodeURIComponent(groupKey)}&select=alert_email,name,owner_user_id`);
            const co = cos?.[0];
            if (co) {
              companyName = co.name;
              targetEmail = co.alert_email;
              if (!targetEmail && co.owner_user_id) {
                const op = await sbFetch("profiles", "GET", null,
                  `?id=eq.${encodeURIComponent(co.owner_user_id)}&select=email,alert_email`);
                targetEmail = op?.[0]?.alert_email || op?.[0]?.email;
              }
            }
          } else {
            const op = await sbFetch("profiles", "GET", null,
              `?id=eq.${encodeURIComponent(groupKey)}&select=email,alert_email,full_name`);
            const p = op?.[0];
            targetEmail = p?.alert_email || p?.email;
            companyName = p?.full_name || "Solo";
          }
        } catch(e) { console.warn("[CRON] email lookup error:", e.message); }
        if (!targetEmail) targetEmail = NOTIFICATION_EMAIL;
        console.log(`[CRON] ${companyName || groupKey}: ${alerts.length} alertow -> ${targetEmail}`);
        await sendFleetAlertEmail(alerts, targetEmail, companyName);
      }
    } catch(e) { console.error("[CRON] blad:", e.message); }
  }
  setTimeout(checkAllFleets, 5 * 60 * 1000);
  setInterval(checkAllFleets, 24 * 60 * 60 * 1000);
  console.log("[CRON] Alert floty uruchomiony (co 24h, per firma).");
})();

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
      `?id=eq.${encodeURIComponent(req.params.id)}&auth_user_id=eq.${uid}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ---- /api/route  (A→B, z alternatywami) ----
app.get("/api/quota", requireAuth, async (req, res) => {
  try {
    const profiles = await sbFetch("profiles", "GET", null,
      `?id=eq.${req.userId}&select=plan,daily_calc_count,daily_calc_date`);
    const p = profiles?.[0];
    if (!p) return res.json({ limited: false });
    const plan = (p.plan || "trial").toLowerCase();
    if (plan !== "trial") return res.json({ limited: false, plan });
    const today = new Date().toISOString().slice(0, 10);
    const count = (p.daily_calc_date === today) ? (p.daily_calc_count || 0) : 0;
    res.json({
      limited: true, plan,
      used: count,
      limit: DAILY_CALC_LIMIT,
      remaining: Math.max(0, DAILY_CALC_LIMIT - count),
      reset_at: today + "T23:59:59Z",
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/route", requireAuth, requireActiveSubscription, requireCalcQuota, async (req, res) => {
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
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: `Jesteś asystentem spedytora. Z podanego tekstu zlecenia transportowego (często e-mail) wyciągnij dane.
Zwróć TYLKO obiekt JSON (bez markdown, bez \`\`\`), format:
{
  "origin": "pierwszy punkt trasy",
  "stops": ["punkt posredni 1", "punkt posredni 2"],
  "destination": "ostatni punkt trasy",
  "offer_price_eur": liczba lub null,
  "vehicle_type": "tir40" | "jumbo" | "solo" | "bus35" | "busBig" | null,
  "is_reefer": true | false,
  "adr": true | false,
  "load_date": "tekst daty zaladunku lub null",
  "cargo": "krotki opis ladunku lub null"
}
Zasady:
- ORIGIN/STOPS/DESTINATION: akceptuj KAŻDY format adresu (miasto, kod+miasto, pełny adres). Skróty krajów (PL, DE, FR...) to część adresu. Kolejność w tekście = kolejność trasy. Ignoruj słowa nie-adresowe (załadunek, rozładunek, loading, via). Jeśli tylko 2 lokalizacje: origin+destination, stops=[].
- OFFER_PRICE_EUR: stawka/cena NETTO za transport (bez VAT). Szukaj kwot przy słowach: stawka, cena, fracht, freight, rate, EUR, €. IGNORUJ kwoty przy słowach: VAT, podatek, brutto, gross, total z VAT — szukaj wartości netto. Przelicz na EUR jeśli podana w innej walucie (PLN÷4.3, GBP×1.17, CHF×1.02). Tylko liczba, bez waluty. null jeśli brak.
- VEHICLE_TYPE: dobierz po opisie pojazdu/ładunku: "tir40" (naczepa, ciągnik, 40t, standard, plandeka, firanka 13.6m), "jumbo" (jumbo, tandem, 120m3), "solo" (solo, 12t, krótki), "bus35" (bus, do 3.5t, blaszak), "busBig" (bus 7.5t, powyżej 3.5t). null jeśli nie wiadomo.
- IS_REEFER: true jeśli wzmianka o chłodni, agregacie, temperaturze, reefer, frigo, mrożonki, temp. kontrolowana. Inaczej false.
- ADR: true jeśli wzmianka o ADR, materiały niebezpieczne, dangerous goods. Inaczej false.
- LOAD_DATE: data/termin załadunku jeśli podany (zachowaj oryginalny zapis). null jeśli brak.
- CARGO: krótki opis towaru (max 5 słów) jeśli podany. null jeśli brak.
- Zwróć {"error":"..."} TYLKO gdy w tekście nie ma żadnych rozpoznawalnych lokalizacji.`
        },
        { role: "user", content: text.slice(0, 3000) }
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
app.use(express.static(path.join(process.cwd(), "public"), { extensions: ["html"] }));

// Strony
app.get("/login", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "login.html")));

app.get("/register", (req, res) =>
  res.redirect("/login?tab=register"));

app.get("/privacy", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "polityka-prywatnosci.html")));
app.get("/polityka-prywatnosci", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "polityka-prywatnosci.html")));

app.get("/terms", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "regulamin.html")));
app.get("/regulamin", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "regulamin.html")));

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
    `<head>\n<meta name="here-api-key" content="${HERE_TILES_KEY || ""}">`
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
