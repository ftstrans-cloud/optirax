// TomTom v1 contract: https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route
// These are legacy planning assumptions from the supplied project, NOT verified tariffs.
const COUNTRIES = {
  POL:['Polska',.16], DEU:['Niemcy',.35], CZE:['Czechy',.15], AUT:['Austria',.50],
  ITA:['Włochy',.20], FRA:['Francja',.40], BEL:['Belgia',.21], NLD:['Holandia',.149],
  SVK:['Słowacja',.20], HUN:['Węgry',.55], SVN:['Słowenia',.20], HRV:['Chorwacja',.12],
  GBR:['Wielka Brytania',null], CHE:['Szwajcaria',1], ROU:['Rumunia',.09],
  BGR:['Bułgaria',.08], SRB:['Serbia',.08], ESP:['Hiszpania',.18], PRT:['Portugalia',.18],
  SWE:['Szwecja',null], DNK:['Dania',null], NOR:['Norwegia',null], FIN:['Finlandia',null],
  LUX:['Luksemburg',null], LTU:['Litwa',null], LVA:['Łotwa',null], EST:['Estonia',null],
  IRL:['Irlandia',null], GRC:['Grecja',.07],
};
const round = (n, p = 2) => Number(n.toFixed(p));
export class RoutingError extends Error {
  constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}
const invalid = message => new RoutingError('INVALID_ROUTE_INPUT', message, 400);

export function normalizeTruck(params = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw invalid('Nieprawidłowy profil pojazdu.');
  if (params.transportMode && params.transportMode !== 'truck') throw invalid('Wybierz profil pojazdu ciężarowego.');
  if (params.avoidCountries != null && (!Array.isArray(params.avoidCountries) || params.avoidCountries.length)) {
    throw invalid('Omijanie całych krajów nie jest obsługiwane. Wyznacz przebieg przez punkty pośrednie.');
  }
  const limits = {
    grossWeightKg: [40000, 1000, 100000], axleWeightKg: [11500, 500, 20000],
    heightCm: [400, 100, 600], widthCm: [255, 100, 500], lengthCm: [1650, 100, 3500],
    axleCount: [5, 2, 12],
  };
  const result = {};
  for (const [key, [fallback, min, max]] of Object.entries(limits)) {
    const value = params[key] == null ? fallback : Number(params[key]);
    if (!Number.isFinite(value) || value < min || value > max || (key === 'axleCount' && !Number.isInteger(value))) {
      throw invalid('Sprawdź parametry pojazdu: ' + key + '.');
    }
    result[key] = value;
  }
  if (result.axleWeightKg > result.grossWeightKg) throw invalid('Nacisk na oś nie może przekraczać masy całkowitej.');
  return result;
}

export function buildTomTomUrl(points, truckParams, apiKey, alternatives = false) {
  const truck = normalizeTruck(truckParams);
  if (!Array.isArray(points) || points.length < 2 || points.length > 20 || points.some(p =>
    !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) {
    throw invalid('Trasa musi mieć od 2 do 20 poprawnych punktów.');
  }
  const url = new URL('https://api.tomtom.com/routing/1/calculateRoute/' + points.map(p => `${p.lat},${p.lon}`).join(':') + '/json');
  const values = {
    key: apiKey, travelMode: 'truck', routeType: 'fastest', traffic: 'false',
    routeRepresentation: 'polyline', extendedRouteRepresentation: 'distance',
    maxAlternatives: alternatives && points.length === 2 ? 2 : 0,
    vehicleWeight: truck.grossWeightKg, vehicleAxleWeight: truck.axleWeightKg,
    vehicleHeight: truck.heightCm / 100, vehicleWidth: truck.widthCm / 100,
    vehicleLength: truck.lengthCm / 100, vehicleNumberOfAxles: truck.axleCount,
    vehicleCommercial: 'true', report: 'effectiveSettings',
  };
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
  for (const type of ['country', 'tollRoad', 'toll', 'ferry', 'carTrain', 'travelMode']) url.searchParams.append('sectionType', type);
  return url;
}

function kmBetween(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function routeCoordinates(route) {
  const raw = (route.legs || []).flatMap(leg => (leg.points || []).map(p => [p.longitude, p.latitude]));
  if (raw.length < 2 || raw.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) {
    throw new RoutingError('PROVIDER_DATA', 'Dostawca nie zwrócił poprawnej geometrii trasy.');
  }
  // Progress includes the final point index. Use it to disambiguate shared leg endpoints.
  const finalIndex = route.progress?.at(-1)?.pointIndex;
  if (finalIndex != null && finalIndex !== raw.length - 1) {
    const joined = [];
    for (const leg of route.legs) {
      const points = leg.points.map(p => [p.longitude, p.latitude]);
      if (joined.length && points[0]?.every((v, i) => v === joined.at(-1)[i])) points.shift();
      for (const point of points) joined.push(point);
    }
    if (finalIndex !== joined.length - 1) throw new RoutingError('PROVIDER_DATA', 'Nie udało się powiązać odcinków opłat z trasą.');
    return joined;
  }
  return raw;
}

function segmentLengths(coords, progress, totalMeters) {
  const lengths = coords.slice(1).map((p, i) => kmBetween(coords[i], p));
  const points = Array.isArray(progress) ? progress : [];
  const valid = points.length >= 2 && points[0].pointIndex === 0 && points.at(-1).pointIndex === coords.length - 1 &&
    points.every((p, i) => Number.isInteger(p.pointIndex) && Number.isFinite(p.distanceInMeters) && p.distanceInMeters >= 0 &&
      (!i || p.pointIndex > points[i-1].pointIndex && p.distanceInMeters >= points[i-1].distanceInMeters));
  const anchors = valid ? points : [{pointIndex:0, distanceInMeters:0}, {pointIndex:coords.length-1, distanceInMeters:totalMeters}];
  // Preserve every bend; distribute the provider's distance between progress anchors.
  for (let a = 1; a < anchors.length; a++) {
    const from = anchors[a-1].pointIndex, to = anchors[a].pointIndex;
    const sum = lengths.slice(from, to).reduce((s, n) => s + n, 0);
    const km = (anchors[a].distanceInMeters - anchors[a-1].distanceInMeters) / 1000;
    for (let i = from; i < to; i++) lengths[i] = sum ? lengths[i] * km / sum : km / (to - from);
  }
  return lengths;
}

export function parseTomTomRoute(route, truckParams = {}) {
  const truck = normalizeTruck(truckParams);
  const meters = route?.summary?.lengthInMeters, seconds = route?.summary?.travelTimeInSeconds;
  if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds < 0) {
    throw new RoutingError('PROVIDER_DATA', 'Dostawca zwrócił niepełne dane trasy.');
  }
  const coords = routeCoordinates(route);
  const lengths = segmentLengths(coords, route.progress, meters);
  const sections = Array.isArray(route.sections) ? route.sections : [];
  const countries = Array(lengths.length).fill(null), paid = Array(lengths.length).fill(false), crossing = Array(lengths.length).fill(false);
  let restrictedRoad = false;
  for (const s of sections) {
    if (!Number.isInteger(s.startPointIndex) || !Number.isInteger(s.endPointIndex) || s.startPointIndex < 0 ||
        s.endPointIndex < s.startPointIndex || s.endPointIndex >= coords.length) {
      throw new RoutingError('PROVIDER_DATA', 'Dostawca zwrócił niepoprawne odcinki trasy.');
    }
    for (let i = s.startPointIndex; i < s.endPointIndex; i++) {
      if (s.sectionType === 'COUNTRY') countries[i] = s.countryCode;
      if (['TOLL_ROAD', 'TOLL'].includes(s.sectionType)) paid[i] = true;
      if (['FERRY', 'CAR_TRAIN'].includes(s.sectionType)) crossing[i] = true;
    }
  }
  for (const s of sections.filter(s => s.sectionType === 'TRAVEL_MODE' && s.travelMode === 'other')) {
    for (let i = s.startPointIndex; i < s.endPointIndex; i++) if (!crossing[i] && lengths[i] > 0) restrictedRoad = true;
  }
  const by = new Map();
  let unknownKm = 0, crossingKm = 0;
  lengths.forEach((km, i) => {
    if (crossing[i]) { crossingKm += km; return; }
    const iso = countries[i];
    if (!iso) { unknownKm += km; return; }
    const row = by.get(iso) || {country_code:iso, country:COUNTRIES[iso]?.[0] || iso, km:0, toll_km:0};
    row.km += km;
    if (paid[i]) row.toll_km += km;
    by.set(iso, row);
  });
  const by_country = [...by.values()].map(row => {
    const rate = COUNTRIES[row.country_code]?.[1] ?? null;
    return {...row, km:round(row.km,1), toll_km:round(row.toll_km,1), rate_eur_per_km:rate,
      cost_eur: row.toll_km > 0 && rate == null ? null : round(row.toll_km * (rate || 0)),
      source:'TomTom sections + planning estimate'};
  });
  const warnings = ['Myto to szacunek z odcinków płatnych i stawek planistycznych z poprzedniej wersji aplikacji. Stawki nie są potwierdzoną taryfą dla daty, EURO/CO₂ i profilu pojazdu.'];
  if (truck.grossWeightKg !== 40000 || truck.axleCount !== 5) warnings.push('Stawki bazowe dotyczą zestawu 40 t / 5 osi. Dla tego pojazdu skoryguj myto ręcznie.');
  if (unknownKm > .1) warnings.push(`Nie przypisano kraju dla ${round(unknownKm,1)} km drogowych. Opłaty za te odcinki nie są wycenione.`);
  if (by_country.some(x => x.cost_eur == null)) warnings.push('Brakuje stawki dla części odcinków płatnych. Uzupełnij opłaty ręcznie.');
  if (by.has('GBR')) warnings.push('PL–GB / GB: sprawdź HGV Levy oraz opłaty lokalne. Wprowadź należną kwotę w „Prom / przeprawy”.');
  if (crossingKm > 0) warnings.push('Trasa zawiera prom lub pociąg samochodowy. Cena przeprawy nie jest zawarta w mycie; wpisz koszt rezerwacji osobno.');
  if (restrictedRoad) warnings.push('Dostawca wskazał odcinek drogowy poza wybranym trybem pojazdu. Sprawdź przejezdność.');
  const routing = {engine:'TomTom', quality:restrictedRoad ? 'review' : 'truck', truck_profile:truck};
  const tolls_geo = {
    status: !by.size ? 'unavailable' : unknownKm > .1 || by_country.some(x => x.cost_eur == null) ? 'partial' : 'estimated',
    total_eur: round(by_country.reduce((s, row) => s + (row.cost_eur || 0), 0)), by_country,
    unknown_km:round(unknownKm,1), crossing_km:round(crossingKm,1),
    rates_version:'legacy-project-2026-07-unverified', warnings, routing,
  };
  return {distance_km:round(meters/1000,1), duration_h:round(seconds/3600),
    geometry:{type:'LineString',coordinates:coords}, routing_engine:'TomTom', route_quality:routing.quality,
    requires_review:true, quote_ready:false, warnings, tolls_geo};
}

async function fetchJson(fetchImpl, url, provider, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {signal:controller.signal});
    if (!res.ok) {
      const codes = {401:'AUTH',403:'AUTH',429:'LIMIT',400:'REQUEST'};
      throw new RoutingError(`${provider}_${codes[res.status] || 'UNAVAILABLE'}`,
        res.status === 401 || res.status === 403 ? `${provider}: odrzucono dostęp do API. Sprawdź klucz i uprawnienia routingu.` :
        res.status === 429 ? `${provider}: przekroczono limit zapytań. Spróbuj później.` :
        `${provider}: nie udało się wyznaczyć trasy (HTTP ${res.status}). Sprawdź punkty i parametry pojazdu.`);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof RoutingError) throw e;
    throw new RoutingError(`${provider}_${controller.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE'}`,
      controller.signal.aborted ? `${provider}: przekroczono czas oczekiwania. Spróbuj ponownie.` : `${provider}: brak poprawnej odpowiedzi. Spróbuj ponownie.`);
  } finally { clearTimeout(timer); }
}

export function createRouteService({apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 20000} = {}) {
  return async function getRouteData(points, params = {}, alternatives = false) {
    // Validate before invoking either provider; no silent dropping of requested restrictions.
    const url = buildTomTomUrl(points, params, apiKey, alternatives);
    let failure;
    if (apiKey) {
      try {
        const data = await fetchJson(fetchImpl, url, 'TOMTOM', timeoutMs);
        if (!data.routes?.length) throw new RoutingError('NO_TRUCK_ROUTE', 'TomTom nie znalazł trasy dla tego pojazdu. Sprawdź punkty i parametry.');
        const parsed = data.routes.slice(0, alternatives ? 3 : 1).map(r => parseTomTomRoute(r, params));
        return alternatives ? parsed : parsed[0];
      } catch (e) { failure = e; }
    } else failure = new RoutingError('TOMTOM_NOT_CONFIGURED', 'Brak klucza routingu TomTom. Skonfiguruj TOMTOM_API_KEY w Railway.');
    if (params.allowApproximateRoute !== true) throw failure;
    const coordinates = points.map(p => `${p.lon},${p.lat}`).join(';');
    const data = await fetchJson(fetchImpl, `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&alternatives=${alternatives}&steps=false`, 'OSRM', timeoutMs);
    if (!data.routes?.length) throw new RoutingError('NO_PREVIEW_ROUTE', 'Nie znaleziono trasy poglądowej.');
    const warnings = [failure.message, 'PODGLĄD OSRM: trasa samochodowa bez ograniczeń ciężarowych. Nie używaj jej jako potwierdzonej trasy transportu.', 'Brak wyceny myta. Wartość 0 nie oznacza bezpłatnego przejazdu. Uzupełnij koszt ręcznie.'];
    const routes = data.routes.slice(0, alternatives ? 3 : 1).map(r => {
      if (!Number.isFinite(r.distance) || r.distance <= 0 || !Number.isFinite(r.duration) || !r.geometry?.coordinates?.length) {
        throw new RoutingError('PROVIDER_DATA', 'Niepełne dane podglądu OSRM.');
      }
      return {distance_km:round(r.distance/1000,1), duration_h:round(r.duration/3600), geometry:r.geometry,
        routing_engine:'OSRM', route_quality:'approximate', requires_review:true, quote_ready:false, warnings,
        tolls_geo:{status:'unavailable', total_eur:0, by_country:[], warnings, routing:{engine:'OSRM',quality:'approximate'}}};
    });
    return alternatives ? routes : routes[0];
  };
}
