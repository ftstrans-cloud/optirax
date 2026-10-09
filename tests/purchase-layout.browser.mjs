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
let saved=[];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
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
 await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 await page.addInitScript(()=>localStorage.setItem('optirax_token','fixture'));
 await page.goto(base+'/spedycja');
 await page.locator('[data-use-offer]').waitFor();
 assert.equal(await page.locator('#fxDetails').getAttribute('open'),null);
 assert.equal(await page.locator('#offerEditor').isVisible(),true);
 for(const [id,value] of Object.entries({origin:'PL Poznań',destination:'DE Berlin',distanceKm:'300',pickup:'2026-10-10',delivery:'2026-10-11','a-targetMargin':'20'}))await page.locator('#'+id).fill(value);
 await page.locator('[data-cargo=height]').fill('150');await page.locator('[data-cargo=weight]').fill('200');
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
 assert.equal(saved[0].input.offers[1].status,'accepted');assert.equal(saved[0].input.currency,'PLN');
 await page.locator('[data-use-offer=""]').click();await page.locator('[data-load="0"]').click();
 assert.equal(await page.locator('[data-use-offer="1"]').getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('.price-range').textContent(),/1\s*020,00 zł/);
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
 // Visual checks of the whole right column and narrow layouts, in both themes.
 for(const theme of ['dark','light']){
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const width of [1680,1440,1280,1024,390,320]){
     await page.setViewportSize({width,height:1100});
     await page.evaluate(()=>window.scrollTo(0,0));
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${theme}/${width}`);
     const quote=await page.locator('#result').boundingBox(),offers=await page.locator('#selectedOfferBox').boundingBox(),fx=await page.locator('.currency-toolbar').boundingBox();
     assert.ok(quote.y<offers.y&&offers.y<fx.y);assert.ok(fx.height<120,`Compact FX at ${width}px: ${fx.height}`);
     if(width>=1200){
       const map=await page.locator('#mapDetails').boundingBox(),editor=await page.locator('#offerEditor').boundingBox(),decision=await page.locator('.decision-column').boundingBox();
       assert.ok(Math.abs(map.y-decision.y)<2,`Map starts beside quote at ${width}px`);
       assert.ok(editor.y>map.y+map.height&&editor.x<decision.x,`Offers below map in middle column at ${width}px`);
     }
     await page.screenshot({path:`${out}/${theme}-${width}.png`,fullPage:width<1200});
   }
 }
 await page.locator('#offersImportOpen').click();assert.equal(await page.locator('#pasteDialog').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: live offer choice, fixed/derived price, exclusive selection, model fallback, NBP + EUR/PLN, saved selection, invalid/rejected offers, changed cargo, customer export, responsive dark/light layouts; no browser errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
