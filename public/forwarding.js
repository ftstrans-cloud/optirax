import {PROFILES,DEFAULT_ASSUMPTIONS,calculate,parseEnquiry,customerOffer} from './forwarding-engine.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=2)=>Number(n).toLocaleString('pl-PL',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=n=>`${fmt(n)} EUR`;
let result=null,routeData=null,routeRequest=null,routeSequence=0,dirty=false,saving=false,revision=0,historyRows=[],parsed=null,map=null,mapLine=null,mapMarkers=[],tilesKey='';
const A={
  targetMargin:['Marża docelowa (%)',0,80],minimumMargin:['Marża minimalna (%)',0,80],
  tolls:['Myto (EUR)',0,10000],crossing:['Przeprawa (EUR)',0,10000],
  kmRate:['Koszt auta (EUR/km)',0,10],hourRate:['Koszt kierowcy (EUR/h)',0,200],
  deadheadKm:['Dojazd / objazd (km)',0,5000],averageSpeed:['Średnia prędkość (km/h)',10,100],
  fixed:['Obsługa zlecenia (EUR)',0,10000],extra:['Dopłaty, np. winda (EUR)',0,10000],
  waitingHours:['Postój (h)',0,200],waitingRate:['Koszt postoju (EUR/h)',0,10000],
  carrierMarkup:['Narzut przewoźnika (%)',0,100],uncertainty:['Rozpiętość zakupu ± (%)',0,50],
  minimumBuy:['Minimalny zakup (EUR)',0,10000],minimumShare:['Min. udział doładunku (%)',1,100],
};
const V={length:['Długość ładowni (cm)',100,1400],width:['Szerokość ładowni (cm)',100,300],height:['Wysokość ładowni (cm)',100,400],payload:['Ładowność (kg)',100,20000],grossWeightKg:['DMC do routingu (kg)',1000,40000],axleWeightKg:['Nacisk osi (kg)',500,20000],lengthCm:['Długość auta (cm)',200,2000],widthCm:['Szerokość auta (cm)',100,300],heightCm:['Wysokość auta (cm)',100,500],axleCount:['Liczba osi',2,6]};
function fields(spec,prefix,values){return Object.entries(spec).map(([k,[label,min,max]])=>`<label>${label}<input id="${prefix}-${k}" data-${prefix}="${k}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${k==='axleCount'?'1':'0.01'}" value="${esc(values[k])}"></label>`).join('');}
function initFields(){
  const main=['targetMargin','minimumMargin','tolls','crossing'];
  $('keyAssumptions').innerHTML=fields(Object.fromEntries(Object.entries(A).filter(([k])=>main.includes(k))),'a',DEFAULT_ASSUMPTIONS);
  $('otherAssumptions').innerHTML=fields(Object.fromEntries(Object.entries(A).filter(([k])=>!main.includes(k))),'a',DEFAULT_ASSUMPTIONS);
  setProfile();
}
function setProfile(){const v=PROFILES[$('profile').value];$('vehicleFields').innerHTML=fields(V,'v',v);$('a-kmRate').value=v.kmRate;$('a-hourRate').value=v.hourRate;}
function cargoRow(data={qty:1,length:120,width:80,height:'',weight:'',stackable:false}){
  if($('cargoRows').children.length>=30){message('Maksymalnie 30 pozycji ładunku.',true);return;}
  const row=document.createElement('div');row.className='cargo-row';
  row.innerHTML=`<div class="cargo-title"><span class="cargo-number"></span><button class="quiet remove-cargo" type="button" aria-label="Usuń pozycję ładunku">×</button></div><div class="cargo-fields">${[['qty','Szt.',1,200],['length','Dł. cm',1,1400],['width','Szer. cm',1,400],['height','Wys. cm',1,450],['weight','Kg/szt.',.1,20000]].map(([key,label,min,max])=>`<label>${label}<input data-cargo="${key}" type="number" min="${min}" max="${max}" step="${key==='qty'?'1':'.1'}" inputmode="decimal" value="${esc(data[key])}"></label>`).join('')}</div><label class="inline-check"><input type="checkbox" data-cargo="stackable" ${data.stackable?'checked':''}> Piętrowalna (do uzgodnienia)</label>`;
  $('cargoRows').appendChild(row);numberCargo();
}
function numberCargo(){document.querySelectorAll('.cargo-row').forEach((r,i)=>{r.querySelector('.cargo-number').textContent=`POZYCJA ${String(i+1).padStart(2,'0')}`;r.querySelector('.remove-cargo').disabled=$('cargoRows').children.length===1;});}
function offerRow(data={carrier:'',price:'',status:'received'}){
  if($('offerRows').children.length>=50){message('Maksymalnie 50 ofert przewoźników.',true);return;}
  const row=document.createElement('div');row.className='offer-row';
  row.dataset.needsConfirmation=String(data.needsConfirmation===true);
  row.innerHTML=`<div class="cargo-title"><span>PRZEWOŹNIK</span><button type="button" class="quiet remove-offer" aria-label="Usuń ofertę przewoźnika">×</button></div><label>Nazwa<input data-offer="carrier" maxlength="120" value="${esc(data.carrier)}" placeholder="Nazwa przewoźnika"></label><div class="fields two"><label>Cena EUR netto<input data-offer="price" type="number" min="0.01" max="1000000" step="0.01" value="${esc(data.price)}" inputmode="decimal"></label><label>Status<select data-offer="status"><option value="received">Otrzymana</option><option value="accepted">Przyjęta</option><option value="rejected">Odrzucona</option></select></label></div><p class="offer-compare">Przelicz, aby porównać ofertę z limitem zakupu.</p>`;
  row.querySelector('select').value=data.status;$('offerRows').appendChild(row);
}
function collectFields(selector,attribute){return Object.fromEntries([...document.querySelectorAll(selector)].map(el=>[el.getAttribute(attribute),el.type==='checkbox'?el.checked:el.value]));}
function collect(){return {profile:$('profile').value,mode:document.querySelector('[name=mode]:checked').value,
  route:{origin:$('origin').value,destination:$('destination').value,distanceKm:$('distanceKm').value,durationHours:routeData?routeData.duration_h:null,source:routeData?.routing_engine==='TomTom'?'TomTom':'manual'},
  vehicle:collectFields('[data-v]','data-v'),assumptions:collectFields('[data-a]','data-a'),
  cargo:[...document.querySelectorAll('.cargo-row')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-cargo]')].map(e=>[e.dataset.cargo,e.type==='checkbox'?e.checked:e.value]))),
  offers:[...document.querySelectorAll('.offer-row')].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-offer]')].map(e=>[e.dataset.offer,e.value])),needsConfirmation:row.dataset.needsConfirmation==='true'})),
  ...Object.fromEntries(['client','reference','pickup','delivery','notes','sellPrice'].map(id=>[id,$(id).value])),
  ...Object.fromEntries(['tailLift','palletJack','reviewed'].map(id=>[id,$(id).checked])),
};}
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;}
function invalidate(){
  result=null;dirty=true;revision++;$('result').hidden=true;$('emptyResult').hidden=false;$('resultTag').textContent='Przelicz';
  $('saveQuote').disabled=true;$('offerOpen').disabled=true;$('saveState').textContent='Zmiany nie są zapisane. Przelicz i zapisz nową wersję.';
  $('fitTag').textContent='Przelicz';$('loadMetrics').textContent='Dane zmienione — przelicz kontrolę ładunku.';
  $('warnings').replaceChildren();$('warningsCount').textContent='—';
  document.querySelectorAll('.offer-compare').forEach(e=>{e.textContent='Przelicz, aby porównać ofertę z limitem zakupu.';e.classList.remove('bad');});
}
function clearMap(){if(mapLine){map.removeLayer(mapLine);mapLine=null;}mapMarkers.forEach(m=>map.removeLayer(m));mapMarkers=[];}
function resetOfferScope(){document.querySelectorAll('.offer-row').forEach(row=>{row.dataset.needsConfirmation='true';const status=row.querySelector('[data-offer=status]');if(status.value==='accepted')status.value='received';});}
function invalidateRoute(clearDistance=true){
  routeSequence++;routeRequest?.abort();routeRequest=null;routeData=null;clearMap();$('fetchRoute').disabled=false;$('fetchRoute').textContent='Pobierz trasę';
  if(clearDistance)$('distanceKm').value='';
  $('routeStatus').textContent=clearDistance?'Trasa zmieniona. Pobierz nowy przebieg albo podaj sprawdzony dystans.':'Dystans ręczny — potwierdź przebieg oraz czas przejazdu.';
  $('mapCaption').textContent='Brak aktualnej trasy na mapie.';
}
function runCalculation(scroll=false){
  try{result=calculate(collect());render();$('message').hidden=true;if(scroll&&matchMedia('(max-width:700px)').matches)$('decisionTitle').scrollIntoView({behavior:'smooth',block:'start'});return true;}
  catch(e){result=null;$('saveQuote').disabled=true;$('offerOpen').disabled=true;message(e.message,true);$('message').scrollIntoView({behavior:'smooth',block:'center'});return false;}
}
function render(){
  const r=result;$('result').hidden=false;$('emptyResult').hidden=true;$('resultTag').textContent=r.blockers.length?'Sprawdź auto':r.input.reviewed?'Szacunek':'Sprawdź założenia';
  $('result').innerHTML=`${r.blockers.length?`<div class="blocker"><strong>Ładunek wymaga zmiany pojazdu lub danych.</strong><br>${r.blockers.map(esc).join('<br>')}</div>`:''}<div class="price-label">Cena dla klienta${r.input.sellPrice===null?' · sugerowana':''}</div><div class="price-value">${fmt(r.sell)} <small>EUR</small></div><p class="price-range">Zakup: ${money(r.buy)} · ${r.buySource==='accepted'?'przyjęta oferta':'model'}</p><div class="decision-stats"><div class="price-label">Zysk na zleceniu<strong>${money(r.profit)}</strong></div><div class="price-label">Marża od sprzedaży<strong>${fmt(r.margin,1)}%</strong></div></div><div class="decision-line"><span>Zakres zakupu z modelu</span><strong>${fmt(r.low,0)}–${fmt(r.high,0)} EUR</strong></div><div class="decision-line"><span>Propozycja na start</span><strong>${money(r.opening)}</strong></div><div class="decision-line"><span>Limit zakupu (${fmt(r.input.assumptions.minimumMargin,0)}% marży)</span><strong>${money(r.maxBuy)}</strong></div><div class="status-note ${r.overBudget?'bad':''}">${r.overBudget?'Zakup przekracza limit. Podnieś cenę klienta lub negocjuj zakup.':'Zakup mieści się w limicie przy aktualnej cenie sprzedaży.'}</div><details><summary>Skąd ta cena?</summary><div class="decision-line"><span>Koszt całej relacji</span><strong>${money(r.costs.linehaul)}</strong></div><div class="decision-line"><span>Udział przesyłki</span><strong>${fmt(r.share*100,1)}%</strong></div><div class="decision-line"><span>Dojazd + obsługa + dopłaty</span><strong>${money(r.costs.shipment)}</strong></div><div class="decision-line"><span>Koszt modelowy</span><strong>${money(r.costs.operating)}</strong></div><p class="hint">Koszt modelowy × (1 + narzut przewoźnika), z minimum zakupu. Cena sprzedaży = zakup ÷ (1 − marża docelowa). Doładunek: największy udział wagi, objętości lub podłogi, nie mniej niż ustawione minimum. Koszty dojazdu i obsługi przypisane w całości.</p></details>`;
  $('loadMetrics').innerHTML=`<div class="load-total"><div><strong>${r.summary.pieces}</strong><small>sztuk</small></div><div><strong>${fmt(r.summary.volume,2)}</strong><small>m³</small></div><div><strong>${fmt(r.summary.ldm,2)}</strong><small>LDM / szer. 2,4 m</small></div></div>${[['weight','Ładowność',`${fmt(r.summary.weight,0)} / ${fmt(r.input.vehicle.payload,0)} kg`],['floor','Podłoga',`${fmt(r.summary.area,2)} m²`],['volume','Objętość',`${fmt(r.summary.volume,2)} m³`]].map(([key,label,detail])=>`<div class="capacity ${r.shares[key]>1?'over':''}"><div><span>${label} · ${esc(detail)}</span><strong>${fmt(r.shares[key]*100,0)}%</strong></div><progress max="1" value="${Math.min(1,r.shares[key])}" aria-label="${label}"></progress></div>`).join('')}`;
  $('fitTag').textContent=r.blockers.length?'Przekroczone limity':'Wstępna kontrola';
  $('warnings').innerHTML=[...r.blockers,...r.warnings,...(!r.input.pickup||!r.input.delivery?['Uzupełnij daty przed przygotowaniem oferty dla klienta.']:[])].map(w=>`<li>${esc(w)}</li>`).join('');$('warningsCount').textContent=$('warnings').children.length;
  $('saveQuote').disabled=saving;$('offerOpen').disabled=!r.ready;
  $('saveState').textContent=r.ready?'Możesz zapisać wersję i przygotować wstępną ofertę.':'Zapis szkicu jest dostępny. Oferta klienta wymaga dat, sprawdzonych założeń i zgodności ładunku.';
  document.querySelectorAll('.offer-row').forEach((row,index)=>{const o=r.input.offers[index],p=row.querySelector('.offer-compare'),delta=r.maxBuy-o.price;p.classList.toggle('bad',delta<0||o.needsConfirmation);p.textContent=`${o.needsConfirmation?'Warunki przesyłki zmienione — potwierdź ponownie z przewoźnikiem przed przyjęciem. ':''}${o.status==='rejected'?'Odrzucona · ':''}${delta<0?'Ponad limit o':'Zapas do limitu:'} ${money(Math.abs(delta))}. Marża przy tej ofercie: ${fmt((r.sell-o.price)/r.sell*100,1)}%.`;});
}
async function api(url,options={}){const response=await fetch(url,options);let data;try{data=await response.json();}catch{throw Error('Nieprawidłowa odpowiedź serwera. Odśwież aplikację i spróbuj ponownie.');}if(!response.ok)throw Error(data.error||'Nie udało się wykonać operacji.');return data;}
async function fetchRoute(){
  const origin=$('origin').value.trim(),destination=$('destination').value.trim();
  if(!origin||!destination){message('Podaj oba adresy.',true);return;}
  invalidateRoute(false);$('reviewed').checked=false;invalidate();const seq=routeSequence;const controller=new AbortController();routeRequest=controller;
  $('fetchRoute').disabled=true;$('fetchRoute').textContent='Wyznaczanie…';$('routeStatus').textContent='Pobieranie trasy z profilem wybranego auta…';
  try{
    const vehicle=collectFields('[data-v]','data-v');const truckParams=Object.fromEntries(['grossWeightKg','axleWeightKg','lengthCm','widthCm','heightCm','axleCount'].map(k=>[k,vehicle[k]]));
    const data=await api('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,destination,truckParams}),signal:controller.signal});
    if(seq!==routeSequence)return;
    if(data.routing_engine!=='TomTom'||!Number.isFinite(data.distance_km)||!Number.isFinite(data.duration_h))throw Error('Brak potwierdzonej trasy TomTom. Możesz wpisać zweryfikowany dystans ręcznie.');
    routeData=data;$('distanceKm').value=data.distance_km;
    $('routeStatus').textContent=`${fmt(data.distance_km,1)} km · czas jazdy ${fmt(data.duration_h,1)} h (bez planowania odpoczynków). Sprawdź rozpoznane adresy na mapie.`;
    $('mapCaption').textContent=`A: ${data.origin_resolved||origin} → B: ${data.destination_resolved||destination}. Sprawdź punkty i przebieg. Myto nie zostało przeniesione — uzupełnij koszt dla tego auta.`;
    drawMap(data);dirty=true;
  }catch(e){if(seq===routeSequence&&e.name!=='AbortError'){message(e.message,true);$('routeStatus').textContent='Nie pobrano trasy. Podaj sprawdzony dystans ręcznie lub spróbuj ponownie.';}}
  finally{if(seq===routeSequence){$('fetchRoute').disabled=false;$('fetchRoute').textContent='Pobierz trasę';routeRequest=null;}}
}
function drawMap(data){
  if(!window.L){$('routeMap').textContent='Mapa nie mogła się załadować. Dystans pochodzi z TomTom; sprawdź rozpoznane adresy poniżej.';return;}
  const coords=data.geometry?.coordinates?.map(p=>[p[1],p[0]]);if(!coords?.length)return;
  if(!map){$('routeMap').replaceChildren();map=L.map('routeMap',{scrollWheelZoom:false});
    const tile=tilesKey?`https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(tilesKey)}&language=pl&view=Unified`:'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    L.tileLayer(tile,{maxZoom:19,attribution:tilesKey?'© TomTom © OpenStreetMap':'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  }
  clearMap();mapLine=L.polyline(coords,{color:'#157258',weight:5}).addTo(map);
  [coords[0],coords.at(-1)].forEach((point,index)=>{const m=L.circleMarker(point,{radius:7,color:'#fff',weight:3,fillColor:index?'#d39157':'#157258',fillOpacity:1}).addTo(map);m.bindTooltip(index?'B · Rozładunek':'A · Załadunek');mapMarkers.push(m);});
  if($('mapDetails').open){map.invalidateSize();map.fitBounds(mapLine.getBounds(),{padding:[22,22]});}
}
async function saveQuote(){
  if(!result||saving)return;saving=true;$('saveQuote').disabled=true;$('saveQuote').textContent='Zapisywanie…';const currentRevision=revision;
  try{await api('/api/forwarding/quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result.input)});if(currentRevision===revision){dirty=false;$('saveState').textContent='Zapisano nową wersję na koncie.';}message(currentRevision===revision?'Wycena zapisana. Znajdziesz ją w historii poniżej.':'Zapisano poprzednią wersję. Nowsze zmiany w formularzu wymagają osobnego zapisu.');await loadHistory();}
  catch(e){message(e.message,true);$('saveState').textContent='Nie zapisano. Dane pozostają w formularzu.';}
  finally{saving=false;$('saveQuote').textContent='Zapisz wersję';$('saveQuote').disabled=!result;}
}
async function loadHistory(){
  $('refreshHistory').disabled=true;
  try{historyRows=await api('/api/forwarding/quotes');renderHistory();}
  catch(e){$('history').textContent=e.message;}
  finally{$('refreshHistory').disabled=false;}
}
function renderHistory(){
  if(!historyRows.length){$('history').innerHTML='<div class="history-empty">Pierwsza wycena czeka na zapis. Tutaj zbudujesz własny punkt odniesienia do kolejnych zakupów.</div>';return;}
  $('history').innerHTML=`<div class="history-table"><table><thead><tr><th>ZAPIS / KLIENT</th><th>RELACJA</th><th>ZAKUP</th><th>SPRZEDAŻ</th><th>MARŻA</th><th><span class="muted">WERSJA</span></th></tr></thead><tbody>${historyRows.map((row,index)=>{const s=row.calc?.forwarding;return `<tr><td>${esc(new Date(Number(row.ts)).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}<small>${esc(row.client||row.name||'Bez nazwy')}</small></td><td class="history-route">${esc(row.origin)} → ${esc(row.destination)}<small>${esc(PROFILES[row.input?.profile]?.name||'')} · ${row.input?.mode==='partload'?'Doładunek':'Dedykowany'}</small></td><td class="numeric">${money(s?.buy??row.total_cost??0)}<small>${s?.buySource==='accepted'?'Przyjęta oferta':'Model'}</small></td><td class="numeric">${money(row.price_eur??0)}</td><td class="numeric">${fmt(row.margin_pct??0,1)}%</td><td><button type="button" class="secondary" data-load="${index}">Wczytaj</button></td></tr>`;}).join('')}</tbody></table></div>`;
}
function loadInput(input){
  invalidateRoute();$('profile').value=input.profile;setProfile();
  for(const key of Object.keys(V))$(`v-${key}`).value=input.vehicle[key];
  for(const key of Object.keys(A))$(`a-${key}`).value=input.assumptions[key];
  for(const id of ['client','reference','pickup','delivery','notes','sellPrice'])$(id).value=input[id]??'';
  for(const id of ['tailLift','palletJack'])$(id).checked=input[id]===true;
  $('reviewed').checked=false;
  document.querySelector(`[name=mode][value="${input.mode==='partload'?'partload':'dedicated'}"]`).checked=true;
  $('origin').value=input.route.origin;$('destination').value=input.route.destination;$('distanceKm').value=input.route.distanceKm;
  $('cargoRows').replaceChildren();input.cargo.forEach(cargoRow);$('offerRows').replaceChildren();(input.offers||[]).forEach(offerRow);
  // Preserve the stored cost inputs; an archived distance/time does not imply a current map.
  routeData={duration_h:input.route.durationHours,routing_engine:input.route.source,archived:true};
  invalidate();runCalculation();dirty=false;
  $('routeStatus').textContent='Dystans i czas z zapisanej wersji. Pobierz trasę ponownie, aby je odświeżyć i pokazać mapę.';
  $('saveState').textContent='Wczytano dane. Ponownie potwierdź założenia przed ofertą. Zapis utworzy nową wersję.';
  $('workspace').scrollIntoView({behavior:'smooth'});
}

initFields();cargoRow();
if(matchMedia('(max-width:700px)').matches)$('mapDetails').open=false;
$('workspace').addEventListener('submit',e=>{e.preventDefault();runCalculation(true);});
$('workspace').addEventListener('input',e=>{
  if(e.target.id==='profile')return;
  if(['origin','destination','pickup','delivery','notes','tailLift','palletJack'].includes(e.target.id)||e.target.dataset.cargo||e.target.dataset.v||e.target.name==='mode')resetOfferScope();
  if(['origin','destination'].includes(e.target.id)||['grossWeightKg','axleWeightKg','lengthCm','widthCm','heightCm','axleCount'].includes(e.target.dataset.v))invalidateRoute();
  if(e.target.id==='distanceKm')invalidateRoute(false);
  if(e.target.id!=='reviewed')$('reviewed').checked=false;
  invalidate();
});
$('workspace').addEventListener('change',e=>{
  if(e.target.id==='profile'){setProfile();invalidateRoute();resetOfferScope();$('reviewed').checked=false;invalidate();}
  if(e.target.dataset.offer==='status'&&e.target.value==='accepted'){e.target.closest('.offer-row').dataset.needsConfirmation='false';document.querySelectorAll('[data-offer=status]').forEach(el=>{if(el!==e.target&&el.value==='accepted')el.value='received';});invalidate();}
});
$('workspace').addEventListener('click',e=>{
  const cargo=e.target.closest('.remove-cargo'),offer=e.target.closest('.remove-offer');
  if(cargo&&$('cargoRows').children.length>1){cargo.closest('.cargo-row').remove();numberCargo();resetOfferScope();$('reviewed').checked=false;invalidate();}
  if(offer){offer.closest('.offer-row').remove();invalidate();}
});
$('addCargo').onclick=()=>{cargoRow();resetOfferScope();$('reviewed').checked=false;invalidate();};
$('addOffer').onclick=()=>{offerRow();invalidate();};
$('fetchRoute').onclick=fetchRoute;$('saveQuote').onclick=saveQuote;$('refreshHistory').onclick=loadHistory;
$('mapDetails').addEventListener('toggle',()=>{if(map&&$('mapDetails').open){map.invalidateSize();if(mapLine)map.fitBounds(mapLine.getBounds(),{padding:[22,22]});}});
$('newQuote').onclick=()=>{if(!dirty||confirm('Odrzucić niezapisane zmiany i rozpocząć nową wycenę?')){dirty=false;location.reload();}};
$('logout').onclick=()=>{if(dirty&&!confirm('Wylogować i odrzucić niezapisane zmiany?'))return;dirty=false;for(const k of ['optirax_token','optirax_refresh','optirax_profile','optirax_user'])localStorage.removeItem(k);location.href='/login';};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('pasteOpen').onclick=()=>{$('pasteDialog').showModal();};
$('enquiry').addEventListener('input',()=>{parsed=null;$('parsePreview').hidden=true;$('applyEnquiry').hidden=true;});
$('parseEnquiry').onclick=()=>{
  try{parsed=parseEnquiry($('enquiry').value);$('parsePreview').textContent=[`A: ${parsed.origin||'nie odczytano'}`,`B: ${parsed.destination||'nie odczytano'}`,...parsed.cargo.map(c=>`${c.qty||'?'} szt. × ${c.length}×${c.width}×${c.height} cm; ${c.weight||'?'} kg/szt.`),parsed.warning].join('\n');$('parsePreview').hidden=false;$('applyEnquiry').hidden=!(parsed.origin||parsed.destination||parsed.cargo.length);}
  catch(e){$('parsePreview').textContent=e.message;$('parsePreview').hidden=false;$('applyEnquiry').hidden=true;}
};
$('applyEnquiry').onclick=()=>{
  if(!parsed)return;if(dirty&&!confirm('Zastąpić odczytane adresy i pozycje przesyłki danymi z zapytania? Pozostałe pola pozostaną bez zmian.'))return;
  invalidateRoute();if(parsed.origin)$('origin').value=parsed.origin;if(parsed.destination)$('destination').value=parsed.destination;
  if(parsed.cargo.length){$('cargoRows').replaceChildren();parsed.cargo.forEach(cargoRow);}
  resetOfferScope();$('reviewed').checked=false;invalidate();$('pasteDialog').close();message(parsed.warning);
};
$('offerOpen').onclick=()=>{try{$('customerText').value=customerOffer(result);$('copyStatus').textContent='';$('offerDialog').showModal();}catch(e){message(e.message,true);}};
$('copyOffer').onclick=async()=>{try{await navigator.clipboard.writeText($('customerText').value);$('copyStatus').textContent='Skopiowano treść oferty.';}catch{$('customerText').focus();$('customerText').select();$('copyStatus').textContent='Zaznaczono treść. Skopiuj ją ręcznie (Ctrl/Cmd+C).';}};
$('printOffer').onclick=()=>{$('printArea').textContent=$('customerText').value;$('offerDialog').close();window.print();};
$('history').onclick=e=>{const button=e.target.closest('[data-load]');if(!button)return;if(dirty&&!confirm('Wczytać zapis i odrzucić niezapisane zmiany?'))return;const row=historyRows[Number(button.dataset.load)];try{calculate(row.input);loadInput(row.input);}catch(err){message('Nie można wczytać tej wersji: '+err.message,true);}};
if(localStorage.getItem('optirax_token')){
  loadHistory();
  api('/api/auth/profile').then(p=>{$('accountLabel').textContent=`${String(p.plan||'konto').toUpperCase()} · ${p.email||'Optirax'}`;}).catch(()=>{$('accountLabel').textContent='Optirax';});
  api('/api/config').then(c=>{tilesKey=c.tomtomTilesKey||'';}).catch(()=>{});
}
