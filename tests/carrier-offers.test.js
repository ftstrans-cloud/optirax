import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOffers,createEnquiryParser} from '../lib/enquiry-parser.js';
import {prepareOffers,renderOfferPreview} from '../public/carrier-offer-import.js';
import {carrierOffers} from './enquiry-fixture.mjs';
import {calculate,PROFILES,DEFAULT_ASSUMPTIONS,customerOffer} from '../public/forwarding-engine.js';
const edits=carrierOffers.offers.map((o,index)=>({index,...o}));
test('offers: own schema, currencies and ambiguous VAT preserved; no implicit conversion in AI',async()=>{
 const raw=structuredClone(carrierOffers);raw.offers[1].taxBasis='unknown';raw.offers[1].currency=null;assert.equal(normalizeOffers(raw).offers[1].currency,null);
 let sent;const parse=createEnquiryParser({apiKey:'fixture',fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}]}));}});
 assert.equal((await parse({kind:'offers',text:'test'})).offers.length,2);assert.equal(sent.text.format.name,'carrier_offers');assert.match(sent.instructions,/nie przeliczaj walut/);
 assert.throws(()=>normalizeOffers({...raw,offers:[{...raw.offers[0],amount:-10}]}));
});
test('offers: selected net prices use explicit EUR/PLN rate, preserve source, never auto-accept',()=>{
 const results=prepareOffers(edits,carrierOffers.offers,{currency:'EUR',eurPln:4.5});assert.equal(results[0].price,450);assert.equal(results[1].price,400);assert.equal(results[1].needsConfirmation,true);assert.equal(results[1].status,'received');assert.match(results[1].importSource,/1800 PLN/);assert.match(results[1].importSource,/4.5 PLN/);
 for(const edit of [{...edits[0],taxBasis:'gross'},{...edits[0],taxBasis:'unknown'},{...edits[0],currency:null},{...edits[0],amount:''},{...edits[0],carrier:''},{...edits[0],currency:'GBP'}])assert.throws(()=>prepareOffers([edit],carrierOffers.offers,{currency:'EUR',eurPln:4.5}));
 assert.throws(()=>prepareOffers(edits,carrierOffers.offers,{currency:'EUR',eurPln:''}));assert.throws(()=>prepareOffers(edits,carrierOffers.offers,{currency:'EUR',eurPln:4.5,existingCount:49}));
});
test('offers: missing route, mismatched dates and no tail lift remain visible; source is escaped',()=>{
 const data=normalizeOffers(carrierOffers);data.offers[0].carrier='<img src=x onerror=alert(1)>';const html=renderOfferPreview(data,{origin:'PL 60-101 Poznań',destination:'DE 10115 Berlin',pickup:'2026-10-12',delivery:'2026-10-13',tailLift:true});assert.match(html,/NIEZGODNOŚĆ/);assert.match(html,/Brak pełnej trasy/);assert.match(html,/terminów różni/);assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;img/);
});
test('offers: source and conditions survive saved snapshots but do not leak into customer offer',()=>{
 const input={profile:'bus',mode:'dedicated',currency:'EUR',eurPln:4.5,route:{origin:'Poznań',destination:'Berlin',distanceKm:300},vehicle:PROFILES.bus,assumptions:DEFAULT_ASSUMPTIONS,cargo:[{qty:1,length:120,width:80,height:100,weight:100}],pickup:'2026-10-10',delivery:'2026-10-11',reviewed:true,offers:prepareOffers(edits,carrierOffers.offers,{currency:'EUR',eurPln:4.5})};
 const result=calculate(input),again=calculate(JSON.parse(JSON.stringify(result.input)));assert.equal(again.input.offers[1].importSource,result.input.offers[1].importSource);assert.equal(again.input.offers[1].terms,'Bez windy.');assert.ok(!customerOffer(result).includes('Firma B'));assert.ok(!customerOffer(result).includes('Kwota w źródle'));
 assert.throws(()=>calculate({...input,offers:[{...input.offers[0],status:'accepted'}]}));
});
