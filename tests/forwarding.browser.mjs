// Optional real-browser acceptance test. Requires Playwright in the QA environment only.
// Run: node tests/forwarding.browser.mjs (or set BROWSER_EXECUTABLE_PATH).
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {png,extracted} from './enquiry-fixture.mjs';
import {normalizeExtraction} from '../lib/enquiry-parser.js';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const out=process.env.QA_ARTIFACT_DIR||'/tmp/optirax-forwarding-qa';await mkdir(out,{recursive:true});
const child=fork(new URL('../server.js',import.meta.url),[],{cwd:new URL('..',import.meta.url),execArgv:['--import',new URL('./server-fixture.mjs',import.meta.url).pathname],env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:'0',TOMTOM_API_KEY:'test-routing-key',OPENAI_API_KEY:'test-parser-key',RESEND_API_KEY:'',SUPABASE_URL:'https://test.supabase.invalid',SUPABASE_SERVICE_KEY:'test-supabase-key'},stdio:['ignore','ignore','ignore','ipc']});
let browser;
try{
  const [{port}]=await once(child,'message',{signal:AbortSignal.timeout(10000)}),base=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']}:{} )});
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),errors=[];
  await context.addInitScript(()=>{if(location.protocol==='http:')localStorage.setItem('optirax_token','pro-user');});
  await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  // Stale unversioned assets must not be used by the new HTML or module imports.
  const legacyRequests=[];
  for(const name of ['forwarding.css','forwarding.js','forwarding-engine.js'])await context.route(base+'/'+name,route=>{legacyRequests.push(name);return route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':'application/javascript',body:name.endsWith('.css')?':root{color-scheme:light}body{background:green}':'throw new Error("Stale asset loaded")'});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base+'/spedycja');await page.locator('[data-cargo=height]').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await page.locator('.brand-logo').evaluate(el=>el.complete&&el.naturalWidth>0),true);
  const colors=()=>page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,card:getComputedStyle(document.querySelector('.card')).backgroundColor,inputFont:getComputedStyle(document.getElementById('origin')).fontSize}));
  assert.deepEqual(await colors(),{body:'rgb(14, 22, 36)',card:'rgb(22, 34, 53)',inputFont:'16px'});
  assert.equal(await page.locator('.brand-logo').evaluate(el=>el.getBoundingClientRect().width<=224&&el.getBoundingClientRect().height<=50),true);
  await page.locator('#themeToggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  assert.equal(await page.evaluate(()=>localStorage.getItem('optirax_theme')),'light');
  assert.deepEqual(await colors(),{body:'rgb(236, 234, 227)',card:'rgb(247, 246, 242)',inputFont:'16px'});
  await page.reload();await page.locator('[data-cargo=height]').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal((await colors()).body,'rgb(236, 234, 227)');
  assert.deepEqual(legacyRequests,[]);
  async function fill(){
    for(const [id,value] of Object.entries({origin:'52.100,21.000',destination:'50.100,10.000',client:'DEMO / Klient testowy',reference:'OF/001',pickup:'2026-10-10',delivery:'2026-10-11'}))await page.locator('#'+id).fill(value);
    for(const [key,value] of Object.entries({qty:'2',height:'150',weight:'200'}))await page.locator(`[data-cargo=${key}]`).fill(value);
  }
  await fill();await page.locator('#fetchRoute').click();await page.waitForFunction(()=>document.getElementById('distanceKm').value==='200');
  await page.locator('#calculate').click();assert.equal(await page.locator('#offerOpen').isDisabled(),true);
  await page.locator('#reviewed').check();await page.locator('#calculate').click();assert.equal(await page.locator('#offerOpen').isEnabled(),true);
  await page.locator('#saveQuote').click();await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));
  await page.locator('[data-load="0"]').waitFor();const price=await page.locator('.price-value').textContent();
  await page.locator('[data-load="0"]').click();assert.equal(await page.locator('.price-value').textContent(),price);assert.equal(await page.locator('#offerOpen').isDisabled(),true);
  await page.locator('#addOffer').click();await page.locator('[data-offer=carrier]').fill('Przewoźnik testowy');await page.locator('[data-offer=price]').fill('180');
  await page.locator('#reviewed').check();await page.locator('#calculate').click();assert.match(await page.locator('.price-range').textContent(),/model/);
  await page.locator('[data-offer=status]').selectOption('accepted');await page.locator('#reviewed').check();await page.locator('#calculate').click();assert.match(await page.locator('.price-range').textContent(),/180,00 EUR · przyjęta oferta/);
  await page.locator('#offerOpen').click();const offer=await page.locator('#customerText').inputValue();assert.doesNotMatch(offer,/180.00|Przewoźnik testowy|marża|Zakup/);
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#printOffer').click();await page.emulateMedia({media:'print'});assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#printArea').isVisible(),true);assert.equal(await page.locator('#printArea').textContent(),offer);await page.pdf({path:out+'/customer-offer.pdf',format:'A4'});await page.emulateMedia({media:'screen'});
  await page.locator('[data-cargo=weight]').fill('700');await page.locator('#calculate').click();assert.equal(await page.locator('[data-offer=status]').inputValue(),'received');assert.match(await page.locator('.blocker').textContent(),/ładowność/);assert.equal(await page.locator('#offerOpen').isDisabled(),true);
  await page.locator('[data-cargo=weight]').fill('200');await page.locator('#reviewed').check();await page.locator('#calculate').click();
  // Currency changes convert every money field, preserving dimensions, time and margin.
  await page.locator('#quoteCurrency').selectOption('PLN');assert.equal(await page.locator('#quoteCurrency').inputValue(),'EUR');assert.match(await page.locator('#message').textContent(),/kurs/);
  await page.locator('#eurPln').fill('4.3');await page.locator('#sellPrice').fill('250');await page.locator('[data-offer=price]').fill('200');await page.locator('[data-offer=status]').selectOption('accepted');await page.locator('#reviewed').check();await page.locator('#calculate').click();
  const eurFields=await page.locator('[data-money]').evaluateAll(els=>els.map(el=>el.value));
  for(let i=0;i<3;i++){await page.locator('#quoteCurrency').selectOption('PLN');await page.locator('#quoteCurrency').selectOption('EUR');}
  assert.deepEqual(await page.locator('[data-money]').evaluateAll(els=>els.map(el=>el.value)),eurFields);
  await page.locator('#quoteCurrency').selectOption('PLN');assert.equal(await page.locator('#a-kmRate').inputValue(),'1.634');assert.equal(await page.locator('#a-hourRate').inputValue(),'60.2');assert.equal(await page.locator('#a-deadheadKm').inputValue(),'30');assert.equal(await page.locator('[data-cargo=weight]').inputValue(),'200');
  assert.equal(await page.locator('[data-offer=price]').inputValue(),'860');assert.equal(await page.locator('#sellPrice').inputValue(),'1075');assert.match(await page.locator('.price-value.pln').textContent(),/1\s*075,00 zł/);assert.match(await page.locator('.currency-equivalent strong').textContent(),/250,00 EUR/);assert.equal(await page.locator('#offerOpen').isDisabled(),true);
  assert.match(await page.locator('.sell-label').textContent(),/PLN/);assert.match(await page.locator('[data-offer=price]').locator('..').textContent(),/PLN/);
  const plnFields=await page.locator('[data-money]').evaluateAll(els=>els.map(el=>el.value));await page.locator('#eurPln').fill('4.6');assert.deepEqual(await page.locator('[data-money]').evaluateAll(els=>els.map(el=>el.value)),plnFields);
  await page.locator('#client').fill('Waluta PLN / test');await page.locator('#reviewed').check();await page.locator('#calculate').click();assert.match(await page.locator('.currency-equivalent strong').textContent(),/233,70 EUR/);
  await page.locator('#offerOpen').click();assert.match(await page.locator('#customerText').inputValue(),/1075.00 PLN netto/);await page.locator('#printOffer').click();await page.emulateMedia({media:'print'});await page.pdf({path:out+'/customer-offer-pln.pdf',format:'A4'});assert.doesNotMatch(await page.locator('#printArea').textContent(),/EUR netto|860.00/);await page.emulateMedia({media:'screen'});
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/forwarding/quotes')&&r.request().method()==='POST');await page.locator('#saveQuote').click();const savedPln=await (await savedResponse).json();assert.equal(savedPln.price_eur,233.7);assert.equal(savedPln.calc.forwarding.sell,1075);assert.equal(savedPln.input.eurPln,4.6);
  await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));const plnHistory=page.locator('#history tbody tr').filter({hasText:'Waluta PLN / test'});await plnHistory.waitFor();assert.match(await plnHistory.textContent(),/1\s*075,00 zł/);
  await page.locator('#eurPln').fill('2');await plnHistory.locator('button').click();assert.equal(await page.locator('#eurPln').inputValue(),'4.6');assert.equal(await page.locator('#quoteCurrency').inputValue(),'PLN');assert.equal(await page.locator('#sellPrice').inputValue(),'1075');
  await page.locator('[data-load="0"]').click();assert.equal(await page.locator('#quoteCurrency').inputValue(),'EUR');assert.equal(await page.locator('#eurPln').inputValue(),'');assert.equal(await page.locator('.currency-equivalent').count(),0);
  await plnHistory.locator('button').click();await page.locator('#reviewed').check();await page.locator('#calculate').click();
  // NBP updates only by explicit click, preserves native amounts and saves its provenance.
  await page.locator('#fetchFx').click();await page.waitForFunction(()=>document.getElementById('eurPln').value==='4.2711');
  assert.equal(await page.locator('#sellPrice').inputValue(),'1075');assert.match(await page.locator('#fxStatus').textContent(),/199\/A\/NBP\/2026/);assert.equal(await page.locator('#reviewed').isChecked(),false);
  await page.locator('#client').fill('NBP / snapshot');await page.locator('#calculate').click();
  const nbpSavedResponse=page.waitForResponse(r=>r.url().endsWith('/api/forwarding/quotes')&&r.request().method()==='POST');await page.locator('#saveQuote').click();const nbpSaved=await (await nbpSavedResponse).json();assert.equal(nbpSaved.input.fxSource,'NBP');assert.equal(nbpSaved.input.fxDate,'2026-10-02');
  await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));
  const nbpHistory=page.locator('#history tbody tr').filter({hasText:'NBP / snapshot'});await nbpHistory.waitFor();
  await page.locator('#eurPln').fill('4.5');assert.match(await page.locator('#fxStatus').textContent(),/ręczny/);await nbpHistory.locator('button').click();assert.equal(await page.locator('#eurPln').inputValue(),'4.2711');assert.match(await page.locator('#fxStatus').textContent(),/NBP/);
  // Failure and late replies must never overwrite a manual edit or loaded quote.
  await page.route('**/api/forwarding/exchange-rate',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'NBP niedostępne. Zachowano dotychczasowy kurs.'})}));await page.locator('#fetchFx').click();await page.waitForFunction(()=>!document.getElementById('fetchFx').disabled);assert.equal(await page.locator('#eurPln').inputValue(),'4.2711');assert.match(await page.locator('#message').textContent(),/niedostępne/);await page.unroute('**/api/forwarding/exchange-rate');
  let heldFx,startedFx;const pendingFx=new Promise(resolve=>startedFx=resolve);await page.route('**/api/forwarding/exchange-rate',r=>{heldFx=r;startedFx();});await page.locator('#fetchFx').click();await pendingFx;await page.locator('#eurPln').fill('4.6');await heldFx.fulfill({status:200,contentType:'application/json',body:JSON.stringify({eurPln:4.2711,fxSource:'NBP',fxDate:'2026-10-02',fxTable:'199/A/NBP/2026'})});await page.waitForFunction(()=>!document.getElementById('fetchFx').disabled);assert.equal(await page.locator('#eurPln').inputValue(),'4.6');assert.match(await page.locator('#fxStatus').textContent(),/ręczny/);await page.unroute('**/api/forwarding/exchange-rate');
  await nbpHistory.locator('button').click();await page.locator('#reviewed').check();await page.locator('#calculate').click();
  await page.setViewportSize({width:1680,height:1100});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/desktop-light.png',fullPage:true});
  await page.locator('#themeToggle').click();await page.screenshot({path:out+'/desktop.png',fullPage:true,animations:'disabled'});
  await page.locator('#offerOpen').click();await page.screenshot({path:out+'/offer-modal.png'});assert.equal(await page.locator('#customerText').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),true);await page.locator('[data-close=offerDialog]').click();
  for(const width of [1680,1440,1024,901,900,768,390,320]){await page.setViewportSize({width,height:900});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`No horizontal page overflow at ${width}px`);await page.locator('#pasteOpen').click();assert.equal(await page.locator('#pasteDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`Modal overflow at ${width}px`);await page.locator('[data-close=pasteDialog]').click();}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/mobile.png'});
  await page.locator('#origin').fill('52.200,21.000');assert.equal(await page.locator('#distanceKm').inputValue(),'');assert.equal(await page.locator('#saveQuote').isDisabled(),true);assert.equal(await page.locator('#result').isVisible(),false);
  // Race: a late route must not restore a result after editing the destination.
  let held,started;const pending=new Promise(resolve=>started=resolve);
  await page.route('**/api/route',route=>{held=route;started();});
  await page.locator('#fetchRoute').click();await pending;await page.locator('#destination').fill('51.000,11.000');
  await held.fulfill({status:200,contentType:'application/json',body:JSON.stringify({routing_engine:'TomTom',distance_km:999,duration_h:9})}).catch(()=>{});
  await page.locator('#client').fill('<img src=x onerror=alert(1)>');await page.locator('#distanceKm').fill('320');await page.locator('#reviewed').check();await page.locator('#calculate').click();
  await page.locator('#saveQuote').click();await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));
  await page.locator('#refreshHistory').click();await page.waitForFunction(()=>document.getElementById('history').textContent.includes('<img src=x'));
  assert.equal(await page.locator('#history img').count(),0);assert.equal(await page.locator('#distanceKm').inputValue(),'320');
  await page.locator('#pasteOpen').click();await page.locator('#enquiry').fill('Załadunek: PL Poznań\nRozładunek: DE Berlin\n3 x 120x80x100 cm, 100 kg/szt.');await page.locator('.import-fallback summary').click();await page.locator('#parseLocal').click();assert.match(await page.locator('#parsePreview').textContent(),/3 szt/);await page.locator('#importAutoRoute').uncheck();await page.locator('#applyEnquiry').click();assert.equal(await page.locator('[data-cargo=qty]').inputValue(),'3');assert.equal(await page.locator('#distanceKm').inputValue(),'');
  assert.equal(await page.locator('#client').inputValue(),'');assert.equal(await page.locator('#sellPrice').inputValue(),'');assert.equal(await page.locator('#pickup').inputValue(),'');assert.equal(await page.locator('.offer-row').count(),0);
  await page.unroute('**/api/route');
  // Paste an image from the clipboard. The AI service is mocked; no live document upload.
  await page.locator('#sellPrice').fill('999');await page.locator('#client').fill('Poprzedni klient');await page.locator('#addOffer').click();
  await page.locator('#pasteOpen').click();
  await page.evaluate(data=>{const raw=atob(data.split(',')[1]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),clipboard=new DataTransfer();clipboard.items.add(new File([bytes],'screen.png',{type:'image/png'}));document.getElementById('enquiry').dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));},png);
  await page.locator('.import-file img').waitFor();assert.equal(await page.locator('#parseLocal').isDisabled(),true);
  const aiResponse=page.waitForResponse('**/api/forwarding/parse');await page.locator('#parseEnquiry').click();assert.equal((await aiResponse).status(),200);await page.locator('#applyEnquiry').waitFor();
  assert.match(await page.locator('#parsePreview').textContent(),/200 kg\/szt/);assert.equal(await page.locator('#client').inputValue(),'Poprzedni klient');
  await page.setViewportSize({width:1440,height:1100});await page.locator('#pasteDialog').evaluate(el=>el.scrollTop=0);await page.screenshot({path:out+'/import-dark.png'});
  await page.locator('#importAutoRoute').uncheck();await page.locator('#applyEnquiry').click();assert.equal(await page.locator('[data-cargo=weight]').inputValue(),'200');assert.equal(await page.locator('#tailLift').isChecked(),true);assert.equal(await page.locator('#reviewed').isChecked(),false);assert.equal(await page.locator('#sellPrice').inputValue(),'');assert.equal(await page.locator('#client').inputValue(),'');assert.equal(await page.locator('.offer-row').count(),0);
  // PDF follows the same endpoint; new content invalidates a pending result.
  await page.locator('#themeToggle').click();await page.locator('#pasteOpen').click();await page.locator('#importFiles').setInputFiles({name:'zlecenie.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')});await page.locator('.import-pdf').waitFor();await page.locator('#parseEnquiry').click();await page.locator('#applyEnquiry').waitFor();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('#pasteDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);}
  await page.locator('#parsePreview').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/import-mobile.png'});
  await page.setViewportSize({width:1440,height:1100});await page.locator('#pasteDialog').evaluate(el=>el.scrollTop=0);await page.screenshot({path:out+'/import-light.png'});
  await page.locator('#clearImport').click();await page.locator('#enquiry').fill('Zapytanie A');
  let heldImport,importStarted;const pendingImport=new Promise(resolve=>importStarted=resolve);await page.route('**/api/forwarding/parse',route=>{heldImport=route;importStarted();});await page.locator('#parseEnquiry').click();await pendingImport;await page.locator('#enquiry').fill('Zapytanie B');await heldImport.fulfill({status:200,contentType:'application/json',body:JSON.stringify(normalizeExtraction(extracted))}).catch(()=>{});assert.equal(await page.locator('#applyEnquiry').isVisible(),false);await page.unroute('**/api/forwarding/parse');
  // Multiple orders and unsafe HTML must never be silently applied or executed.
  await page.route('**/api/forwarding/parse',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(normalizeExtraction({...extracted,scope:'multiple',origin:'<img src=x onerror=alert(1)>'}))}));await page.locator('#parseEnquiry').click();await page.locator('#parsePreview').waitFor();assert.equal(await page.locator('#applyEnquiry').isVisible(),false);assert.equal(await page.locator('#parsePreview img').count(),0);await page.unroute('**/api/forwarding/parse');await page.locator('[data-close=pasteDialog]').click();
  // No token redirects to login, even though static HTML is public.
  // Several carrier offers append to the same order and keep its sale price and cargo.
  await page.locator('#quoteCurrency').selectOption('EUR');await page.locator('#eurPln').fill('4.5');await page.locator('#sellPrice').fill('900');await page.locator('#reference').fill('IMPORT-MULTI');await page.locator('#distanceKm').fill('300');
  await page.locator('#addOffer').click();await page.locator('[data-offer=carrier]').fill('Oferta wcześniejsza');await page.locator('[data-offer=price]').fill('500');
  const beforeImport=await page.evaluate(()=>['origin','destination','pickup','delivery','sellPrice','reference'].map(id=>document.getElementById(id).value));
  await page.locator('#offersImportOpen').click();await page.locator('#enquiry').fill('Firma A: 450 EUR netto, winda. Firma B: 1800 PLN netto, bez windy.');await page.locator('#parseEnquiry').click();await page.locator('[data-import-offer="1"]').waitFor();
  assert.match(await page.locator('#parsePreview').textContent(),/NIEZGODNOŚĆ/);
  await page.locator('[data-import-offer="1"] [data-import=taxBasis]').selectOption('unknown');await page.locator('#applyEnquiry').click();assert.match(await page.locator('#importStatus').textContent(),/Potwierdź kwotę netto/);assert.equal(await page.locator('.offer-row').count(),1);
  await page.locator('[data-import-offer="1"] [data-import=taxBasis]').selectOption('net');
  await page.setViewportSize({width:390,height:844});await page.locator('[data-import-offer="1"]').scrollIntoViewIfNeeded();assert.equal(await page.locator('#pasteDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);await page.screenshot({path:out+'/carrier-offers-mobile.png'});
  await page.setViewportSize({width:1440,height:1100});await page.locator('[data-import-offer="0"]').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/carrier-offers-desktop.png'});await page.locator('#applyEnquiry').click();
  assert.equal(await page.locator('.offer-row').count(),3);assert.deepEqual(await page.evaluate(()=>['origin','destination','pickup','delivery','sellPrice','reference'].map(id=>document.getElementById(id).value)),beforeImport);
  assert.equal(await page.locator('[data-offer=price]').nth(2).inputValue(),'400');assert.equal(await page.locator('[data-offer=status]').nth(2).inputValue(),'received');assert.match(await page.locator('.offer-row').nth(2).textContent(),/1800 PLN/);
  await page.locator('#calculate').click();const saveImported=page.waitForResponse(r=>r.url().endsWith('/api/forwarding/quotes')&&r.request().method()==='POST');await page.locator('#saveQuote').click();const savedImported=await(await saveImported).json();assert.equal(savedImported.input.offers.length,3);assert.equal(savedImported.input.offers[2].terms,'Bez windy.');assert.match(savedImported.input.offers[2].importSource,/1800 PLN/);
  await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));await page.locator('#refreshHistory').click();const savedRow=page.locator('#history tr').filter({hasText:'IMPORT-MULTI'});await savedRow.locator('button').click();assert.equal(await page.locator('[data-offer=terms]').nth(2).inputValue(),'Bez windy.');
  await page.evaluate(()=>{localStorage.removeItem('optirax_token');});await page.unroute('**/api/route');
  const anonymous=await browser.newContext();await anonymous.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());const guest=await anonymous.newPage();await guest.goto(base+'/spedycja');await guest.waitForURL('**/login');
  assert.deepEqual(errors,[]);assert.deepEqual(legacyRequests,[]);console.log('PASS: versioned assets bypass old URLs; actual dark/light colors, reload persistence, logo size, 16px inputs; NBP fetch/failure/race/snapshot; modals and 8 viewport widths; EUR/PLN, PDF, routing, purchase, blockers, privacy, parser, XSS and auth. External network blocked.');
}finally{await browser?.close();child.kill();}
