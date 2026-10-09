// Optional isolated browser regression. Requires Playwright; no production API calls.
// Run: node tests/purchase-layout.browser.mjs (optional BROWSER_EXECUTABLE_PATH).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {calculate} from '../public/forwarding-engine.js';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=new URL('../public/',import.meta.url).pathname,out=process.env.QA_ARTIFACT_DIR||'/tmp/optirax-purchase-layout-qa';
await fs.mkdir(out,{recursive:true});
let saved=[],routeCalls=[];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    if(url.pathname==='/api/geocode')return res.end(JSON.stringify([{display_name:'Poznań, Długa 1, 61-001, Polska'}]));
    if(url.pathname==='/api/expand-url')return res.end(JSON.stringify({url:'https://www.google.com/maps/dir/Poznań/Gorzów/Berlin'}));
    if(url.pathname==='/api/route'||url.pathname==='/api/route/multi'){
      let body='';for await(const chunk of req)body+=chunk;routeCalls.push({path:url.pathname,...JSON.parse(body)});
      return res.end(JSON.stringify({routing_engine:'TomTom',distance_km:300,duration_h:6,geometry:{coordinates:[[16.92,52.4],[15.22,52.73],[13.4,52.52]]},points:[{lat:52.4,lng:16.92,label:'Poznań'},{lat:52.73,lng:15.22,label:'Gorzów'},{lat:52.52,lng:13.4,label:'Berlin'}]}));
    }
    if(url.pathname==='/api/forwarding/quotes'){
      if(req.method==='POST'){
        let body='';for await(const chunk of req)body+=chunk;
        const input=JSON.parse(body),r=calculate(input);
        saved=[{input:r.input,calc:{forwarding:r},ts:Date.now(),client:input.client,origin:input.route.origin,destination:input.route.destination,margin_pct:r.margin}];
        return res.end(JSON.stringify(saved[0]));
      }
      return res.end(JSON.stringify(saved));
    }
    return res.end(JSON.stringify(url.pathname.endsWith('exchange-rate')?{eurPln:4.25,fxSource:'NBP',fxDate:'2026-10-08',fxTable:'196/A/NBP/2026'}:{}));
  }
  if(url.pathname==='/auth.js'){res.setHeader('Content-Type','application/javascript');return res.end('');}
  const file=path.join(root,url.pathname==='/spedycja'?'spedycja.html':url.pathname);
  try{const data=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.png')?'image/png':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']}:{} )});
try{
 const page=await browser.newPage({viewport:{width:1680,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',async r=>{
   const url=r.request().url();
   if(process.env.LEAFLET_QA_DIR&&url.startsWith('https://unpkg.com/leaflet@1.9.4/dist/'))return r.fulfill({path:path.join(process.env.LEAFLET_QA_DIR,url.split('/').at(-1))});
   return url.startsWith(base)?r.continue():r.abort();
 });
 await page.addInitScript(()=>localStorage.setItem('optirax_token','fixture'));
 await page.goto(base+'/spedycja');
 await page.locator('[data-use-offer]').waitFor();
 assert.equal(await page.locator('#fxDetails').getAttribute('open'),null);
 assert.equal(await page.locator('#offerEditor').isVisible(),true);
 for(const [id,value] of Object.entries({origin:'PL Poznań',destination:'DE Berlin',distanceKm:'300',pickup:'2026-10-10',delivery:'2026-10-11','a-targetMargin':'20'}))await page.locator('#'+id).fill(value);
 await page.locator('[data-cargo=height]').fill('150');await page.locator('[data-cargo=weight]').fill('200');
 await page.locator('#fetchRoute').click();await page.waitForFunction(()=>document.getElementById('routeStatus').textContent.includes('6,0 h'));
 if(process.env.LEAFLET_QA_DIR)assert.equal(await page.locator('#routeMap path.leaflet-interactive').count(),4);
 const fetchedStatus=await page.locator('#routeStatus').textContent();
 await page.locator('#calculate').click();
 assert.equal(await page.locator('#result').isVisible(),true);
 for(const [carrier,price] of [['Transport Alfa','200'],['Transport Beta','240']]){
   await page.locator('#addOffer').click();
   const row=page.locator('.offer-row').last();
   await row.locator('[data-offer=carrier]').fill(carrier);await row.locator('[data-offer=price]').fill(price);
 }
 await page.locator('[data-use-offer="0"]').click();
 assert.match(await page.locator('#result .price-value').textContent(),/250,00/);
 assert.match(await page.locator('.price-range').textContent(),/200,00 EUR.*Transport Alfa/);
 assert.equal(await page.locator('[data-use-offer="0"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-use-offer="1"]').click();
 assert.match(await page.locator('#result .price-value').textContent(),/300,00/);
 assert.deepEqual(await page.locator('[data-offer=status]').evaluateAll(es=>es.map(e=>e.value)),['received','accepted']);
 await page.locator('#sellPrice').fill('400');await page.locator('[data-use-offer="0"]').click();
 assert.match(await page.locator('#result .price-value').textContent(),/400,00/);
 assert.match(await page.locator('.decision-stats').textContent(),/200,00 EUR.*50,0%/);
 await page.locator('[data-use-offer=""]').click();assert.match(await page.locator('.price-range').textContent(),/model/);
 assert.equal(await page.locator('[data-offer=status]').evaluateAll(es=>es.every(e=>e.value==='received')),true);
 await page.locator('[data-use-offer="0"]').click();
 // Currency is collapsed until requested; missing exchange rate opens and focuses it.
 await page.locator('#quoteCurrency').selectOption('PLN');
 assert.equal(await page.locator('#quoteCurrency').inputValue(),'EUR');
 assert.equal(await page.locator('#eurPln').evaluate(e=>document.activeElement===e),true);
 await page.locator('#fetchFx').click();await page.waitForFunction(()=>document.getElementById('eurPln').value==='4.25');
 await page.locator('#quoteCurrency').selectOption('PLN');
 assert.match(await page.locator('#result .price-value').textContent(),/1\s*700,00/);
 assert.match(await page.locator('[data-use-offer="0"]').textContent(),/850,00 zł/);
 await page.locator('[data-use-offer="1"]').click();
 assert.match(await page.locator('.price-range').textContent(),/1\s*020,00 zł/);
 assert.match(await page.locator('.decision-stats').textContent(),/680,00 zł.*40,0%/);
 await page.locator('#fxDetails summary').click();
 await page.locator('#saveQuote').click();await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));
 assert.equal(routeCalls.length,1);assert.equal(saved[0].input.route.durationHours,6);assert.equal(saved[0].input.route.source,'TomTom');assert.equal(saved[0].input.route.snapshot.coordinates.length,3);assert.equal(await page.locator('#routeStatus').textContent(),fetchedStatus);
 assert.equal(saved[0].input.offers[1].status,'accepted');assert.equal(saved[0].input.currency,'PLN');
 await page.locator('[data-use-offer=""]').click();await page.locator('[data-load="0"]').click();
 assert.equal(await page.locator('[data-use-offer="1"]').getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('.price-range').textContent(),/1\s*020,00 zł/);
 assert.equal(routeCalls.length,1);assert.equal(await page.locator('#distanceKm').inputValue(),'300');if(process.env.LEAFLET_QA_DIR)assert.equal(await page.locator('#routeMap path.leaflet-interactive').count(),4);
 // Rejected and incomplete offers cannot become the purchase.
 await page.locator('[data-offer=status]').first().selectOption('rejected');
 assert.equal(await page.locator('[data-use-offer="0"]').isDisabled(),true);
 await page.locator('#addOffer').click();assert.equal(await page.locator('[data-use-offer="2"]').isDisabled(),true);
 await page.locator('.remove-offer').last().click();
 await page.locator('[data-offer=status]').first().selectOption('received');
 await page.locator('#sellPrice').fill('');await page.locator('[data-use-offer="1"]').click();
 assert.match(await page.locator('#result .price-value').textContent(),/1\s*275,00/);
 // Data edits invalidate the selected quote and prevent stale prices from being saved.
 await page.locator('[data-cargo=weight]').fill('250');
 assert.equal(await page.locator('#result').isVisible(),false);assert.equal(await page.locator('#saveQuote').isDisabled(),true);
 assert.equal(await page.locator('[data-use-offer=""]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-use-offer="1"]').click(); // confirmation after scope changed
 assert.match(await page.locator('.price-range').textContent(),/Transport Beta/);
 await page.locator('#reviewed').check();await page.locator('#calculate').click();
 await page.locator('#offerOpen').click();const text=await page.locator('#customerText').inputValue();
 assert.doesNotMatch(text,/Transport Beta|1020|marża|Zakup/);await page.locator('[data-close=offerDialog]').click();
 // Carrier-only quote: empty cost inputs must not block calculation or persistence.
 await page.locator('#a-kmRate').fill('');await page.locator('#a-hourRate').fill('');
 await page.locator('#useCostModel').uncheck();
 assert.equal(await page.locator('#a-kmRate').isDisabled(),true);
 assert.equal(await page.locator('#modelAssumptions').isVisible(),false);
 assert.equal(await page.locator('[data-use-offer=""]').isDisabled(),true);
 await page.locator('[data-use-offer="1"]').click();
 assert.match(await page.locator('#result .price-value').textContent(),/1\s*275,00/);
 assert.doesNotMatch(await page.locator('#calculationBreakdown').textContent(),/Zakres zakupu z modelu/);
 await page.locator('#saveQuote').click();await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));
 assert.equal(saved[0].input.useCostModel,false);assert.equal(saved[0].input.assumptions.kmRate,null);
 await page.locator('#useCostModel').check();
 await page.locator('[data-load="0"]').click();
 assert.equal(await page.locator('#useCostModel').isChecked(),false);
 assert.match(await page.locator('.price-range').textContent(),/1\s*020,00 zł/);
 // Turning the model back on restores editable, valid defaults after loading.
 await page.locator('#useCostModel').check();assert.equal(await page.locator('#a-kmRate').isDisabled(),false);
 assert.ok(Number(await page.locator('#a-kmRate').inputValue())>0);
 await page.locator('#useCostModel').uncheck();
 await page.locator('[data-offer=status]').last().selectOption('received');await page.locator('#calculate').click();
 assert.match(await page.locator('#message').textContent(),/Wybierz ofertę przewoźnika/);assert.equal(await page.locator('#saveQuote').isDisabled(),true);
 await page.locator('[data-use-offer="1"]').click();
 // Full-address suggestions, multi-point routing and both Maps URL formats.
 await page.locator('#origin').fill('Poznan');await page.locator('#routeSuggestions [role=option]').first().waitFor();
 await page.locator('#origin').press('ArrowDown');await page.locator('#origin').press('Enter');
 assert.equal(await page.locator('#origin').inputValue(),'Poznań, Długa 1, 61-001, Polska');
 assert.equal(await page.locator('#distanceKm').inputValue(),'');
 await page.locator('#addRouteStop').click();await page.locator('[data-stop]').fill('Gorzów');
 await page.locator('#fetchRoute').click();await page.waitForFunction(()=>document.getElementById('distanceKm').value==='300');
 assert.equal(routeCalls.at(-1).path,'/api/route/multi');assert.deepEqual(routeCalls.at(-1).stops,['Gorzów']);
 for(const link of ['https://www.google.com/maps/dir/?api=1&origin=Poznan&destination=Berlin&waypoints=Gorzow%7CFrankfurt','https://maps.app.goo.gl/example']){
   await page.locator('#mapsImport summary').click();await page.locator('#mapsUrl').fill(link);await page.locator('#importMaps').click();
   await page.waitForFunction(()=>!document.getElementById('mapsImport').open);
   assert.equal(await page.locator('#distanceKm').inputValue(),'');
 }
 assert.equal(await page.locator('[data-stop]').inputValue(),'Gorzów');
 await page.locator('#fetchRoute').click();await page.waitForFunction(()=>document.getElementById('distanceKm').value==='300');
 const callsBeforeSelection=routeCalls.length;
 await page.locator('[data-use-offer="1"]').click();
 await page.locator('#saveQuote').click();await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('Zapisano'));
 assert.deepEqual(saved[0].input.route.stops,['Gorzów']);assert.equal(routeCalls.length,callsBeforeSelection);
 await page.locator('[data-load="0"]').click();
 assert.equal(await page.locator('[data-stop]').inputValue(),'Gorzów');assert.equal(routeCalls.length,callsBeforeSelection);
 if(process.env.LEAFLET_QA_DIR)assert.equal(await page.locator('#routeMap path.leaflet-interactive').count(),4);
 // Desktop panes scroll independently; the document and the other panes stay still.
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('#workspace>[tabindex]').forEach(e=>e.scrollTop=0);});
 const panes=['.form-column','.context-column','.decision-column'];
 for(let i=0;i<panes.length;i++){
   await page.locator(panes[i]).hover();await page.mouse.wheel(0,400);
   await page.waitForFunction(sel=>document.querySelector(sel).scrollTop>0,panes[i]);
   const offsets=await page.locator('#workspace>[tabindex]').evaluateAll(es=>es.map(e=>e.scrollTop));
   assert.ok(offsets[i]>0);offsets.forEach((v,j)=>{if(j!==i)assert.equal(v,0);});
   assert.equal(await page.evaluate(()=>window.scrollY),0);
   await page.evaluate(()=>document.querySelectorAll('#workspace>[tabindex]').forEach(e=>e.scrollTop=0));
 }
 // Visual checks of the whole right column and narrow layouts, in both themes.
 for(const theme of ['dark','light']){
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const width of [2560,1680,1440,1280,1024,800,390,320]){
     await page.setViewportSize({width,height:1100});
     await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('#workspace>[tabindex]').forEach(e=>e.scrollTop=0);});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${theme}/${width}`);
     const quote=await page.locator('#result').boundingBox(),offers=await page.locator('#selectedOfferBox').boundingBox(),fx=await page.locator('.currency-toolbar').boundingBox();
     assert.ok(quote.y<offers.y&&offers.y<fx.y);assert.ok(fx.height<120,`Compact FX at ${width}px: ${fx.height}`);
     if(width>=760){
       const bounds=await page.locator('#workspace').boundingBox();assert.ok(bounds.x<=16&&width-(bounds.x+bounds.width)<=16,'Workspace fills window');
       const map=await page.locator('#mapDetails').boundingBox(),editor=await page.locator('#offerEditor').boundingBox(),decision=await page.locator('.decision-column').boundingBox();
       assert.ok(Math.abs(map.y-decision.y)<2,`Map starts beside quote at ${width}px`);
       assert.ok(editor.y>map.y+map.height&&editor.x<decision.x,`Offers below map in middle column at ${width}px`);
     }
     await page.screenshot({path:`${out}/${theme}-${width}.png`,fullPage:width<1200});
   }
 }
 // Browser zoom changes the CSS viewport: check short desktop viewports too.
 for(const [width,height] of [[1280,720],[1024,576],[800,450]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('#workspace>[tabindex]').forEach(e=>e.scrollTop=0);});
   await page.waitForFunction(()=>document.getElementById('workspace').getBoundingClientRect().bottom<=innerHeight);
   const bounds=await page.locator('#workspace>[tabindex]').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,scroll:e.scrollHeight,client:e.clientHeight};}));
   assert.ok(bounds.every(b=>b.bottom<=height&&b.scroll>b.client));assert.ok(bounds.every(b=>Math.abs(b.top-bounds[0].top)<2));
 }
 // Editing a routing parameter invalidates distance and map, unlike price changes.
 await page.locator('#origin').fill('Warszawa');
 assert.equal(await page.locator('#distanceKm').inputValue(),'');
 if(process.env.LEAFLET_QA_DIR)assert.equal(await page.locator('#routeMap path.leaflet-interactive').count(),0);
 await page.locator('#offersImportOpen').click();assert.equal(await page.locator('#pasteDialog').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: live offer choice, fixed/derived price, exclusive selection, model fallback, NBP + EUR/PLN, saved selection, invalid/rejected offers, changed cargo, customer export, responsive dark/light layouts; no browser errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
