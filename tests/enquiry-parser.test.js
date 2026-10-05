import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEnquiryParser,inputContent,normalizeExtraction} from '../lib/enquiry-parser.js';
import {extracted,png} from './enquiry-fixture.mjs';
const response=(value=extracted)=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}));
test('import: aggregate weights divided once; unknown weights and quantity remain missing',()=>{
  const raw=structuredClone(extracted),parsed=normalizeExtraction(raw);assert.equal(parsed.cargo[0].weight,200);assert.match(parsed.warnings.join(' '),/600 kg łącznie \/ 3 szt/);assert.equal(raw.cargo[0].weight,600);assert.equal(parsed.cargo[0].stackable,false);
  raw.cargo[0].qty=null;assert.equal(normalizeExtraction(raw).cargo[0].weight,null);
  raw.cargo[0].qty=3;raw.cargo[0].weightBasis='unknown';assert.equal(normalizeExtraction(raw).cargo[0].weight,null);
  raw.cargo[0].weightBasis='per_piece';assert.equal(normalizeExtraction(raw).cargo[0].weight,600);
});
test('import: invalid dates, incomplete dimensions and multiple stops cannot become a complete import',()=>{
  const raw=structuredClone(extracted);raw.pickup='2026-02-30';raw.cargo[0].height=null;raw.scope='multiple';const result=normalizeExtraction(raw);
  assert.equal(result.pickup,null);assert.equal(result.cargo[0].height,null);assert.equal(result.scope,'multiple');assert.match(result.warnings.join(' '),/kilka zleceń/);assert.match(result.warnings.join(' '),/wysokość/);
  for(const value of [{...raw,cargo:null},{...raw,extra:1},{...raw,cargo:[{...raw.cargo[0],qty:1.5}]},{...raw,cargo:[{...raw.cargo[0],weight:-1}]}])assert.throws(()=>normalizeExtraction(value),{status:502});
});
test('import: file type, signature, base64, size, mixed PDF and empty input validated before API request',()=>{
  assert.equal(inputContent({files:[{data:png}]})[0].type,'input_image');
  const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.7\nfixture').toString('base64');assert.equal(inputContent({files:[{data:pdf}]})[0].filename,'zlecenie.pdf');
  for(const body of [{},{text:'a'.repeat(20001)},{files:[{data:'https://example.com/image.png'}]},{files:[{data:png.replace('image/png','image/jpeg')}]},{files:[{data:pdf},{data:png}]},{files:[{data:png},{data:png},{data:png},{data:png}]}])assert.throws(()=>inputContent(body));
  const large=Buffer.alloc(6*1024*1024);Buffer.from([137,80,78,71,13,10,26,10]).copy(large);
  assert.throws(()=>inputContent({files:[{data:'data:image/png;base64,'+large.toString('base64')},{data:png}]}));
});
test('import: authenticated structured request has no tools, no storage and handles text, images, PDF',async()=>{
  const calls=[];const parser=createEnquiryParser({apiKey:'fixture-secret',fetchImpl:async(url,options)=>{calls.push({url,options});return response();}});
  for(const body of [{text:'zlecenie'},{files:[{data:png}]},{files:[{data:'data:application/pdf;base64,'+Buffer.from('%PDF-fixture').toString('base64')}]}])assert.equal((await parser(body)).cargo[0].weight,200);
  const body=JSON.parse(calls[0].options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.tools,undefined);assert.equal(body.input[0].content[0].type,'input_text');assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.ok(!JSON.stringify(body).includes('fixture-secret'));
});
test('import: no key, provider error, refusal, incomplete JSON and timeout fail without leaking content',async()=>{
  await assert.rejects(createEnquiryParser({apiKey:'',fetchImpl:()=>{throw Error('must not call');}})({text:'test'}),{status:503});
  for(const value of [new Response('private-provider-error',{status:401}),new Response(JSON.stringify({status:'completed',output:[{content:[{type:'refusal',refusal:'secret'}]}]})),new Response(JSON.stringify({status:'incomplete',output:[]})),new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:'bad-json-secret'}]}]}))]){
    await assert.rejects(createEnquiryParser({apiKey:'key',fetchImpl:async()=>value})({text:'test'}),e=>!e.message.includes('secret')&&!e.message.includes('private-provider'));
  }
  await assert.rejects(createEnquiryParser({apiKey:'key',fetchImpl:async()=>{throw new DOMException('private','TimeoutError');}})({text:'test'}),/zbyt długo/);
});
