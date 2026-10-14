const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel={ok:'Zgodne w sprawdzonym zakresie',warning:'Zastrzeżenia',red:'Red flag — wykryta niezgodność',unknown:'Ocena niepełna — wymaga sprawdzenia',info:'Informacja'};
const kindLabel={policy:'Polisa OCP',annex:'Aneks',license:'Licencja / wypis',owu:'OWU',payment:'Potwierdzenie płatności',other:'Inny dokument'};
const amount=(value,currency)=>value==null?'Nie odczytano':`${Number(value).toLocaleString('pl-PL')} ${currency||'waluta nieznana'}`;

export function setupCarrierVerification({getQuote}){
  const $=id=>document.getElementById(id);
  const dialog=document.createElement('dialog');dialog.id='carrierVerificationDialog';dialog.setAttribute('aria-labelledby','carrierVerificationTitle');
  dialog.innerHTML=`<div class="section-top"><div><p class="eyebrow">OPTIRAX / DOKUMENTY PRZEWOŹNIKA</p><h2 id="carrierVerificationTitle">Sprawdź przewoźnika</h2></div><button type="button" id="cvClose" class="quiet" aria-label="Zamknij weryfikację">✕</button></div>
  <p class="hint">OCP + aneksy + licencja + właściwe OWU. Jeden przewoźnik i jedna polisa z aneksami na analizę. Ocena dotyczy dokumentów i wskazanego przewozu.</p>
  <div class="cv-layout"><section class="cv-input"><h3>Dane do porównania</h3>
  <div class="fields two"><label>Przewoźnik<input id="cvCarrier" maxlength="200" required></label><label>NIP / VAT (opcjonalnie)<input id="cvTaxId" maxlength="40" placeholder="PL…"></label><label>Załadunek<input id="cvPickup" type="date"></label><label>Rozładunek<input id="cvDelivery" type="date"></label></div>
  <p id="cvRoute" class="hint"></p>
  <div class="fields two"><label>Kraje, także tranzyt<input id="cvCountries" maxlength="300" placeholder="Np. Polska, Niemcy, Francja, Wielka Brytania"></label><label>Rodzaj przewozu<select id="cvOperation"><option value="unknown">Wybierz</option><option value="domestic">Krajowy</option><option value="international">Międzynarodowy</option><option value="cabotage">Kabotaż</option></select></label></div>
  <label>Co jest w ładunku?<textarea id="cvCargo" maxlength="1500" rows="2" placeholder="Np. meble drewniane. Sama informacja „paleta” nie wystarczy."></textarea></label>
  <div class="fields two"><label>Wartość towaru<input id="cvValue" type="number" min="0.01" max="1000000000" step="0.01" placeholder="Nieznana"></label><label>Waluta wartości<select id="cvCurrency"><option>PLN</option><option>EUR</option><option>GBP</option><option>USD</option><option>CHF</option></select></label><label>Rejestracja auta (jeśli znana)<input id="cvRegistration" maxlength="40"></label><label>Temperatura / warunki<input id="cvTemperature" maxlength="100" placeholder="Jeśli wymagane"></label></div>
  <label class="inline-check"><input id="cvAdr" type="checkbox"> Ładunek ADR — sprawdź ochronę ADR</label>
  <p class="hint">Franszyzy pokazujemy informacyjnie. Brak danych nie jest automatycznym potwierdzeniem ochrony.</p>
  <div class="cv-drop" id="cvDrop"><label>Dodaj dokumenty lub przeciągnij tutaj<input id="cvFiles" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple></label><p class="hint">Do 8 plików PDF / JPG / PNG / WEBP. Do 20 MB na plik, 32 MB razem. Możesz dodawać kolejne pliki i wkleić screen Ctrl+V.</p><div id="cvFileList"></div></div>
  <p class="hint import-disclosure">Dodanie plików uruchamia analizę AI. Dokumenty i powyższe dane zostaną przesłane do OpenAI. Nie zapisujemy załączników w historii wycen. Zamknięcie okna zachowuje je do odświeżenia strony; „Wyczyść dokumenty” je usuwa z tego okna.</p>
  <label class="inline-check"><input id="cvAuto" type="checkbox" checked> Analizuj automatycznie po dodaniu plików</label>
  <div class="cv-actions"><button type="button" id="cvRun" class="primary">Sprawdź dokumenty</button><button type="button" id="cvCancel" class="secondary" hidden>Przerwij</button><button type="button" id="cvClear" class="secondary">Wyczyść dokumenty</button></div>
  <p id="cvStatus" role="status" aria-live="polite" class="hint"></p></section>
  <section class="cv-output" aria-label="Raport weryfikacji"><div id="cvStale" class="cv-stale" hidden>Dane lub dokumenty zmieniły się. Poniższy raport jest nieaktualny — uruchom analizę ponownie.</div><div id="cvReport"><div class="cv-empty"><strong>Raport pojawi się tutaj</strong><p>Sprawdzimy firmę, terminy, zakres i sumy. Każdy wniosek otrzyma uzasadnienie oraz wskazanie źródła.</p></div></div><button type="button" id="cvDownload" class="secondary" hidden>Pobierz raport TXT</button></section></div>`;
  document.body.appendChild(dialog);
  let files=[],report=null,controller=null,sequence=0,timer=null,base=null,scope='',busy=false;
  const status=(text,error=false)=>{$('cvStatus').textContent=text;$('cvStatus').className=error?'error':'hint';};
  const stop=()=>{clearTimeout(timer);sequence++;controller?.abort();controller=null;busy=false;$('cvRun').disabled=false;$('cvCancel').hidden=true;dialog.removeAttribute('aria-busy');};
  const stale=()=>{stop();if(report){$('cvStale').hidden=false;$('cvDownload').hidden=true;}};
  function context(){return {carrier:$('cvCarrier').value,taxId:$('cvTaxId').value,pickup:$('cvPickup').value,delivery:$('cvDelivery').value,countries:$('cvCountries').value,operation:$('cvOperation').value,cargo:$('cvCargo').value,value:$('cvValue').value===''?null:Number($('cvValue').value),currency:$('cvCurrency').value,registration:$('cvRegistration').value,temperature:$('cvTemperature').value,adr:$('cvAdr').checked,reference:base?.reference||'',origin:base?.route?.origin||'',destination:base?.route?.destination||'',notes:String(base?.notes||'').slice(0,1500)};}
  function syncQuote(){
    const q=getQuote(),accepted=q.offers.find(o=>o.status==='accepted'),carrier=accepted?.carrier||'';
    const next=JSON.stringify([carrier,q.reference,q.route.origin,q.route.stops,q.route.destination,q.pickup,q.delivery,q.cargo,q.profile,q.reeferTemperature,q.notes]);
    if(next===scope)return;
    const changedCarrier=base&&base.offers.find(o=>o.status==='accepted')?.carrier!==carrier;
    const changedJob=base&&JSON.stringify([base.reference,base.route.origin,base.route.stops,base.route.destination,base.cargo])!==JSON.stringify([q.reference,q.route.origin,q.route.stops,q.route.destination,q.cargo]);
    stale();
    if(changedCarrier){files=[];report=null;$('cvReport').textContent='Wybrano innego przewoźnika. Dodaj jego dokumenty.';$('cvStale').hidden=true;$('cvTaxId').value='';$('cvRegistration').value='';renderFiles();}
    if(changedJob){for(const id of ['cvCargo','cvValue','cvCountries'])$(id).value='';$('cvOperation').value='unknown';$('cvAdr').checked=false;}
    base=q;scope=next;$('cvCarrier').value=carrier;$('cvPickup').value=q.pickup||'';$('cvDelivery').value=q.delivery||'';$('cvTemperature').value=q.reeferTemperature||'';
    $('cvRoute').textContent=[q.reference,[q.route.origin,...q.route.stops.map(s=>typeof s==='string'?s:s.address||''),q.route.destination].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')||'Uzupełnij dane przewozu.';
  }
  function renderFiles(){
    $('cvFileList').innerHTML=files.map((f,i)=>`<div class="cv-file"><span>${escape(f.name)} <small>${(f.size/1048576).toFixed(1)} MB</small></span><button type="button" class="quiet" data-cv-remove="${i}" aria-label="Usuń ${escape(f.name)}">×</button></div>`).join('');
  }
  function addFiles(incoming){
    const candidates=[...files];
    for(const f of incoming){if(candidates.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))continue;candidates.push(f);}
    if(candidates.length>8){status('Maksymalnie 8 plików jednego przewoźnika.',true);return;}
    if(candidates.some(f=>f.size>20*1048576)||candidates.reduce((s,f)=>s+f.size,0)>32*1048576){status('Limit: 20 MB na plik i 32 MB razem. Podziel materiał.',true);return;}
    if(candidates.some(f=>!['application/pdf','image/png','image/jpeg','image/webp'].includes(f.type))){status('Wybierz PDF, JPG, PNG lub WEBP.',true);return;}
    stale();files=candidates;renderFiles();status('Dokumenty gotowe.');
    if($('cvAuto').checked&&files.length)timer=setTimeout(run,2000);
  }
  function sourceMarkup(list){return list?.length?`<details class="cv-sources"><summary>Źródła (${list.length})</summary>${list.map(e=>`<p><strong>${escape(e.filename)} · str. ${e.page}</strong><br><q>${escape(e.quote)}</q></p>`).join('')}</details>`:'';}
  function renderReport(r){
    $('cvReport').innerHTML=`<div class="cv-verdict cv-${escape(r.status)}"><strong>${escape(statusLabel[r.status])}</strong><p>${escape(r.context.carrier)} · ${escape(r.context.pickup||'?')} – ${escape(r.context.delivery||'?')}</p><small>Analiza AI + kontrola dat i kwot · ${escape(new Date(r.checkedAt).toLocaleString('pl-PL'))}</small></div>
    <p class="cv-external"><strong>Potwierdzenie zewnętrzne: nie wykonano</strong><br>${escape(r.externalVerification.detail)}</p>
    <p class="hint">To ocena treści przedstawionych dokumentów. Sprawdź źródła przed decyzją. Zielony wynik nie oznacza potwierdzenia ochrony przez ubezpieczyciela.</p>
    ${r.checks.map(c=>`<article class="cv-check cv-${escape(c.status)}"><strong>${escape(c.label)} <span>${escape(statusLabel[c.status])}</span></strong><p>${escape(c.detail)}</p>${sourceMarkup(c.evidence)}</article>`).join('')}
    <h3>Sumy i podlimity ze źródeł</h3>${r.limits.length?r.limits.map(l=>`<article class="cv-check"><strong>${escape(l.label)}: ${escape(amount(l.amount,l.currency))}</strong><p>${escape({per_event:'Na zdarzenie',aggregate:'Łącznie na okres',both:'Na jedno i wszystkie zdarzenia',unknown:'Podstawa limitu nieustalona'}[l.basis])} · ${escape({yes:'Dotyczy wskazanego przewozu według odczytu',no:'Nie dotyczy wskazanego przewozu',unknown:'Zastosowanie wymaga ustalenia'}[l.applicable])}</p>${sourceMarkup(l.evidence)}</article>`).join(''):'<p>Nie odczytano sum.</p>'}
    <details><summary>Franszyzy — informacyjnie (${r.deductibles.length})</summary>${r.deductibles.length?r.deductibles.map(d=>`<p>${escape(d.description)}</p>${sourceMarkup(d.evidence)}`).join(''):'<p>Nie odczytano franszyz. Nie oznacza to ich braku.</p>'}</details>
    <details><summary>Rozpoznane dokumenty (${r.documents.length})</summary>${r.documents.map(d=>`<article class="cv-check"><strong>${escape(kindLabel[d.kind])} · ${escape(d.number||'bez numeru')}</strong><p>${escape(d.companyName||'Nie odczytano firmy')} · ${escape(d.filename)}<br>${escape(d.summary)}</p>${sourceMarkup(d.evidence)}</article>`).join('')}</details>`;
    $('cvDownload').hidden=false;$('cvStale').hidden=true;
  }
  async function run(){
    clearTimeout(timer);
    if(!files.length){status('Dodaj dokumenty przewoźnika.',true);return;}
    const c=context();if(!c.carrier.trim()){status('Wpisz nazwę przewoźnika lub wybierz jego ofertę w wycenie.',true);$('cvCarrier').focus();return;}
    if(c.value!==null&&(!Number.isFinite(c.value)||c.value<=0)){status('Podaj dodatnią wartość towaru albo pozostaw pole puste.',true);return;}
    if(c.pickup&&c.delivery&&c.delivery<c.pickup){status('Rozładunek nie może być przed załadunkiem.',true);return;}
    stale();const seq=sequence,quoteScope=scope,fileSnapshot=[...files];controller=new AbortController();const requestController=controller;busy=true;
    $('cvRun').disabled=true;$('cvCancel').hidden=false;dialog.setAttribute('aria-busy','true');status('Analizuję dokumenty… Duży komplet może wymagać do 2 minut.');
    try{
      const attachments=[];
      for(const f of fileSnapshot){
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Nie udało się odczytać pliku '+f.name));reader.readAsDataURL(f);});
        if(seq!==sequence)return;attachments.push({name:f.name.slice(0,200),data});
      }
      const token=localStorage.getItem('optirax_token');
      const response=await fetch('/api/forwarding/verify-carrier',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({context:c,files:attachments}),signal:requestController.signal});
      let data;try{data=await response.json();}catch{throw Error('Serwer nie zwrócił raportu. Spróbuj z mniejszym kompletem.');}
      if(!response.ok)throw Error(data.error||'Nie udało się przeprowadzić analizy.');
      if(seq!==sequence||scope!==quoteScope)return;
      if(!Array.isArray(data.checks)||!data.externalVerification)throw Error('Niekompletny raport. Spróbuj ponownie.');
      report=data;renderReport(report);status('Analiza zakończona. Raport dotyczy danych widocznych w tym oknie.');
    }catch(e){if(seq===sequence&&e.name!=='AbortError')status(e.message,true);}
    finally{if(seq===sequence){busy=false;controller=null;$('cvRun').disabled=false;$('cvCancel').hidden=true;dialog.removeAttribute('aria-busy');}}
  }
  $('verifyCarrierOpen').onclick=()=>{syncQuote();dialog.showModal();};
  $('cvClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(busy){stop();status('Przerwano oczekiwanie na raport. Analiza na serwerze może jeszcze trwać.');}else clearTimeout(timer);});
  $('cvFiles').onchange=e=>{addFiles([...e.target.files]);e.target.value='';};
  $('cvDrop').addEventListener('dragover',e=>{e.preventDefault();});$('cvDrop').addEventListener('drop',e=>{e.preventDefault();addFiles([...e.dataTransfer.files]);});
  dialog.addEventListener('paste',e=>{const images=[...e.clipboardData.items].filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);if(images.length){e.preventDefault();addFiles(images);}});
  $('cvFileList').onclick=e=>{const b=e.target.closest('[data-cv-remove]');if(b){stale();files.splice(Number(b.dataset.cvRemove),1);renderFiles();status('Zmieniono dokumenty. Kliknij „Sprawdź dokumenty”.');}};
  for(const id of ['cvCarrier','cvTaxId','cvPickup','cvDelivery','cvCountries','cvOperation','cvCargo','cvValue','cvCurrency','cvRegistration','cvTemperature','cvAdr'])$(id).addEventListener('input',()=>{stale();status('Zmieniono dane. Kliknij „Sprawdź dokumenty”, aby odświeżyć ocenę.');});
  $('cvRun').onclick=run;$('cvCancel').onclick=()=>{stop();status('Przerwano oczekiwanie. Serwer może jeszcze kończyć analizę; poczekaj przed ponowieniem.');};
  $('cvClear').onclick=()=>{stop();files=[];report=null;renderFiles();$('cvReport').textContent='Dodaj dokumenty, aby przygotować raport.';$('cvStale').hidden=true;$('cvDownload').hidden=true;status('Usunięto dokumenty i raport z tego okna.');};
  $('cvDownload').onclick=()=>{
    if(!report||!$('cvStale').hidden)return;
    const r=report,lines=['OPTIRAX — WERYFIKACJA DOKUMENTÓW',statusLabel[r.status],r.checkedAt,JSON.stringify(r.context,null,2),'',r.externalVerification.detail,''];
    for(const c of r.checks){lines.push(`${c.label}: ${statusLabel[c.status]}`,c.detail);for(const e of c.evidence)lines.push(`Źródło: ${e.filename}, str. ${e.page}: ${e.quote}`);lines.push('');}
    lines.push('SUMY I PODLIMITY');for(const l of r.limits)lines.push(`${l.label}: ${amount(l.amount,l.currency)} (${l.basis}; ${l.applicable})`);
    lines.push('FRANSZYZY — INFORMACYJNIE',...r.deductibles.map(d=>d.description),'Wersja: '+r.version);
    const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\n')],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='optirax-weryfikacja-'+r.checkedAt.slice(0,10)+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
}
