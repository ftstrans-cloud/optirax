import {convertMoney,normalizeExchangeRate} from './forwarding-engine.js?v=1.6.0';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function offerSource(o){return [`Kwota w źródle: ${o.amount??'?'} ${o.currency||'?'} (${o.taxBasis==='net'?'netto':o.taxBasis==='gross'?'brutto':'nie podano netto/brutto'}).`,o.origin?`Załadunek: ${o.origin}`:'',o.destination?`Rozładunek: ${o.destination}`:'',o.pickup?`Termin odbioru: ${o.pickup}`:'',o.delivery?`Termin dostawy: ${o.delivery}`:'',o.tailLift===true?'Winda potwierdzona.':o.tailLift===false?'Bez windy.':'Winda niepotwierdzona.',o.terms||''].filter(Boolean).join('\n');}
export function renderOfferPreview(data,context){
  const same=(a,b)=>String(a||'').trim().toLocaleLowerCase('pl')===String(b||'').trim().toLocaleLowerCase('pl');
  return `<h3>Oferty do bieżącego zlecenia</h3><p class="import-notes"><b>${esc(context.reference||'Bez referencji')}</b><br>${esc(context.origin)} → ${esc(context.destination)}<br>Odbiór: ${esc(context.pickup||'?')} · Dostawa: ${esc(context.delivery||'?')}</p><p class="hint">Zaznacz oferty do dodania. Kwoty muszą oznaczać cały przewóz netto. EUR/PLN przeliczymy według kursu w wycenie. Inne waluty przelicz ręcznie, wpisując wynik i wybierając EUR lub PLN. Oryginalny odczyt zostanie zachowany.</p>${data.offers.map((o,i)=>{
    const warnings=['Potwierdź, że oferta dotyczy tej przesyłki i obejmuje wszystkie wymagane usługi.'];
    if(!o.origin||!o.destination)warnings.push('Brak pełnej trasy w odpowiedzi — przypisanie wymaga sprawdzenia.');
    if(o.origin&&!same(o.origin,context.origin)||o.destination&&!same(o.destination,context.destination))warnings.push('Zapis adresów różni się od zlecenia — sprawdź zgodność miejsc.');
    if(o.pickup&&context.pickup&&!same(o.pickup,context.pickup)||o.delivery&&context.delivery&&!same(o.delivery,context.delivery))warnings.push('Zapis terminów różni się od zlecenia — sprawdź daty i godziny.');
    if(context.tailLift&&o.tailLift!==true)warnings.push(o.tailLift===false?'NIEZGODNOŚĆ: zlecenie wymaga windy, oferta jest bez windy.':'Zlecenie wymaga windy — oferta jej nie potwierdza.');
    return `<section class="import-offer" data-import-offer="${i}"><label class="inline-check"><input type="checkbox" data-import="selected" checked> Dodaj ofertę ${i+1}</label><div class="fields two"><label>Przewoźnik<input data-import="carrier" maxlength="120" value="${esc(o.carrier)}" placeholder="Uzupełnij nazwę"></label><label>Cena całego przewozu<input data-import="amount" type="number" min="0.01" max="1000000" step="0.01" value="${esc(o.amount)}"></label><label>Waluta<select data-import="currency">${[['','Nie podano'],['EUR','EUR'],['PLN','PLN'],['GBP','GBP — przelicz ręcznie'],['CHF','CHF — przelicz ręcznie'],['OTHER','Inna — przelicz ręcznie']].map(([v,l])=>`<option value="${v}" ${v===(o.currency||'')?'selected':''}>${l}</option>`).join('')}</select></label><label>Rodzaj kwoty<select data-import="taxBasis">${[['unknown','Nie podano'],['net','Netto'],['gross','Brutto — wpisz netto']].map(([v,l])=>`<option value="${v}" ${o.taxBasis===v?'selected':''}>${l}</option>`).join('')}</select></label></div><label>Warunki / ustalenia<textarea data-import="terms" maxlength="1500" rows="2">${esc(o.terms)}</textarea></label><details><summary>Odczyt ze źródła</summary><pre>${esc(offerSource(o))}</pre></details><ul class="import-warnings">${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></section>`;
  }).join('')}${!data.offers.length?'<p class="import-error">Nie znaleziono ofert przewoźników. Wklej ich odpowiedzi z cenami, a nie samo zapytanie klienta.</p>':''}${data.warnings?.length?`<ul class="import-warnings">${data.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}<p class="hint">Oferty zostaną dodane jako „Otrzymane”. Sam wybierasz ofertę przyjętą po potwierdzeniu warunków.</p>`;
}
export function prepareOffers(edits,originals,{currency,eurPln,existingCount=0}){
  if(!edits.length)throw Error('Zaznacz przynajmniej jedną ofertę.');
  if(existingCount+edits.length>50)throw Error('Łącznie można zapisać maksymalnie 50 ofert.');
  return edits.map(e=>{
    const carrier=e.carrier.trim(),amount=Number(e.amount);
    if(!carrier||carrier.length>120)throw Error('Uzupełnij nazwę każdego zaznaczonego przewoźnika.');
    if(!Number.isFinite(amount)||amount<=0||amount>1000000)throw Error('Podaj poprawną cenę całego przewozu.');
    if(e.taxBasis!=='net')throw Error('Potwierdź kwotę netto. Kwoty brutto lub o nieznanej podstawie nie są porównywalne.');
    if(!['EUR','PLN'].includes(e.currency))throw Error('Wybierz EUR lub PLN. Inne waluty najpierw przelicz ręcznie.');
    const rate=normalizeExchangeRate(eurPln,e.currency!==currency);
    const price=Math.round(convertMoney(amount,e.currency,currency,rate)*100)/100;
    const original=originals[e.index];if(!original)throw Error('Odczyt oferty wygasł. Uruchom import ponownie.');
    return {carrier,price,status:'received',needsConfirmation:true,terms:e.terms.trim(),importSource:offerSource(original)+`\nPrzy imporcie: ${amount} ${e.currency} netto → ${price} ${currency}.`+(e.currency!==currency?` Kurs: 1 EUR = ${rate} PLN.`:'')};
  });
}
