// Quality metadata stays inside tolls_geo (an existing JSON field in history).
window.RouteQuality = (() => {
  let validFingerprint = null;
  let phase = 'idle';
  const field = id => document.getElementById(id);
  const truckIds = ['truck_grossWeight','truck_axleWeight','truck_height','truck_width','truck_length','truck_axleCount'];
  function fingerprint() {
    return JSON.stringify({route:typeof getRouteFromUI === 'function' ? getRouteFromUI() : {},
      truck:truckIds.map(id => field(id)?.value), preset:document.querySelector('.vehicleBtn.active')?.dataset?.preset,
      approximate:!!field('allowApproximateRoute')?.checked});
  }
  function message(text) {
    const el = field('routeQuality');
    if (el) { el.hidden = false; el.textContent = text; }
  }
  function invalidate(text = 'Trasa lub pojazd zostały zmienione. Pobierz trasę ponownie.') {
    phase = 'invalid'; validFingerprint = null;
    clearTimeout(window._deferredSaveTimer);
    window.lastCalc = null; window.lastInput = null; window.lastEvaluation = null;
    window.lastRoutePayload = null; window.lastRouteTollsGeo = null;
    window.lastRouteTollsGeoAdj = null; window.lastRouteVignettes = null;
    for (const id of ['base_distance_km','distance_km','tolls_eur']) if (field(id)) field(id).value = 0;
    for (const id of ['kpi_total','kpi_price','kpi_margin','routeScore','scoreValue','eurKmValue','tollsTotal']) if (field(id)) field(id).textContent = '—';
    for (const id of ['costTable','tollsTable','aiReport']) if (field(id)) field(id).textContent = '';
    if (field('tollsSource')) field('tollsSource').textContent = 'Brak aktualnej wyceny myta.';
    message(text);
  }
  function begin() {
    invalidate('Wyznaczam trasę dla podanego pojazdu…');
    phase = 'loading';
    return fingerprint();
  }
  function accept(data, expected = fingerprint()) {
    if (expected !== fingerprint()) { invalidate(); return false; }
    phase = 'ready'; validFingerprint = expected;
    window.lastRouteTollsGeo = data.tolls_geo || null;
    render();
    return true;
  }
  function canCalculate() {
    if (phase === 'ready' && validFingerprint === fingerprint()) return true;
    if (phase !== 'loading') invalidate('Pobierz aktualną trasę przed kalkulacją, zapisem lub eksportem.');
    return false;
  }
  function description(tg = window.lastRouteTollsGeo) {
    const routing = tg?.routing;
    const source = routing?.engine ? `Trasa: ${routing.engine}${routing.quality === 'approximate' ? ' — podgląd samochodowy' : ' — profil ciężarowy'}.` : 'Trasa z historii — źródło niezweryfikowane.';
    const tolls = tg?.status === 'unavailable' ? 'Myto: brak wyceny.' : 'Myto: szacunek, wymaga sprawdzenia.';
    return `${source} ${tolls}`;
  }
  function notes(tg = window.lastRouteTollsGeo) {
    const items = [...(tg?.warnings || [])];
    if (!tg?.routing) items.push('Starsza wycena nie zawiera informacji o źródle trasy. Pobierz trasę ponownie przed ofertą.');
    const base = Number(tg?.total_eur || 0) + Number(window.lastRouteVignettes?.total_eur || 0);
    const entered = Number(field('tolls_eur')?.value || 0);
    if (Math.abs(base - entered) > .01) items.push(`Ręczna korekta myta: w kalkulacji ${entered.toFixed(2)} EUR. Tabela krajów pokazuje szacunek przed korektą.`);
    return [...new Set(items)];
  }
  function render() {
    const tg = window.lastRouteTollsGeo;
    message([description(tg), ...notes(tg)].join('\n'));
    if (field('tollsSource')) field('tollsSource').textContent = description(tg);
  }
  function checkChanged() {
    if (phase === 'ready' && fingerprint() !== validFingerprint) invalidate();
  }
  document.addEventListener('input', checkChanged);
  document.addEventListener('change', checkChanged);
  document.addEventListener('click', () => queueMicrotask(checkChanged));
  return {fingerprint, begin, accept, invalidate, canCalculate, description, notes, render};
})();
