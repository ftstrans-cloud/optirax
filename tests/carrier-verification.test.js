import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {verificationInput,verificationContext,evaluateVerification,createCarrierVerifier,registerCarrierVerification} from '../lib/carrier-verification.js';

// Synthetic evidence only; no customer documents or identifiers are committed.
const ev=(quote='Polisa TEST, Example Transport, PL1111111111',file=1)=>({file,page:1,quote});
export const context=()=>({carrier:'Example Transport',taxId:'PL1111111111',pickup:'2026-10-14',delivery:'2026-10-15',countries:'Polska',operation:'domestic',cargo:'Meble drewniane',value:20000,currency:'EUR',registration:'XX 12345',temperature:'',adr:false,reference:'TEST',origin:'Poznań',destination:'Warszawa',notes:''});
export const extraction=()=>({documents:[
  {file:1,kind:'policy',companyName:'Example Transport',companyId:'PL1111111111',number:'TEST/1',parentPolicyNumber:null,validFrom:'2026-01-01',validTo:'2026-12-31',evidence:[ev('Polisa TEST/1, Example Transport, PL1111111111, od 01.01.2026 do 31.12.2026')],summary:'Polisa testowa'},
  {file:2,kind:'license',companyName:'Example Transport',companyId:null,number:'TU-TEST',parentPolicyNumber:null,validFrom:'2024-01-01',validTo:'2029-01-01',evidence:[ev('Example Transport, licencja TU-TEST, 01.01.2024 – 01.01.2029',2)],summary:'Licencja testowa'},
  {file:3,kind:'owu',companyName:null,companyId:null,number:'OWU/TEST',parentPolicyNumber:null,validFrom:null,validTo:null,evidence:[ev('OWU TEST',3)],summary:'Pełne OWU testowe'},
],checks:Object.fromEntries(['identity','territory','operation','cargo','owu','endorsements','vehicle'].map(k=>[k,{state:'match',detail:'Zgodne według przykładowego zapisu.',evidence:[ev()]}])),limits:[{label:'Kraj',amount:100000,currency:'EUR',basis:'both',applicable:'yes',evidence:[ev('Suma krajowa: 100000 EUR na jedno i wszystkie zdarzenia')]}],deductibles:[{description:'Franszyza podstawowa 200 EUR',evidence:[ev('Franszyza: 200 EUR')]}],warnings:[]});
const names=['polisa.pdf','licencja.pdf','owu.pdf'];
const evaluate=(raw=extraction(),c=context())=>evaluateVerification(raw,c,names,new Date('2026-10-14T20:00:00Z'));
const pdf=n=>'data:application/pdf;base64,'+Buffer.from('%PDF-1.7\n'+'x'.repeat(n)).toString('base64');

test('Complete synthetic document checks are scoped; deductibles do not block; external status is never verified',()=>{
  const r=evaluate();assert.equal(r.status,'ok');assert.equal(r.externalVerification.status,'not_checked');assert.equal(r.deductibles.length,1);assert(r.checks.filter(c=>c.id==='dates').every(c=>c.status==='ok'));
});
test('Expired policies are red for current transport but not for a covered historical transport',()=>{
  const raw=extraction(),p=raw.documents[0];p.validFrom='2025-10-03';p.validTo='2026-10-02';p.evidence=[ev('03.10.2025 – 02.10.2026')];
  assert.equal(evaluate(raw).status,'red');assert.equal(evaluate(raw,{...context(),pickup:'2026-09-01',delivery:'2026-09-02'}).status,'warning');
});
test('Invalid, invented and unsupported dates cannot produce a pass',()=>{
  for(const date of ['2026-02-30','2028-01-01']){const r=extraction();r.documents[0].validTo=date;assert.equal(evaluate(r).status,'unknown');}
  const r=extraction();r.documents[0].evidence=[];assert.equal(evaluate(r).status,'unknown');
});
test('Mixed firms or a carrier ID different from the policy override an AI match',()=>{
  let r=extraction();r.documents[1].companyId='PL2222222222';assert.equal(evaluate(r).status,'red');
  assert.equal(evaluate(extraction(),{...context(),taxId:'PL2222222222'}).status,'red');
});
test('No OWU, missing dates/cargo value, ambiguous limits and different currencies never get green',()=>{
  let r=extraction();r.documents=r.documents.filter(d=>d.kind!=='owu');assert.equal(evaluate(r).status,'unknown');
  for(const change of [{value:null},{pickup:''},{cargo:''},{countries:''},{operation:'unknown'},{currency:'PLN'}])assert.equal(evaluate(extraction(),{...context(),...change}).status,'unknown');
  r=extraction();r.limits[0].basis='unknown';assert.equal(evaluate(r).status,'unknown');
});
test('Low applicable limit is red; unrelated limit does not block; empty provenance is unknown',()=>{
  const r=extraction();r.limits[0].amount=1000;assert.equal(evaluate(r).status,'red');
  r.limits[0].applicable='no';assert.equal(evaluate(r).status,'unknown');
  r.checks.cargo={state:'mismatch',detail:'Unproven',evidence:[ev('bad',8)]};assert.equal(evaluate(r).checks.find(c=>c.id==='cargo').status,'unknown');
});
test('Anecdotes, incomplete sets and multiple policies do not grant green',()=>{
  const r=extraction();r.documents.push({...r.documents[0],kind:'annex',parentPolicyNumber:'MISSING',number:'ANNEX'});assert.equal(evaluate(r).status,'unknown');
  r.documents.at(-1).kind='policy';assert.equal(evaluate(r).status,'unknown');
  r.documents=[];assert.equal(evaluate(r).status,'unknown');
});
test('Complete context and upload validation support multiple real-size PDFs but bound sizes and formats',()=>{
  assert.equal(verificationInput({context:context(),files:[{name:'polisa.pdf',data:pdf(16*1048576)},{name:'aneks.pdf',data:pdf(3*1048576)}]}).names.length,2);
  assert.throws(()=>verificationInput({context:context(),files:[{name:'bad.pdf',data:'data:application/pdf;base64,'+Buffer.from('fake').toString('base64')}]}));
  assert.throws(()=>verificationInput({context:context(),files:Array.from({length:9},()=>({name:'a',data:pdf(10)}))}));
  assert.throws(()=>verificationContext({...context(),delivery:'2026-10-01'}));assert.throws(()=>verificationContext({...context(),value:Infinity}));
});
test('AI endpoint enforces strict schema, no storage, and fail-closed refusals/errors',async()=>{
  const body={context:context(),files:[{name:'polisa.pdf',data:pdf(10)},{name:'licencja.pdf',data:pdf(10)},{name:'owu.pdf',data:pdf(10)}]};
  const verify=createCarrierVerifier({apiKey:'fixture',fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);assert.equal(payload.model,'gpt-4.1');
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(extraction())}]}]})};
  }});assert.equal((await verify(body)).status,'ok');
  for(const result of [{status:'incomplete',output:[]},{status:'completed',output:[{content:[{type:'refusal'}]}]},{status:'completed',output:[{content:[{type:'output_text',text:'{}'}]}]}]){
    const fail=createCarrierVerifier({apiKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>result})});await assert.rejects(()=>fail(body));
  }
});
test('Authenticated route accepts >1 MB and rejects unauthenticated, inactive, overlapping and excess requests',async()=>{
  const app=express();let calls=0,release;
  registerCarrierVerification(app,{requireAuth:(req,res,next)=>{if(req.headers.authorization!=='Bearer fixture')return res.sendStatus(401);req.userId='test';next();},requireActiveSubscription:(req,res,next)=>{if(req.headers['x-inactive'])return res.sendStatus(403);req.userPlan='pro';next();},verify:async body=>{calls++;if(body.hold)await new Promise(r=>release=r);return {ok:true};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/forwarding/verify-carrier`;
  const post=(body={},headers={Authorization:'Bearer fixture'})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try{
    assert.equal((await post({},{})).status,401);assert.equal((await post({},{Authorization:'Bearer fixture','x-inactive':'yes'})).status,403);
    let response=await post({data:'x'.repeat(2*1048576)});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const first=post({hold:true});while(!release)await new Promise(r=>setTimeout(r,10));assert.equal((await post()).status,429);release();assert.equal((await first).status,200);
    for(let i=0;i<10;i++)assert.equal((await post()).status,200);assert.equal((await post()).status,429);assert.equal(calls,12);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
