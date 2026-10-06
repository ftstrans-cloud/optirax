// Text, clipboard images and local documents. Nothing is sent until the AI button is clicked.
import {renderOfferPreview,prepareOffers} from './carrier-offer-import.js?v=1.6.0';
export function setupEnquiryImport({api,parseLocal,apply,offerContext,applyOffers}){
  const $=id=>document.getElementById(id),dialog=$('pasteDialog');
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let files=[],parsed=null,sequence=0,request=null,reading=false,kind='enquiry',context=null;
  const status=(text,error=false)=>{$('importStatus').textContent=text;$('importStatus').className=error?'import-error':'hint';};
  function invalidate(){sequence++;request?.abort();request=null;parsed=null;$('parsePreview').hidden=true;$('applyEnquiry').hidden=true;$('parseEnquiry').disabled=reading;$('parseEnquiry').textContent='Odczytaj przez AI';status('');}
  const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name||'screen.png',data:reader.result,size:file.size});reader.onerror=()=>reject(Error('Nie udało się otworzyć pliku.'));reader.readAsDataURL(file);});
  function renderFiles(){
    $('importFilesList').innerHTML=files.map((f,i)=>`<div class="import-file">${f.data.startsWith('data:image/')?`<img src="${f.data}" alt="Podgląd załącznika ${i+1}">`:'<span class="import-pdf">PDF</span>'}<span>${escape(f.name)}<small>${(f.size/1024/1024).toFixed(2)} MB</small></span><button type="button" class="quiet" data-remove-file="${i}" aria-label="Usuń załącznik ${i+1}">×</button></div>`).join('');
    $('parseLocal').disabled=!!files.length||reading;
  }
  async function addFiles(list){
    if(reading)return;
    const incoming=Array.from(list);if(!incoming.length)return;
    invalidate();
    try{
      if(files.length+incoming.length>3)throw Error('Dodaj maksymalnie 3 screeny jednego zapytania albo jeden PDF.');
      if(incoming.some(f=>!['image/png','image/jpeg','image/webp','application/pdf'].includes(f.type)))throw Error('Wybierz PNG, JPG, WEBP lub PDF. Dokument Word możesz zapisać jako PDF.');
      if(files.reduce((s,f)=>s+f.size,0)+incoming.reduce((s,f)=>s+f.size,0)>6*1024*1024)throw Error('Maksymalnie 6 MB załączników. Przytnij screen lub zmniejsz PDF.');
      if((files.some(f=>f.data.startsWith('data:application/pdf'))||incoming.some(f=>f.type==='application/pdf'))&&files.length+incoming.length>1)throw Error('PDF dodaj osobno, bez innych załączników.');
      reading=true;$('parseEnquiry').disabled=true;$('parseLocal').disabled=true;const seq=sequence;
      const loaded=await Promise.all(incoming.map(readFile));
      if(seq===sequence)files.push(...loaded);
    }catch(e){status(e.message,true);}
    finally{reading=false;$('parseEnquiry').disabled=false;$('importFiles').value='';renderFiles();}
  }
  function preview(data){
    parsed=data;
    if(kind==='offers'){
      $('parsePreview').innerHTML=renderOfferPreview(data,context);$('parsePreview').hidden=false;$('applyEnquiry').hidden=!data.offers.length;status('Sprawdź firmy, kwoty i warunki przed dodaniem.');$('parsePreview').scrollIntoView({behavior:'smooth',block:'start'});return;
    }
    const cell=(label,value)=>`<div class="import-cell ${value?'':'missing'}"><small>${label}</small><strong>${escape(value||'Do uzupełnienia')}</strong></div>`;
    const warnings=data.warnings||[data.warning];
    $('parsePreview').innerHTML=`<h3>Sprawdź odczytane dane</h3><div class="import-grid">${cell('Załadunek',data.origin)}${cell('Rozładunek',data.destination)}${cell('Data załadunku',data.pickup)}${cell('Data dostawy',data.delivery)}${cell('Klient',data.client)}${cell('Referencja',data.reference)}</div><div class="import-cargo">${data.cargo.map((c,i)=>`<div><strong>Pozycja ${i+1}</strong><p>${escape(c.qty||'?')} szt. × ${escape(c.length||'?')} × ${escape(c.width||'?')} × ${escape(c.height||'?')} cm · <b>${escape(c.weight||'?')} kg/szt.</b></p><small>${c.stackable?'Piętrowalność odczytana — potwierdź':'Bez zakładania piętrowania'}</small></div>`).join('')||'<p class="import-error">Brak pozycji ładunku — uzupełnij w formularzu.</p>'}</div>${data.notes?`<p class="import-notes">${escape(data.notes)}</p>`:''}<p class="hint">Winda: ${data.tailLift===true?'wymagana':data.tailLift===false?'niewymagana':'nie podano'} · Paleciak: ${data.palletJack===true?'wymagany':data.palletJack===false?'niewymagany':'nie podano'}</p>${warnings.filter(Boolean).length?`<ul class="import-warnings">${warnings.filter(Boolean).map(w=>`<li>${escape(w)}</li>`).join('')}</ul>`:''}<p class="hint">Po imporcie możesz poprawić każde pole. Nowe zapytanie zastąpi bieżące dane, ceny i oferty przewoźników. Zapisane wersje pozostają w historii. Sprawdź auto, sposób przewozu, myto i dopłaty.</p>`;
    $('parsePreview').hidden=false;
    $('applyEnquiry').hidden=!(data.scope!=='multiple'&&data.scope!=='unreadable'&&(data.origin||data.destination||data.cargo.length));
    status(data.source==='ai'?'Odczyt gotowy. Sprawdź zwłaszcza kg/szt. i adresy.':'Prosty odczyt tekstu gotowy. Braki uzupełnij w formularzu.');
    $('parsePreview').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function open(mode){
    if(mode!==kind){invalidate();files=[];$('enquiry').value='';renderFiles();}
    kind=mode;context=offerContext();
    $('importTitle').textContent=mode==='offers'?'Odpowiedzi → oferty przewoźników':'Zapytanie → wycena';
    $('importIntro').textContent=mode==='offers'?'Wklej kilka odpowiedzi przewoźników dotyczących bieżącego zlecenia. Możesz też dodać do 3 screenów lub jeden PDF. Maksymalnie 10 ofert na jeden odczyt.':'Wklej treść maila, screen z Trans.eu / Clicktrans lub dodaj zlecenie PDF. Jedno zapytanie naraz; do 3 screenów tego samego zlecenia.';
    $('importDisclosure').textContent=mode==='offers'?'Odczyt AI wysyła treść i załączniki do OpenAI. Oferty zostaną dopisane po sprawdzeniu; trasa, ładunek i cena klienta pozostaną bez zmian.':'„Odczytaj przez AI” wysyła treść i załączniki do OpenAI. Kwoty wpisujesz po imporcie. Odczyt nie zapisuje wyceny ani nie wysyła oferty.';
    dialog.querySelector('.import-fallback').hidden=mode==='offers';$('importAutoRoute').closest('label').hidden=mode==='offers';
    $('applyEnquiry').textContent=mode==='offers'?'Dodaj zaznaczone oferty':'Użyj danych w nowej wycenie';
    if(parsed&&mode==='offers')invalidate();
    dialog.showModal();$('enquiry').focus();
  }
  $('pasteOpen').onclick=()=>open('enquiry');
  $('offersImportOpen').onclick=()=>open('offers');
  $('enquiry').addEventListener('input',invalidate);
  $('importFiles').addEventListener('change',e=>addFiles(e.target.files));
  dialog.addEventListener('paste',e=>{const images=Array.from(e.clipboardData?.items||[]).filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);if(images.length){e.preventDefault();addFiles(images);}});
  dialog.addEventListener('dragover',e=>{e.preventDefault();});
  dialog.addEventListener('drop',e=>{e.preventDefault();addFiles(e.dataTransfer.files);});
  $('importFilesList').onclick=e=>{const b=e.target.closest('[data-remove-file]');if(b){invalidate();files.splice(Number(b.dataset.removeFile),1);renderFiles();}};
  $('clearImport').onclick=()=>{invalidate();files=[];$('enquiry').value='';renderFiles();$('enquiry').focus();};
  dialog.addEventListener('close',()=>{if(request){invalidate();status('Odczyt przerwany. Możesz uruchomić go ponownie.');}});
  $('parseLocal').onclick=()=>{invalidate();try{preview(parseLocal($('enquiry').value));}catch(e){status(e.message,true);}};
  $('parseEnquiry').onclick=async()=>{
    invalidate();if(!files.length&&!$('enquiry').value.trim()){status('Wklej treść, screen lub dodaj PDF.',true);return;}
    dialog.querySelector('.import-fallback').open=false;
    const seq=sequence,controller=new AbortController();request=controller;
    $('parseEnquiry').disabled=true;$('parseEnquiry').textContent='Odczytywanie…';status('Odczytuję zapytanie. Formularz zmieni się dopiero po zastosowaniu danych.');
    const timeout=setTimeout(()=>controller.abort(),55000);
    try{const data=await api('/api/forwarding/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,text:$('enquiry').value,files:files.map(({data})=>({data}))}),signal:controller.signal});if(seq===sequence)preview(data);}
    catch(e){if(seq===sequence)status(e.name==='AbortError'?'Odczyt przerwany lub przekroczono czas. Spróbuj ponownie.':e.message,true);}
    finally{clearTimeout(timeout);if(seq===sequence){request=null;$('parseEnquiry').disabled=false;$('parseEnquiry').textContent='Odczytaj przez AI';}}
  };
  $('applyEnquiry').onclick=async()=>{
    if(!parsed)return;
    const data=parsed,autoRoute=$('importAutoRoute').checked;
    if(kind==='offers'){
      try{
        const edits=[...$('parsePreview').querySelectorAll('[data-import-offer]')].filter(row=>row.querySelector('[data-import=selected]').checked).map(row=>({index:Number(row.dataset.importOffer),...Object.fromEntries([...row.querySelectorAll('[data-import]')].map(el=>[el.dataset.import,el.value]))}));
        const now=offerContext();if(now.scope!==context.scope)throw Error('Dane zlecenia zmieniły się. Zamknij import i otwórz go ponownie dla aktualnego zlecenia.');
        const offers=prepareOffers(edits,data.offers,now);if(!applyOffers(offers))return;
      }catch(e){status(e.message,true);$('importStatus').scrollIntoView({block:'center'});return;}
    }else if(!apply(data,autoRoute))return;
    dialog.close();invalidate();files=[];$('enquiry').value='';renderFiles();
  };
}
