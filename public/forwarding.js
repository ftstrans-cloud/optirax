import {setupRouteInputs} from './forwarding-route.js?v=1.8.0';
import {PROFILES,DEFAULT_ASSUMPTIONS,MONEY_ASSUMPTIONS,calculate,parseEnquiry,customerOffer,normalizeCurrency,normalizeExchangeRate,convertMoney} from './forwarding-engine.js?v=1.8.0';
import {setupEnquiryImport} from './enquiry-import.js?v=1.6.0';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=2)=>Number(n).toLocaleString('pl-PL',{minimumFractionDigits:d,maximumFractionDigits:d});
let currentCurrency='EUR',currentProfile='bus',fxMeta=null;
function applyTheme(theme){document.documentElement.dataset.theme=theme;$('themeToggle').textContent=theme==='dark'?'Tryb jasny':'Tryb ciemny';try{localStorage.setItem('optirax_theme',theme);}catch{}}
let storedTheme;try{storedTheme=localStorage.getItem('optirax_theme');}catch{}
applyTheme(storedTheme==='light'?'light':'dark');
$('themeToggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
const currencySymbol=code=>code==='PLN'?'zł':'EUR';
const money=(n,currency=currentCurrency)=>`${fmt(n)} ${currencySymbol(currency)}`;
let routeKey='',result=null,routeData=null,routeRequest=null,routeSequence=0,dirty=false,saving=false,revision=0,historyRows=[],map=null,mapLine=null,mapMarkers=[],tilesKey='';
const A={
  targetMargin:['Marża docelowa (%)',0,80],minimumMargin:['Marża minimalna (%)',0,80],
  tolls:['Myto (EUR)',0,10000],crossing:['Przeprawa (EUR)',0,10000],
  kmRate:['Koszt auta (EUR/km)',0,10],hourRate:['Koszt kierowcy (EUR/h)',0,200],
  deadheadKm:['Dojazd / objazd (km)',0,5000],averageSpeed:['Średnia prędkość (km/h)',10,100],
  fixed:['Obsługa zlecenia (EUR)',0,10000],extra:['Dopłaty, np. winda (EUR)',0,10000],
  waitingHours:['Postój (h)',0,200],waitingRate:['Koszt postoju (EUR/h)',0,10000],
  carrierMarkup:['Narzut przewoźnika (%)',0,100],uncertainty:['Rozpiętość zakupu ± (%)',0,50],
  minimumBuy:['Minimalny zakup (EUR)',0,10000],minimumShare:['Min. udział doładunku (%)',1,100],reeferSurcharge:['Dopłata chłodnicza (EUR)',0,10000],
};
const V={length:['Długość ładowni (cm)',100,1400],width:['Szerokość ładowni (cm)',100,300],height:['Wysokość ładowni (cm)',100,400],payload:['Ładowność (kg)',100,30000],grossWeightKg:['DMC do routingu (kg)',1000,40000],axleWeightKg:['Nacisk osi (kg)',500,20000],lengthCm:['Długość auta (cm)',200,2000],widthCm:['Szerokość auta (cm)',100,300],heightCm:['Wysokość auta (cm)',100,500],axleCount:['Liczba osi',2,6]};
function fields(spec,prefix,values){return Object.entries(spec).map(([k,[label,min,max]])=>`<label>${label}<input id="${prefix}-${k}" data-${prefix}="${k}" ${prefix==='a'&&MONEY_ASSUMPTIONS.includes(k)?'data-money="assumption"':''} type="number" inputmode="decimal" min="${min}" max="${max}" step="${k==='axleCount'?'1':prefix==='a'&&MONEY_ASSUMPTIONS.includes(k)?'any':'0.01'}" value="${esc(values[k])}"></label>`).join('');}
function clearMoneyAnchor(el){for(const key of ['anchorAmount','anchorCurrency','anchorRate','renderedAmount'])delete el.dataset[key];}
function syncCurrencyLabels(){
  let rate=null;try{rate=normalizeExchangeRate($('eurPln').value);}catch{}
  const scale=currentCurrency==='PLN'&&rate?rate:1;
  document.querySelectorAll('[data-money]').forEach(el=>{
    const label=el.closest('label');label.dataset.currencyLabel??=label.firstChild.textContent;
    label.firstChild.textContent=label.dataset.currencyLabel.replace(/EUR/g,currentCurrency);
    el.dataset.maxEur??=el.max;el.max=Number(el.dataset.maxEur)*scale;
  });
  const profileLabel=PROFILES[currentProfile]?.name||'profil pojazdu';
  $('currencyCaption').textContent=`${profileLabel} · kwoty w ${currentCurrency} netto`;
}
function switchCurrency(){
  const target=$('quoteCurrency').value,hadResult=!!result;
  try{
    normalizeCurrency(target);const rate=normalizeExchangeRate($('eurPln').value,target!==currentCurrency);
    const changes=[...document.querySelectorAll('[data-money]')].map(el=>{
      if(el.value==='')return {el,value:'',anchor:null};
      const anchor=el.dataset.renderedAmount===el.value&&Number(el.dataset.anchorRate)===rate
        ?{amount:Number(el.dataset.anchorAmount),currency:el.dataset.anchorCurrency}
        :{amount:Number(el.value),currency:currentCurrency};
      const value=convertMoney(anchor.amount,anchor.currency,target,rate);
      return {el,value:target===anchor.currency?String(anchor.amount):String(Number(value.toFixed(el.dataset.money==='price'?2:8))),anchor};
    });
    changes.forEach(({el,value,anchor})=>{el.value=value;if(anchor){el.dataset.anchorAmount=anchor.amount;el.dataset.anchorCurrency=anchor.currency;el.dataset.anchorRate=rate;el.dataset.renderedAmount=el.value;}else clearMoneyAnchor(el);});
    currentCurrency=target;syncCurrencyLabels();$('reviewed').checked=false;invalidate();$('message').hidden=true;if(hadResult)runCalculation();
  }catch(e){$('quoteCurrency').value=currentCurrency;message(e.message,true);$('fxDetails').open=true;$('eurPln').focus();}
}
function initFields(){
  const margins=['targetMargin','minimumMargin'],main=['kmRate','hourRate','tolls','crossing'];
  $('marginAssumptions').innerHTML=fields(Object.fromEntries(Object.entries(A).filter(([k])=>margins.includes(k))),'a',DEFAULT_ASSUMPTIONS);
  $('keyAssumptions').innerHTML=fields(Object.fromEntries(Object.entries(A).filter(([k])=>main.includes(k))),'a',DEFAULT_ASSUMPTIONS);
  $('otherAssumptions').innerHTML=fields(Object.fromEntries(Object.entries(A).filter(([k])=>!main.includes(k)&&!margins.includes(k))),'a',DEFAULT_ASSUMPTIONS);
  setProfile();
}
function syncModelMode(){
  const enabled=$('useCostModel').checked;
  $('pricingNotice').textContent=enabled?'Model negocjacyjny. Przykładowe koszty wymagają dopasowania do Twoich zakupów. Wynik modelu nie jest stawką rynkową.':'Wycena z oferty przewoźnika. Zakup pochodzi z wybranej oferty, a cenę klienta określa marża lub wpisana kwota sprzedaży.';
  $('modelAssumptions').disabled=!enabled;$('modelAssumptions').hidden=!enabled;
  $('modelStatus').textContent=enabled?'Opcjonalny szacunek zakupu na podstawie kilometrów i kosztów auta.':'Model wyłączony. Stawki i koszty modelowe są pomijane. Wybierz ofertę przewoźnika po prawej.';
}
function setProfile(){
  const v=PROFILES[$('profile').value],rate=currentCurrency==='PLN'?normalizeExchangeRate($('eurPln').value,true):null;
  if(!v)throw Error('Nieprawidłowy profil pojazdu.');
  $('vehicleFields').innerHTML=fields(V,'v',v);
  for(const k of ['kmRate','hourRate']){const el=$(`a-${k}`);el.value=Number(convertMoney(v[k],'EUR',currentCurrency,rate).toFixed(8));clearMoneyAnchor(el);}
  currentProfile=$('profile').value;
  $('reeferTemperatureField').hidden=currentProfile!=='reefer136';
  if(currentProfile!=='reefer136')$('reeferTemperature').value='';
  syncCurrencyLabels();
}
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
  row.dataset.importSource=data.importSource||'';
  row.innerHTML=`<div class="cargo-title"><span>PRZEWOŹNIK</span><button type="button" class="quiet remove-offer" aria-label="Usuń ofertę przewoźnika">×</button></div><label>Nazwa<input data-offer="carrier" maxlength="120" value="${esc(data.carrier)}" placeholder="Nazwa przewoźnika"></label><div class="fields two"><label>Cena EUR netto<input data-offer="price" data-money="price" type="number" min="0.01" max="1000000" step="0.01" value="${esc(data.price)}" inputmode="decimal"></label><label>Status<select data-offer="status"><option value="received">Otrzymana</option><option value="accepted">Przyjęta</option><option value="rejected">Odrzucona</option></select></label></div><p class="offer-compare">Przelicz, aby porównać ofertę z limitem zakupu.</p>`;
  row.insertAdjacentHTML('beforeend',`<label>Warunki oferty<textarea data-offer="terms" maxlength="1500" rows="2" placeholder="Termin, winda, dopłaty…">${esc(data.terms||'')}</textarea></label>${data.importSource?`<details><summary>Oryginalny odczyt oferty</summary><pre>${esc(data.importSource)}</pre></details>`:''}`);
  row.querySelector('select').value=data.status;$('offerRows').appendChild(row);syncCurrencyLabels();
  renderSelectedOfferPicker();
}
function renderSelectedOfferPicker(){
  const rows=[...document.querySelectorAll('.offer-row')];
  const offers=rows.map((row,index)=>({index,carrier:row.querySelector('[data-offer=carrier]').value.trim()||`Przewoźnik ${index+1}`,price:Number(row.querySelector('[data-offer=price]').value),status:row.querySelector('[data-offer=status]').value,terms:row.querySelector('[data-offer=terms]').value,needsConfirmation:row.dataset.needsConfirmation==='true'}));
  const accepted=offers.find(o=>o.status==='accepted'),modelEnabled=$('useCostModel').checked;
  const option=(value,name,price,selected,detail,disabled=false)=>`<button type="button" class="purchase-option" data-use-offer="${value}" aria-pressed="${selected}" ${disabled?'disabled':''}><span class="purchase-dot" aria-hidden="true">${selected?'✓':''}</span><span class="purchase-name"><strong>${esc(name)}</strong><small>${esc(detail)}</small></span><strong class="purchase-price">${price}</strong></button>`;
  $('selectedOfferBox').innerHTML=option('','Koszt modelowy',result&&modelEnabled?money(result.modelBuy):'—',modelEnabled&&!accepted,modelEnabled?'Szacunek kalkulatora':'Wyłączony w założeniach wyceny',!modelEnabled)+offers.map(o=>option(o.index,o.carrier,o.price>0?money(o.price):'Brak ceny',accepted?.index===o.index,o.status==='rejected'?'Odrzucona':o.needsConfirmation?'Potwierdź ponownie warunki przed wyborem':o.terms||'Oferta przewoźnika',o.status==='rejected'||!Number.isFinite(o.price)||o.price<=0)).join('');
  $('offersCount').textContent=String(offers.length);
  $('purchaseStatus').textContent=accepted?(result?`W wycenie: ${accepted.carrier}. ${$('sellPrice').value?'Cena klienta jest wpisana ręcznie — zmieniają się zysk i marża.':'Cena klienta wynika z wybranej oferty i marży docelowej.'}`:`Wybrano: ${accepted.carrier}. Uzupełnij dane i przelicz wycenę.`):offers.length?'Wybierz ofertę, aby zastąpić koszt modelowy.':'Dodaj lub wklej ofertę przewoźnika, aby użyć jej w wycenie.';
}
function useSelectedOffer(choice){
  if(choice===''&&!$('useCostModel').checked)return;
  const rows=[...document.querySelectorAll('.offer-row')];
  const selected=choice===''?null:rows[Number(choice)];
  if(choice!==''&&(!selected||!selected.querySelector('[data-offer=price]').checkValidity()||Number(selected.querySelector('[data-offer=price]').value)<=0||selected.querySelector('[data-offer=status]').value==='rejected'))return;
  if(selected?.dataset.needsConfirmation==='true'&&!confirm('Czy potwierdzono z przewoźnikiem cenę i warunki dla aktualnej przesyłki?'))return;
  rows.forEach(row=>{
    const status=row.querySelector('[data-offer=status]');
    if(row===selected){status.value='accepted';row.dataset.needsConfirmation='false';}
    else if(status.value==='accepted')status.value='received';
  });
  $('reviewed').checked=false;
  invalidate();runCalculation();
  // Restore keyboard focus after rebuilding the list of purchase options.
  [...$('selectedOfferBox').querySelectorAll('[data-use-offer]')].find(el=>el.dataset.useOffer===choice)?.focus({preventScroll:true});
}
function collectFields(selector,attribute){return Object.fromEntries([...document.querySelectorAll(selector)].map(el=>[el.getAttribute(attribute),el.type==='checkbox'?el.checked:el.value]));}
function collect(){return {useCostModel:$('useCostModel').checked,currency:currentCurrency,eurPln:$('eurPln').value,fxSource:fxMeta?.fxSource||null,fxDate:fxMeta?.fxDate||null,fxTable:fxMeta?.fxTable||null,profile:$('profile').value,reeferTemperature:$('reeferTemperature').value,mode:document.querySelector('[name=mode]:checked').value,
  route:{origin:$('origin').value,destination:$('destination').value,stops:routeInputs.getStops(),snapshot:routeData?.snapshot||null,distanceKm:$('distanceKm').value,durationHours:routeData?routeData.duration_h:null,source:routeData?.routing_engine==='TomTom'?'TomTom':'manual'},
  vehicle:collectFields('[data-v]','data-v'),assumptions:collectFields('[data-a]','data-a'),
  cargo:[...document.querySelectorAll('.cargo-row')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-cargo]')].map(e=>[e.dataset.cargo,e.type==='checkbox'?e.checked:e.value]))),
  offers:[...document.querySelectorAll('.offer-row')].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-offer]')].map(e=>[e.dataset.offer,e.value])),needsConfirmation:row.dataset.needsConfirmation==='true',importSource:row.dataset.importSource||''})),
  ...Object.fromEntries(['client','reference','pickup','delivery','notes','sellPrice'].map(id=>[id,$(id).value])),
  ...Object.fromEntries(['tailLift','palletJack','reviewed'].map(id=>[id,$(id).checked])),
};}
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;}
function invalidate(){
  result=null;dirty=true;revision++;$('result').hidden=true;$('emptyResult').hidden=false;$('resultTag').textContent='Przelicz';
  $('saveQuote').disabled=true;$('offerOpen').disabled=true;$('saveState').textContent='Zmiany nie są zapisane. Przelicz i zapisz nową wersję.';
  $('fitTag').textContent='Przelicz';$('loadMetrics').textContent='Dane zmienione — przelicz kontrolę ładunku.';
  $('calculationDetails').hidden=true;
  $('warnings').replaceChildren();$('warningsCount').textContent='—';
  document.querySelectorAll('.offer-compare').forEach(e=>{e.textContent='Przelicz, aby porównać ofertę z limitem zakupu.';e.classList.remove('bad');});
  renderSelectedOfferPicker();
}
function clearMap(){if(mapLine){map.removeLayer(mapLine);mapLine=null;}mapMarkers.forEach(m=>map.removeLayer(m));mapMarkers=[];}
function resetOfferScope(){document.querySelectorAll('.offer-row').forEach(row=>{row.dataset.needsConfirmation='true';const status=row.querySelector('[data-offer=status]');if(status.value==='accepted')status.value='received';});}
function invalidateRoute(clearDistance=true){
  routeKey='';routeSequence++;routeRequest?.abort();routeRequest=null;routeData=null;clearMap();$('fetchRoute').disabled=false;$('fetchRoute').textContent='Pobierz trasę';
  if(clearDistance)$('distanceKm').value='';
  $('routeStatus').textContent=clearDistance?'Trasa zmieniona. Pobierz nowy przebieg albo podaj sprawdzony dystans.':'Dystans ręczny — potwierdź przebieg oraz czas przejazdu.';
  $('mapCaption').textContent='Brak aktualnej trasy na mapie.';
}
function runCalculation(scroll=false){
  try{result=calculate(collect());render();$('message').hidden=true;if(scroll&&matchMedia('(max-width:700px)').matches)$('decisionTitle').scrollIntoView({behavior:'smooth',block:'start'});return true;}
  catch(e){result=null;$('saveQuote').disabled=true;$('offerOpen').disabled=true;message(e.message,true);$('message').scrollIntoView({behavior:'smooth',block:'center'});return false;}
}
function render(){
  const r=result,symbol=currencySymbol(r.currency),otherCurrency=r.currency==='PLN'?'EUR':'PLN';
  const fxLabel=r.input.fxSource==='NBP'?`NBP · ${r.input.fxDate||''} · ${r.input.fxTable||''}`:'kurs ręczny';
  const equivalent=r.eurPln?`<div class="currency-equivalent ${otherCurrency==='PLN'?'pln':''}"><strong>≈ ${money(convertMoney(r.sell,r.currency,otherCurrency,r.eurPln),otherCurrency)}</strong><span>1 EUR = ${fmt(r.eurPln,4)} PLN · ${esc(fxLabel)}</span></div>`:'';
  $('result').hidden=false;$('emptyResult').hidden=true;$('resultTag').textContent=r.blockers.length?'Sprawdź auto':r.input.reviewed?(r.buySource==='accepted'?'Oferta przewoźnika':'Szacunek'):'Potwierdź warunki';
  $('result').innerHTML=`${r.blockers.length?`<div class="blocker"><strong>Ładunek wymaga zmiany pojazdu lub danych.</strong><br>${r.blockers.map(esc).join('<br>')}</div>`:''}<div class="price-label">Cena dla klienta${r.input.sellPrice===null?' · sugerowana':''}</div><div class="price-value ${r.currency==='PLN'?'pln':''}">${fmt(r.sell)} <small>${symbol}</small></div>${equivalent}<p class="price-range">Zakup: ${money(r.buy)} · ${r.buySource==='accepted'?'przyjęta oferta · '+esc(r.input.offers.find(o=>o.status==='accepted').carrier):'model'}</p><div class="decision-stats"><div class="price-label">Zysk na zleceniu<strong>${money(r.profit)}</strong></div><div class="price-label">Marża od sprzedaży<strong>${fmt(r.margin,1)}%</strong></div></div>${r.overBudget?'<div class="status-note bad">Zakup przekracza limit. Podnieś cenę klienta lub negocjuj zakup.</div>':''}`;
  $('calculationDetails').hidden=false;
  $('calculationBreakdown').innerHTML=`<div class="decision-line"><span>Zakres zakupu z modelu</span><strong>${fmt(r.low,0)}–${fmt(r.high,0)} ${symbol}</strong></div><div class="decision-line"><span>Propozycja na start</span><strong>${money(r.opening)}</strong></div><div class="decision-line"><span>Limit zakupu (${fmt(r.input.assumptions.minimumMargin,0)}% marży)</span><strong>${money(r.maxBuy)}</strong></div><div class="status-note ${r.overBudget?'bad':''}">${r.overBudget?'Zakup przekracza limit. Podnieś cenę klienta lub negocjuj zakup.':'Zakup mieści się w limicie przy aktualnej cenie sprzedaży.'}</div><details><summary>Skąd ta cena?</summary><div class="decision-line"><span>Koszt całej relacji</span><strong>${money(r.costs.linehaul)}</strong></div><div class="decision-line"><span>Udział przesyłki</span><strong>${fmt(r.share*100,1)}%</strong></div><div class="decision-line"><span>Dojazd + obsługa + dopłaty</span><strong>${money(r.costs.shipment)}</strong></div><div class="decision-line"><span>Koszt modelowy</span><strong>${money(r.costs.operating)}</strong></div><p class="hint">Koszt modelowy × (1 + narzut przewoźnika), z minimum zakupu. Cena sprzedaży = zakup ÷ (1 − marża docelowa). Doładunek: największy udział wagi, objętości lub podłogi, nie mniej niż ustawione minimum. Koszty dojazdu i obsługi przypisane w całości.</p></details>`;
  if(!r.input.useCostModel)$('calculationBreakdown').innerHTML=`<p class="hint">Zakup pochodzi wyłącznie z wybranej oferty przewoźnika. Koszty modelowe są wyłączone.</p><div class="decision-line"><span>Limit zakupu (${fmt(r.input.assumptions.minimumMargin,0)}% marży)</span><strong>${money(r.maxBuy)}</strong></div>`;
  renderSelectedOfferPicker();
  $('loadMetrics').innerHTML=`<div class="load-total"><div><strong>${r.summary.pieces}</strong><small>sztuk</small></div><div><strong>${fmt(r.summary.volume,2)}</strong><small>m³</small></div><div><strong>${fmt(r.summary.ldm,2)}</strong><small>LDM / szer. 2,4 m</small></div></div>${[['weight','Ładowność',`${fmt(r.summary.weight,0)} / ${fmt(r.input.vehicle.payload,0)} kg`],['floor','Podłoga',`${fmt(r.summary.area,2)} m²`],['volume','Objętość',`${fmt(r.summary.volume,2)} m³`]].map(([key,label,detail])=>`<div class="capacity ${r.shares[key]>1?'over':''}"><div><span>${label} · ${esc(detail)}</span><strong>${fmt(r.shares[key]*100,0)}%</strong></div><progress max="1" value="${Math.min(1,r.shares[key])}" aria-label="${label}"></progress></div>`).join('')}`;
  $('fitTag').textContent=r.blockers.length?'Przekroczone limity':'Wstępna kontrola';
  $('warnings').innerHTML=[...r.blockers,...r.warnings,...(!r.input.pickup||!r.input.delivery?['Uzupełnij daty przed przygotowaniem oferty dla klienta.']:[])].map(w=>`<li>${esc(w)}</li>`).join('');$('warningsCount').textContent=$('warnings').children.length;
  $('saveQuote').disabled=saving;$('offerOpen').disabled=!r.ready;
  $('saveState').textContent=r.ready?'Możesz zapisać wersję i przygotować wstępną ofertę.':'Zapis szkicu jest dostępny. Oferta klienta wymaga dat, sprawdzonych założeń i zgodności ładunku.';
  document.querySelectorAll('.offer-row').forEach((row,index)=>{const o=r.input.offers[index],p=row.querySelector('.offer-compare'),delta=r.maxBuy-o.price;p.classList.toggle('bad',delta<0||o.needsConfirmation);p.textContent=`${o.needsConfirmation?'Warunki przesyłki zmienione — potwierdź ponownie z przewoźnikiem przed przyjęciem. ':''}${o.status==='rejected'?'Odrzucona · ':''}${delta<0?'Ponad limit o':'Zapas do limitu:'} ${money(Math.abs(delta))}. Marża przy tej ofercie: ${fmt((r.sell-o.price)/r.sell*100,1)}%.`;});
}
async function api(url,options={}){const response=await fetch(url,options);let data;try{data=await response.json();}catch{throw Error('Nieprawidłowa odpowiedź serwera. Odśwież aplikację i spróbuj ponownie.');}if(!response.ok)throw Error(data.error||'Nie udało się wykonać operacji.');return data;}
const routingFields=['grossWeightKg','axleWeightKg','lengthCm','widthCm','heightCm','axleCount'];
function routeFingerprint(){return JSON.stringify([$('origin').value.trim(),routeInputs.getStops(),$('destination').value.trim(),...routingFields.map(k=>Number($(`v-${k}`).value))]);}
function routeChanged(){invalidateRoute();resetOfferScope();$('reviewed').checked=false;invalidate();}
function routeSnapshot(data){
  const coords=data.geometry?.coordinates;if(!Array.isArray(coords)||coords.length<2)return null;
  const count=Math.min(coords.length,12000);
  return {coordinates:Array.from({length:count},(_,i)=>coords[Math.round(i*(coords.length-1)/(count-1))].slice(0,2).map(n=>Number(Number(n).toFixed(5)))),points:(data.points||[]).slice(0,20).map(p=>({lat:p.lat,lng:p.lng,label:String(p.label||'').slice(0,300)}))};
}
function showRoute(data){
  $('routeStatus').textContent=`${fmt(data.distance_km,1)} km · czas jazdy ${fmt(data.duration_h,1)} h (bez planowania odpoczynków).${data.archived?' Trasa z zapisanej wersji.':''}`;
  $('mapCaption').textContent=(data.points?.length?data.points.map(p=>p.label):[$('origin').value,...routeInputs.getStops(),$('destination').value]).join(' → ')+'. Sprawdź punkty i przebieg. Myto uzupełnij dla tego auta.';
  drawMap(data);
}
async function fetchRoute(){
  const origin=$('origin').value.trim(),destination=$('destination').value.trim();
  if(!origin||!destination){message('Podaj oba adresy.',true);return;}
  invalidateRoute(false);$('reviewed').checked=false;invalidate();routeKey=routeFingerprint();const seq=routeSequence;const controller=new AbortController();routeRequest=controller;
  $('fetchRoute').disabled=true;$('fetchRoute').textContent='Wyznaczanie…';$('routeStatus').textContent='Pobieranie trasy z profilem wybranego auta…';
  try{
    const vehicle=collectFields('[data-v]','data-v');const truckParams=Object.fromEntries(['grossWeightKg','axleWeightKg','lengthCm','widthCm','heightCm','axleCount'].map(k=>[k,vehicle[k]]));
    const data=await api(routeInputs.getStops().length?'/api/route/multi':'/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,destination,stops:routeInputs.getStops(),truckParams}),signal:controller.signal});
    if(seq!==routeSequence)return;
    if(data.routing_engine!=='TomTom'||!Number.isFinite(data.distance_km)||!Number.isFinite(data.duration_h))throw Error('Brak potwierdzonej trasy TomTom. Możesz wpisać zweryfikowany dystans ręcznie.');
    routeData={...data,snapshot:routeSnapshot(data)};$('distanceKm').value=data.distance_km;
    showRoute(routeData);dirty=true;
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
  (data.points?.length?data.points.map(p=>[p.lat,p.lng]):[coords[0],coords.at(-1)]).forEach((point,index,points)=>{const m=L.circleMarker(point,{radius:7,color:'#fff',weight:3,fillColor:index?'#d39157':'#157258',fillOpacity:1}).addTo(map);const label=document.createElement('span');label.textContent=data.points?.[index]?.label||(index===0?'A · Załadunek':index===points.length-1?'B · Rozładunek':`Przez · ${index}`);m.bindTooltip(label);mapMarkers.push(m);});
  if($('mapDetails').open){map.invalidateSize({pan:false,animate:false});map.fitBounds(mapLine.getBounds(),{padding:[22,22],animate:false});}
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
  $('history').innerHTML=`<div class="history-table"><table><thead><tr><th>ZAPIS / KLIENT</th><th>RELACJA</th><th>ZAKUP</th><th>SPRZEDAŻ</th><th>MARŻA</th><th><span class="muted">WERSJA</span></th></tr></thead><tbody>${historyRows.map((row,index)=>{const s=row.calc?.forwarding,currency=row.input?.currency||'EUR',rate=row.input?.eurPln,fx=row.input?.fxSource==='NBP'?`NBP ${row.input.fxDate||''}`:'';const rowMoney=n=>money(n,currency);return `<tr><td>${esc(new Date(Number(row.ts)).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}<small>${esc(row.client||row.name||'Bez nazwy')}</small></td><td class="history-route">${esc(row.origin)} → ${esc(row.destination)}<small>${esc(PROFILES[row.input?.profile]?.name||'')} · ${row.input?.mode==='partload'?'Doładunek':'Dedykowany'}</small></td><td class="numeric">${rowMoney(s?.buy??convertMoney(row.total_cost??0,'EUR',currency,rate))}<small>${s?.buySource==='accepted'?'Przyjęta oferta':'Model'}</small></td><td class="numeric">${rowMoney(s?.sell??convertMoney(row.price_eur??0,'EUR',currency,rate))}${rate?`<small>1 EUR = ${fmt(rate,4)} PLN${fx?` · ${esc(fx)}`:''}</small>`:''}</td><td class="numeric">${fmt(row.margin_pct??0,1)}%</td><td><button type="button" class="secondary" data-load="${index}">Wczytaj</button></td></tr>`;}).join('')}</tbody></table></div>`;
}
function loadInput(input){
  $('useCostModel').checked=input.useCostModel!==false;syncModelMode();
  currentCurrency=normalizeCurrency(input.currency||'EUR');fxMeta=input.fxSource==='NBP'?{fxSource:'NBP',fxDate:input.fxDate,fxTable:input.fxTable}:null;$('quoteCurrency').value=currentCurrency;$('eurPln').value=input.eurPln??'';renderFxStatus();
  document.querySelectorAll('[data-money]').forEach(clearMoneyAnchor);
  invalidateRoute();$('profile').value=input.profile;setProfile();
  for(const key of Object.keys(V))$(`v-${key}`).value=input.vehicle[key];
  for(const key of Object.keys(A)){const fallback=PROFILES[input.profile][key]??DEFAULT_ASSUMPTIONS[key];$(`a-${key}`).value=input.assumptions[key]??(MONEY_ASSUMPTIONS.includes(key)?convertMoney(fallback,'EUR',currentCurrency,input.eurPln):fallback);}
  for(const id of ['client','reference','pickup','delivery','notes','sellPrice','reeferTemperature'])$(id).value=input[id]??'';
  for(const id of ['tailLift','palletJack'])$(id).checked=input[id]===true;
  $('reeferTemperatureField').hidden=input.profile!=='reefer136';
  $('reviewed').checked=false;
  document.querySelector(`[name=mode][value="${input.mode==='partload'?'partload':'dedicated'}"]`).checked=true;
  $('origin').value=input.route.origin;$('destination').value=input.route.destination;routeInputs.setStops(input.route.stops||[]);$('distanceKm').value=input.route.distanceKm;
  $('cargoRows').replaceChildren();input.cargo.forEach(cargoRow);$('offerRows').replaceChildren();(input.offers||[]).forEach(offerRow);syncCurrencyLabels();
  // Restore the saved route without another routing request; legacy records may lack geometry.
  routeData={duration_h:input.route.durationHours,distance_km:input.route.distanceKm,routing_engine:input.route.source,snapshot:input.route.snapshot,geometry:input.route.snapshot?{coordinates:input.route.snapshot.coordinates}:null,points:input.route.snapshot?.points,archived:true};routeKey=routeFingerprint();
  invalidate();runCalculation();dirty=false;
  if(routeData.snapshot)showRoute(routeData);else $('routeStatus').textContent='Dystans i czas z zapisanej wersji. Ten zapis nie zawiera mapy — pobierz trasę, aby ją wyświetlić.';
  $('saveState').textContent='Wczytano dane. Ponownie potwierdź założenia przed ofertą. Zapis utworzy nową wersję.';
  $('workspace').scrollIntoView({behavior:'smooth'});
}

function renderFxStatus(){
  $('fxSummary').textContent=$('eurPln').value?`${fmt($('eurPln').value,4)}${fxMeta?' · NBP':''}`:'Ustaw';
  $('fxStatus').textContent=fxMeta?`Kurs NBP: ${fmt($('eurPln').value,4)} PLN za 1 EUR · tabela ${fxMeta.fxTable} · data publikacji ${fxMeta.fxDate}`:$('eurPln').value?'Kurs ręczny — zapisze się z tą wersją wyceny.':'Pobierz kurs NBP lub wpisz własny kurs EUR/PLN.';
}
async function fetchFx(){
  const button=$('fetchFx'),status=$('fxStatus'),requestRevision=revision,hadResult=!!result;
  button.disabled=true;button.textContent='Pobieranie…';status.textContent='Pobieram średni kurs EUR/PLN z NBP…';
  try{
    const data=await api('/api/forwarding/exchange-rate');
    if(revision!==requestRevision){renderFxStatus();message('Dane wyceny zmieniły się podczas pobierania. Kurs nie został nadpisany. Kliknij ponownie, aby go zaktualizować.');return;}
    normalizeExchangeRate(data.eurPln,true);
    $('eurPln').value=data.eurPln;fxMeta={fxSource:'NBP',fxDate:data.fxDate,fxTable:data.fxTable};
    document.querySelectorAll('[data-money]').forEach(clearMoneyAnchor);
    syncCurrencyLabels();$('reviewed').checked=false;invalidate();if(hadResult)runCalculation();
    renderFxStatus();
  }catch(e){renderFxStatus();message(e.message,true);}
  finally{button.disabled=false;button.textContent='Pobierz kurs NBP';}
}

const routeInputs=setupRouteInputs({api,onChange:routeChanged,message});
initFields();cargoRow();syncCurrencyLabels();renderFxStatus();syncModelMode();renderSelectedOfferPicker();
if(matchMedia('(max-width:700px)').matches)$('mapDetails').open=false;
$('workspace').addEventListener('submit',e=>{e.preventDefault();runCalculation(true);});
$('workspace').addEventListener('input',e=>{
  if(['profile','quoteCurrency','useCostModel'].includes(e.target.id))return;
  if(e.target.matches('[data-money]'))clearMoneyAnchor(e.target);
  if(e.target.id==='eurPln'){fxMeta=null;renderFxStatus();document.querySelectorAll('[data-money]').forEach(clearMoneyAnchor);syncCurrencyLabels();}
  if(e.target.matches('[data-stop]')||['origin','destination','pickup','delivery','notes','tailLift','palletJack'].includes(e.target.id)||e.target.dataset.cargo||e.target.dataset.v||e.target.name==='mode')resetOfferScope();
  if((e.target.matches('[data-route-address]')||routingFields.includes(e.target.dataset.v))&&routeKey!==routeFingerprint())invalidateRoute();
  if(e.target.id==='distanceKm'&&Number(e.target.value)!==routeData?.distance_km)invalidateRoute(false);
  if(e.target.id!=='reviewed')$('reviewed').checked=false;
  invalidate();
});
$('workspace').addEventListener('change',e=>{
  if(e.target.id==='useCostModel'){const hadResult=!!result;syncModelMode();$('reviewed').checked=false;invalidate();if(hadResult)runCalculation();return;}
  if(e.target.id==='quoteCurrency'){switchCurrency();return;}
  if(e.target.id==='profile'){try{setProfile();invalidateRoute();resetOfferScope();$('reviewed').checked=false;invalidate();}catch(err){$('profile').value=currentProfile;message(err.message,true);}}
  if(e.target.dataset.offer==='status'&&e.target.value==='accepted'){e.target.closest('.offer-row').dataset.needsConfirmation='false';document.querySelectorAll('[data-offer=status]').forEach(el=>{if(el!==e.target&&el.value==='accepted')el.value='received';});invalidate();runCalculation();}
});
$('workspace').addEventListener('click',e=>{
  const cargo=e.target.closest('.remove-cargo'),offer=e.target.closest('.remove-offer');
  if(cargo&&$('cargoRows').children.length>1){cargo.closest('.cargo-row').remove();numberCargo();resetOfferScope();$('reviewed').checked=false;invalidate();}
  if(offer){offer.closest('.offer-row').remove();invalidate();}
});
$('addCargo').onclick=()=>{cargoRow();resetOfferScope();$('reviewed').checked=false;invalidate();};
$('addOffer').onclick=()=>{offerRow();invalidate();$('offerRows').lastElementChild?.querySelector('input')?.focus();};
$('workspace').addEventListener('click',e=>{const button=e.target.closest('[data-use-offer]');if(button)useSelectedOffer(button.dataset.useOffer);});
$('fetchRoute').onclick=fetchRoute;$('saveQuote').onclick=saveQuote;$('refreshHistory').onclick=loadHistory;
$('fetchFx').onclick=fetchFx;
$('mapDetails').addEventListener('toggle',()=>{if(map&&$('mapDetails').open){map.invalidateSize({pan:false,animate:false});if(mapLine)map.fitBounds(mapLine.getBounds(),{padding:[22,22],animate:false});}});
$('newQuote').onclick=()=>{if(!dirty||confirm('Odrzucić niezapisane zmiany i rozpocząć nową wycenę?')){dirty=false;location.reload();}};
$('logout').onclick=()=>{if(dirty&&!confirm('Wylogować i odrzucić niezapisane zmiany?'))return;dirty=false;for(const k of ['optirax_token','optirax_refresh','optirax_profile','optirax_user'])localStorage.removeItem(k);location.href='/login';};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
setupEnquiryImport({api,parseLocal:parseEnquiry,offerContext:()=>{
  const input=collect();return {origin:input.route.origin,destination:input.route.destination,pickup:input.pickup,delivery:input.delivery,reference:input.reference,tailLift:input.tailLift,currency:currentCurrency,eurPln:input.eurPln,existingCount:input.offers.length,scope:JSON.stringify([input.route.origin,input.route.stops,input.route.destination,input.cargo,input.pickup,input.delivery,input.reference,input.tailLift,input.palletJack,input.notes,input.profile,input.mode])};
},applyOffers:offers=>{
  if(saving){message('Poczekaj na zakończenie zapisu wyceny.',true);return false;}
  offers.forEach(offerRow);invalidate();message(`Dodano ${offers.length} ofert do bieżącego zlecenia. Przelicz porównanie i potwierdź warunki przed przyjęciem oferty.`);return true;
},apply:(data,autoRoute)=>{
  if(saving){message('Poczekaj na zakończenie zapisu wyceny.',true);return false;}
  if(dirty&&!confirm('Rozpocząć nowe zapytanie z odczytanych danych? Niezapisana wycena, ceny i oferty przewoźników zostaną zastąpione.'))return false;
  invalidateRoute();routeInputs.setStops([]);
  for(const id of ['origin','destination','client','reference','pickup','delivery','notes'])$(id).value=data[id]||'';
  $('sellPrice').value='';clearMoneyAnchor($('sellPrice'));$('offerRows').replaceChildren();
  $('cargoRows').replaceChildren();(data.cargo.length?data.cargo:[{}]).forEach(cargoRow);
  for(const id of ['tailLift','palletJack'])$(id).checked=data[id]===true;
  // Preserve selected vehicle, currency and base rates, but not previous job's charges.
  for(const key of ['tolls','crossing','extra','waitingHours','deadheadKm']){const el=$(`a-${key}`);el.value=DEFAULT_ASSUMPTIONS[key];clearMoneyAnchor(el);}
  $('reviewed').checked=false;invalidate();
  const warnings=data.warnings||[data.warning];
  message(['Wczytano nowe zapytanie. Sprawdź auto, sposób przewozu i koszty dla tej relacji.',...warnings.filter(Boolean)].join(' '));
  if(autoRoute&&data.origin&&data.destination)fetchRoute();
  else $('origin').focus();
  return true;
}});
$('offerOpen').onclick=()=>{try{$('customerText').value=customerOffer(result);$('copyStatus').textContent='';$('offerDialog').showModal();}catch(e){message(e.message,true);}};
$('copyOffer').onclick=async()=>{try{await navigator.clipboard.writeText($('customerText').value);$('copyStatus').textContent='Skopiowano treść oferty.';}catch{$('customerText').focus();$('customerText').select();$('copyStatus').textContent='Zaznaczono treść. Skopiuj ją ręcznie (Ctrl/Cmd+C).';}};
$('printOffer').onclick=()=>{$('printArea').textContent=$('customerText').value;$('offerDialog').close();window.print();};
$('history').onclick=e=>{const button=e.target.closest('[data-load]');if(!button)return;if(dirty&&!confirm('Wczytać zapis i odrzucić niezapisane zmiany?'))return;const row=historyRows[Number(button.dataset.load)];try{calculate(row.input);loadInput(row.input);}catch(err){message('Nie można wczytać tej wersji: '+err.message,true);}};
if(localStorage.getItem('optirax_token')){
  loadHistory();
  api('/api/auth/profile').then(p=>{$('accountLabel').textContent=`${String(p.plan||'konto').toUpperCase()} · ${p.email||'Optirax'}`;}).catch(()=>{$('accountLabel').textContent='Optirax';});
  api('/api/config').then(c=>{tilesKey=c.tomtomTilesKey||'';}).catch(()=>{});
}


// Fit the three independent desktop scroll areas below the page controls.
function sizeWorkspace(){
  if(!matchMedia('(min-width:760px)').matches){$('workspace').style.removeProperty('--workspace-height');return;}
  const top=$('workspace').getBoundingClientRect().top+window.scrollY;
  $('workspace').style.setProperty('--workspace-height',`${Math.max(160,window.innerHeight-top-12)}px`);
}
window.addEventListener('resize',sizeWorkspace);
const workspaceSizer=new ResizeObserver(sizeWorkspace);
for(const el of document.querySelectorAll('.app-header,.page-heading,.notice,#message'))workspaceSizer.observe(el);
sizeWorkspace();

// Keep the map canvas in sync when columns resize or browser zoom changes.
new ResizeObserver(()=>{if(map&&$('mapDetails').open){map.invalidateSize({pan:false,animate:false});if(mapLine)map.fitBounds(mapLine.getBounds(),{padding:[22,22],animate:false});}}).observe($('routeMap'));
// Scrolling a pane must not change a focused numeric routing field.
$('workspace').addEventListener('wheel',()=>{const el=document.activeElement;if(el?.matches('input[type=number]'))el.blur();},{passive:true});
