import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,normalizeInput,parseEnquiry,customerOffer,ForwardingError,PROFILES,DEFAULT_ASSUMPTIONS,MONEY_ASSUMPTIONS,convertMoney} from '../public/forwarding-engine.js';
import {createExchangeRateService} from '../lib/exchange-rate.js';

export function sample(){return {profile:'bus',mode:'dedicated',vehicle:{...PROFILES.bus},assumptions:{...DEFAULT_ASSUMPTIONS},route:{origin:'PL Poznań',destination:'DE Berlin',distanceKm:300,durationHours:5,source:'TomTom'},cargo:[{qty:2,length:120,width:80,height:150,weight:200,stackable:false}],client:'Test',pickup:'2026-10-10',delivery:'2026-10-11',reviewed:true,offers:[]};}
test('forwarding: dedicated costs, margin on sales and fixed sell-price ceiling reconcile',()=>{
  const i=sample();Object.assign(i.assumptions,{kmRate:1,hourRate:10,deadheadKm:0,fixed:0,tolls:0,crossing:0,carrierMarkup:0,minimumBuy:0,targetMargin:20,minimumMargin:10});
  let r=calculate(i);assert.equal(r.buy,350);assert.equal(r.sell,437.5);assert.equal(r.profit,87.5);assert.equal(r.margin,20);assert.equal(r.maxBuy,393.75);
  i.sellPrice=375;r=calculate(i);assert.equal(r.maxBuy,337.5);assert.equal(r.overBudget,true);assert.equal(r.profit,25);
});
test('forwarding: partload allocates largest load share and keeps pickup costs in full',()=>{
  const i=sample();i.mode='partload';const r=calculate(i);
  assert.equal(r.share,400/900);assert.ok(r.shares.weight>r.shares.floor);
  const dedicated=calculate({...i,mode:'dedicated'});assert.equal(r.costs.shipment,dedicated.costs.shipment);assert.ok(r.buy<dedicated.buy);
  i.cargo[0].weight=1;assert.equal(calculate(i).share,.3);
});
test('forwarding: real vehicle floor, standard LDM and stacking assumptions stay distinct',()=>{
  const i=sample(),r=calculate(i);assert.equal(r.summary.ldm,.8);assert.equal(r.summary.area,1.92);
  assert.equal(r.shares.floor,1.92/(4.2*2.1));i.cargo[0].stackable=true;
  assert.equal(calculate(i).shares.floor,r.shares.floor);assert.equal(calculate(i).buy,r.buy);
});
test('forwarding: excess weight, floor and oversize pieces block customer offer',()=>{
  const i=sample();i.cargo[0].weight=600;let r=calculate(i);assert.match(r.blockers.join(' '),/ładowność/);assert.equal(r.ready,false);assert.throws(()=>customerOffer(r),ForwardingError);
  i.cargo[0]={qty:1,length:430,width:200,height:100,weight:100};r=calculate(i);assert.match(r.blockers.join(' '),/wymiarami/);
  i.cargo[0]={qty:1,length:200,width:400,height:100,weight:100};assert.equal(calculate(i).blockers.length,0); // rotated footprint fits
  i.cargo[0].qty=2;assert.match(calculate(i).blockers.join(' '),/podłogi/);
});
test('forwarding: received and rejected offers do not become an accepted purchase',()=>{
  const i=sample(),baseline=calculate(i);i.offers=[{carrier:'Firma A',price:400,status:'received'},{carrier:'Firma B',price:100,status:'rejected'}];
  assert.equal(calculate(i).buy,baseline.buy);i.offers[0].status='accepted';let r=calculate(i);assert.equal(r.buy,400);assert.equal(r.buySource,'accepted');assert.equal(r.sell,487.8);
  i.sellPrice=420;r=calculate(i);assert.equal(r.sell,420);assert.equal(r.maxBuy,369.6);assert.equal(r.overBudget,true);
  i.offers[1].status='accepted';assert.throws(()=>calculate(i),/jedną ofertę/);
});
test('forwarding: invalid and missing numbers, dates and data shapes fail explicitly',()=>{
  const mutations=[i=>i.cargo[0].weight='',i=>i.cargo[0].qty=1.5,i=>i.vehicle.height=0,i=>i.vehicle.payload=4000,i=>i.route.distanceKm=-1,i=>i.route.distanceKm=true,i=>i.assumptions.targetMargin=100,i=>i.assumptions.minimumMargin=30,i=>i.pickup='2026-02-30',i=>i.delivery='2026-01-01',i=>i.cargo=[null],i=>i.offers=[null],i=>i.profile='__proto__'];
  for(const change of mutations){const i=sample();change(i);assert.throws(()=>normalizeInput(i),ForwardingError);}
});
test('forwarding: customer export has no carrier buy, profit or internal rates and requires review',()=>{
  const i=sample();i.sellPrice=999;i.offers=[{carrier:'SECRET CARRIER',price:345,status:'accepted'}];const text=customerOffer(calculate(i));
  assert.match(text,/999.00 EUR netto/);assert.doesNotMatch(text,/345|SECRET|marża|narzut|EUR\/km|Zakup/);
  i.reviewed=false;assert.throws(()=>customerOffer(calculate(i)),ForwardingError);i.reviewed=true;i.pickup='';assert.equal(calculate(i).ready,false);
});
test('forwarding: enquiry parser keeps unknown quantity, aggregate weight and missing addresses unresolved',()=>{
  const p=parseEnquiry('Załadunek: PL 60-101 Poznań\nRozładunek: DE Berlin\n2 x 120x80x150 cm, 200 kg/szt.');
  assert.equal(p.origin,'PL 60-101 Poznań');assert.equal(p.cargo[0].qty,'2');assert.equal(p.cargo[0].weight,'200');
  const unknown=parseEnquiry('120x80x150 cm, waga 500 kg');assert.equal(unknown.cargo[0].qty,'');assert.equal(unknown.cargo[0].weight,'');assert.equal(unknown.origin,'');
});
test('forwarding: JSON round trip reproduces calculated historical prices',()=>{
  const r=calculate(sample()),next=calculate(JSON.parse(JSON.stringify(r.input)));assert.equal(next.buy,r.buy);assert.equal(next.sell,r.sell);assert.equal(next.margin,r.margin);
});
test('forwarding: accepted quote cannot use unconfirmed changed shipment conditions',()=>{
  const i=sample();i.offers=[{carrier:'Test',price:200,status:'accepted',needsConfirmation:true}];assert.throws(()=>calculate(i),/ponownie potwierdź/);
});
test('currency: old snapshots remain EUR, PLN requires an explicit positive manual rate',()=>{
  assert.equal(calculate(sample()).currency,'EUR');assert.equal(calculate(sample()).eurPln,null);
  for(const rate of ['',null,0,-4,Infinity,true,'oops',4.12345])assert.throws(()=>calculate({...sample(),currency:'PLN',eurPln:rate}),ForwardingError);
  assert.throws(()=>calculate({...sample(),currency:'USD',eurPln:4.3}),/walutę/);
  assert.equal(calculate({...sample(),currency:'PLN',eurPln:'4,3000'}).input.fxSource,'manual');
});
test('currency: all monetary assumptions, purchase and sell convert while quantities and margins stay consistent',()=>{
  const eur=sample();eur.offers=[{carrier:'Test',price:200,status:'accepted'}];eur.sellPrice=250;
  const baseline=calculate(eur),pln=structuredClone(eur);pln.currency='PLN';pln.eurPln=4.3;
  for(const key of MONEY_ASSUMPTIONS)pln.assumptions[key]=convertMoney(pln.assumptions[key],'EUR','PLN',4.3);
  pln.offers[0].price=860;pln.sellPrice=1075;
  const r=calculate(pln);assert.equal(r.buy,860);assert.equal(r.sell,1075);assert.equal(r.profit,215);assert.equal(r.margin,baseline.margin);assert.equal(r.maxBuy,946);assert.equal(r.summary.weight,baseline.summary.weight);assert.equal(r.drivingHours,baseline.drivingHours);
  assert.ok(Math.abs(r.costs.operating-baseline.costs.operating*4.3)<.03);
  assert.equal(convertMoney(4300,'PLN','EUR',4.3),1000);assert.equal(convertMoney(4300,'PLN','PLN',null),4300);
  assert.throws(()=>convertMoney(100,'EUR','PLN',0),ForwardingError);
});
test('currency: native PLN offers stay fixed when the rate changes; snapshot restores its own rate',()=>{
  const i={...sample(),currency:'PLN',eurPln:4.3,sellPrice:1000,offers:[{carrier:'Test',price:800,status:'accepted'}]};
  const first=calculate(i),saved=JSON.parse(JSON.stringify(first.input));i.eurPln=4.6;
  const changed=calculate(i);assert.equal(changed.sell,1000);assert.equal(changed.buy,800);assert.equal(changed.margin,20);
  const restored=calculate(saved);assert.equal(restored.eurPln,4.3);assert.equal(restored.sell,first.sell);assert.equal(restored.margin,first.margin);
  assert.match(customerOffer(restored),/1000.00 PLN netto/);assert.doesNotMatch(customerOffer(restored),/EUR netto|800.00|marża/);
});
test('currency: NBP rate validates, caches and deduplicates concurrent requests',async()=>{
  let calls=0;let now=1000;const service=createExchangeRateService({now:()=>now,fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify({table:'A',code:'EUR',rates:[{no:'199/A/NBP/2026',effectiveDate:'2026-10-02',mid:4.2711}]}),{status:200});}});
  const [a,b]=await Promise.all([service(),service()]);assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(a.fxSource,'NBP');assert.equal(a.eurPln,4.2711);now+=299999;await service();assert.equal(calls,1);now+=2;await service();assert.equal(calls,2);
});
test('currency: malformed NBP response and timeout fail without caching',async()=>{
  const bad=createExchangeRateService({fetchImpl:async()=>new Response(JSON.stringify({table:'B'}),{status:200})});await assert.rejects(bad,/Invalid NBP/);
  let aborted=false;const slow=createExchangeRateService({timeoutMs:5,fetchImpl:async(_url,{signal})=>{signal.addEventListener('abort',()=>aborted=true);await new Promise(r=>setTimeout(r,20));return new Response('{}');}});await assert.rejects(slow,/timeout/);assert.equal(aborted,true);
});
