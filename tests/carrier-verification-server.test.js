import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';

test('Production Express wiring: authenticated large document uploads bypass only the default small JSON parser',async t=>{
  const child=fork(new URL('../server.js',import.meta.url),[],{cwd:new URL('..',import.meta.url),execArgv:['--import',new URL('./server-fixture.mjs',import.meta.url).pathname],env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:'0',OPENAI_API_KEY:'test-parser-key',SUPABASE_URL:'https://test.supabase.invalid',SUPABASE_SERVICE_KEY:'test-supabase-key'},stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.resume();child.stderr.resume();t.after(()=>child.kill());
  const [{port}]=await once(child,'message',{signal:AbortSignal.timeout(10000)}),base=`http://127.0.0.1:${port}`;
  const post=(path,body,token='pro-user')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:''},body:JSON.stringify(body)});
  const file={name:'synthetic.pdf',data:'data:application/pdf;base64,'+Buffer.from('%PDF-1.7\n'+'x'.repeat(1500000)).toString('base64')};
  const body={context:{carrier:'Example Transport',operation:'domestic',adr:false,currency:'PLN'},files:[file]};
  assert.equal((await post('/api/forwarding/verify-carrier',body,'')).status,401);
  assert.equal((await post('/api/forwarding/verify-carrier',body,'inactive')).status,403);
  const response=await post('/api/forwarding/verify-carrier',body);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const report=await response.json();assert.equal(report.status,'unknown');assert.equal(report.externalVerification.status,'not_checked');
  assert.equal((await post('/api/forwarding/parse',{files:[file]})).status,200);
  assert.equal((await post('/api/forwarding/parse',{files:[file]},'')).status,401);
  assert.equal((await post('/api/forwarding/quotes',{padding:'x'.repeat(1500000)})).status,413);
  assert.equal((await post('/api/forwarding/verify-carrier',{...body,files:[{name:'bad.pdf',data:'not a PDF'}]})).status,400);
});
