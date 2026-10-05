import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {PROFILES,DEFAULT_ASSUMPTIONS,MONEY_ASSUMPTIONS,ENGINE_VERSION} from '../public/forwarding-engine.js';
test('HTTP integration: auth, single/multi routing, alternatives, errors, opt-in preview and trial limits', async t=>{
  const child=fork(new URL('../server.js',import.meta.url),[],{
    cwd:new URL('..',import.meta.url), execArgv:['--import',new URL('./server-fixture.mjs',import.meta.url).pathname],
    env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:'0',TOMTOM_API_KEY:'test-routing-key',TOMTOM_TILES_KEY:'',OPENAI_API_KEY:'test-parser-key',RESEND_API_KEY:'',SUPABASE_URL:'https://test.supabase.invalid',SUPABASE_SERVICE_KEY:'test-supabase-key',SUPABASE_ANON_KEY:''},
    stdio:['ignore','pipe','pipe','ipc'],
  });
  let logs=''; child.stdout.on('data',d=>logs+=d); child.stderr.on('data',d=>logs+=d);
  t.after(()=>child.kill());
  const [{port}]=await once(child,'message',{signal:AbortSignal.timeout(10000)});
  const url=`http://127.0.0.1:${port}`;
  const post=(path,body,token='pro-user')=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:''},body:JSON.stringify(body)});
  const input={origin:'52.100,21.000',destination:'50.100,10.000'};
  const legacy=await post('/api/parse-stops',{text:'x'.repeat(4000)});assert.equal(legacy.status,200);const legacyData=await legacy.json();assert.equal(legacyData.offer_price_eur,null);assert.equal(legacyData.offer_price_original,1800);assert.equal(legacyData.offer_currency,'PLN');
  assert.equal((await post('/api/parse-stops',{text:'x'.repeat(20001)})).status,400);
  assert.equal((await post('/api/route',input,'')).status,401);
  assert.equal((await post('/api/forwarding/parse',{text:'test'},'')).status,401);
  assert.equal((await post('/api/forwarding/parse',{text:'test'},'inactive')).status,403);
  let imp=await post('/api/forwarding/parse',{text:'test'});assert.equal(imp.status,200);assert.equal((await imp.json()).cargo[0].weight,200);assert.equal(imp.headers.get('cache-control'),'no-store');
  assert.equal((await post('/api/forwarding/parse',{files:[{data:'invalid'}]})).status,400);
  imp=await post('/api/forwarding/parse',{files:[{data:'data:application/pdf;base64,'+Buffer.from('%PDF-1.7\n'+'x'.repeat(1100000)).toString('base64')}]});assert.equal(imp.status,200);
  assert.equal((await post('/api/forwarding/parse',{text:'x'.repeat(10*1024*1024)})).status,413);
  let fx=await fetch(url+'/api/forwarding/exchange-rate',{headers:{Authorization:'Bearer pro-user'}});assert.equal(fx.status,200);let fxData=await fx.json();assert.equal(fxData.fxSource,'NBP');assert.equal(fxData.eurPln,4.2711);assert.equal((await fetch(url+'/api/forwarding/exchange-rate')).status,401);
  const health=await (await fetch(url+'/api/health')).json();
  assert.match(health.routingEngine,/v1/);
  assert.ok(!JSON.stringify(await (await fetch(url+'/api/config')).json()).includes('test-routing-key'));
  let res=await post('/api/route',input); assert.equal(res.status,200);
  let data=await res.json();
  assert.equal(data.routing_engine,'TomTom'); assert.equal(data.tolls_geo.total_eur,35);
  assert.equal(data.alternatives[1].tolls_geo.total_eur,0);
  assert.equal(data.alternatives[1].routing_engine,'TomTom');
  assert.equal(data.quote_ready,false); assert.equal(data.margin,undefined); assert.equal(data.total_cost,undefined);
  res=await post('/api/route/multi',{...input,stops:['51.100,14.000']});
  assert.equal(res.status,200); data=await res.json();
  assert.equal(data.points_resolved.length,3); assert.equal(data.routing_engine,'TomTom');
  res=await post('/api/route',{...input,origin:'10.403,21.000'});
  assert.equal(res.status,503); data=await res.json(); assert.equal(data.code,'TOMTOM_AUTH');
  assert.ok(!JSON.stringify(data).includes('sensitive-provider-payload'));
  res=await post('/api/route',{...input,origin:'10.403,21.000',truckParams:{allowApproximateRoute:true}});
  assert.equal(res.status,200); data=await res.json(); assert.equal(data.routing_engine,'OSRM');
  assert.equal(data.tolls_geo.status,'unavailable');
  res=await post('/api/route',{...input,truckParams:{heightCm:0}}); assert.equal(res.status,400);
  for(const path of ['/api/route','/api/route/multi']) {
    res=await post(path,input,'trial-exhausted'); assert.equal(res.status,429);
  }
  const fwd={profile:'bus',mode:'dedicated',route:{origin:'A',destination:'B',distanceKm:300},vehicle:PROFILES.bus,assumptions:DEFAULT_ASSUMPTIONS,cargo:[{qty:1,length:120,width:80,height:150,weight:100}],auth_user_id:'other-user',calc:{price_eur:1}};
  assert.equal((await post('/api/forwarding/quotes',fwd,'')).status,401);
  assert.equal((await post('/api/forwarding/quotes',{...fwd,cargo:[null]})).status,400);
  res=await post('/api/forwarding/quotes',fwd);assert.equal(res.status,201);const saved=await res.json();
  assert.equal(saved.auth_user_id,'pro-user');assert.equal(saved.input.module,'forwarding');assert.equal(saved.is_draft,false);assert.ok(saved.price_eur>1);assert.equal(saved.calc.forwarding.version,ENGINE_VERSION);
  const read=async(path,token='pro-user')=>{const r=await fetch(url+path,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);return r.json();};
  assert.deepEqual((await read('/api/forwarding/quotes')).map(r=>r.id),[saved.id]);
  assert.deepEqual((await read('/api/history')).map(r=>r.id),['legacy-carrier']);
  // Per-user import limits do not block another account or other app endpoints.
  const importedOffers=await post('/api/forwarding/parse',{kind:'offers',text:'test'});assert.equal(importedOffers.status,200);assert.equal((await importedOffers.json()).offers.length,2);
  for(let i=0;i<5;i++)assert.equal((await post('/api/forwarding/parse',{text:'test'})).status,200);
  assert.equal((await post('/api/forwarding/parse',{text:'test'})).status,429);
  assert.equal((await post('/api/forwarding/parse',{text:'test'},'other-user')).status,200);
  assert.deepEqual((await read('/api/forwarding/quotes','other-user')).map(r=>r.id),['foreign-forwarding']);
  const pln={...structuredClone(fwd),currency:'PLN',eurPln:4.3,sellPrice:4300,offers:[{carrier:'Test PLN',price:3440,status:'accepted'}]};
  for(const k of MONEY_ASSUMPTIONS)pln.assumptions[k]*=pln.eurPln;
  res=await post('/api/forwarding/quotes',pln);assert.equal(res.status,201);const plnSaved=await res.json();
  assert.equal(plnSaved.input.currency,'PLN');assert.equal(plnSaved.input.eurPln,4.3);assert.equal(plnSaved.calc.forwarding.sell,4300);assert.equal(plnSaved.calc.forwarding.buy,3440);
  assert.equal(plnSaved.price_eur,1000);assert.equal(plnSaved.total_cost,800);assert.equal(plnSaved.margin_eur,200);assert.equal(plnSaved.margin_pct,20);
  assert.equal((await post('/api/forwarding/quotes',{...pln,eurPln:0})).status,400);
  assert.equal((await read('/api/forwarding/quotes')).find(r=>r.id===plnSaved.id).input.currency,'PLN');
  assert.deepEqual((await read('/api/history')).map(r=>r.id),['legacy-carrier']);
  const nbp={...structuredClone(pln),currency:'EUR',eurPln:4.2711,fxSource:'NBP',fxDate:fxData.fxDate,fxTable:fxData.fxTable,sellPrice:1000};
  res=await post('/api/forwarding/quotes',nbp);assert.equal(res.status,201);const nbpSaved=await res.json();assert.equal(nbpSaved.input.fxSource,'NBP');assert.equal(nbpSaved.input.fxTable,fxData.fxTable);
  assert.match(await (await fetch(url+'/spedycja')).text(),/forwarding.js/);
  assert.ok(!logs.includes('test-supabase-key')); assert.ok(!logs.includes('test-routing-key'));assert.ok(!logs.includes('test-parser-key'));
});
