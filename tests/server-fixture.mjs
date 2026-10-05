// Test-only preload. No external request is allowed; never use this in production.
import http from 'node:http';
import {extracted,carrierOffers} from './enquiry-fixture.mjs';
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once('listening', () => process.send?.({port:this.address().port}));
  return listen.call(this, 0, '127.0.0.1', ...args.filter(a=>typeof a==='function'));
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const quotes=[{id:'legacy-carrier',auth_user_id:'pro-user',input:null,is_draft:false,ts:1},{id:'foreign-forwarding',auth_user_id:'other-user',input:{module:'forwarding'},is_draft:false,ts:2}];
globalThis.fetch=async (input,options={})=>{
  const url=new URL(input);
  if(url.href==='https://api.openai.com/v1/chat/completions'){
    const body=JSON.parse(options.body);
    if(body.messages[1].content.length!==4000||body.messages[0].content.includes('PLN÷4.3'))throw Error('Legacy parser truncated text or used fixed FX');
    return json({choices:[{message:{content:JSON.stringify({origin:'Poznań',destination:'Berlin',stops:[],offer_price_eur:999,offer_price_original:1800,offer_currency:'PLN',vehicle_type:null,is_reefer:false,adr:false,load_date:null,cargo:null})}}]});
  }
  if(url.href==='https://api.openai.com/v1/responses'){
    if(options.headers.Authorization!=='Bearer test-parser-key')throw Error('Missing test parser key');
    const body=JSON.parse(options.body);
    if(body.store!==false||!body.text?.format?.strict||body.tools)throw Error('Invalid parser request');
    return json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(body.text.format.name==='carrier_offers'?carrierOffers:extracted)}]}]});
  }
  if(url.hostname==='test.supabase.invalid') {
    if(url.pathname==='/auth/v1/user') return json({id:['trial-exhausted','other-user','inactive'].find(id=>options.headers.Authorization.endsWith(id))||'pro-user',email:'test@example.invalid',user_metadata:{first_route_at:'test'}});
    if(url.pathname==='/rest/v1/profiles') return json([{plan:url.search.includes('trial-exhausted')?'trial':'pro',is_active:!url.search.includes('inactive'),daily_calc_count:10,daily_calc_date:new Date().toISOString().slice(0,10)}]);
    if(url.pathname==='/rest/v1/quotes') {
      if(options.method==='POST'){const row=JSON.parse(options.body);quotes.push(row);return json([row]);}
      const q=url.searchParams,uid=q.get('auth_user_id');
      if(!uid?.startsWith('eq.'))throw Error('Unscoped quotes query');
      let rows=quotes.filter(r=>r.auth_user_id===uid.slice(3));
      if(q.get('input->>module')==='eq.forwarding')rows=rows.filter(r=>r.input?.module==='forwarding');
      else if(q.get('or')==='(input->>module.is.null,input->>module.neq.forwarding)')rows=rows.filter(r=>r.input?.module!=='forwarding');
      else throw Error('Missing module separation');
      return json(rows);
    }
    throw Error('Unexpected Supabase test request');
  }
  if(url.hostname==='api.tomtom.com') {
    if(url.pathname.includes('/10.403,')) return json({error:'sensitive-provider-payload'},403);
    const make=cost=>({summary:{lengthInMeters:200000,travelTimeInSeconds:9000},legs:[{points:[{latitude:52,longitude:21},{latitude:51,longitude:14},{latitude:50,longitude:10}]}],progress:[{pointIndex:0,distanceInMeters:0},{pointIndex:1,distanceInMeters:100000},{pointIndex:2,distanceInMeters:200000}],sections:[{sectionType:'COUNTRY',startPointIndex:0,endPointIndex:2,countryCode:'DEU'},...(cost?[{sectionType:'TOLL_ROAD',startPointIndex:0,endPointIndex:1}]:[])]});
    return json({routes:[make(true),make(false)]});
  }
  if(url.hostname==='router.project-osrm.org') return json({routes:[{distance:250000,duration:10000,geometry:{type:'LineString',coordinates:[[21,52],[14,51]]}}]});
  if(url.hostname==='api.nbp.pl') return json({table:'A',currency:'euro',code:'EUR',rates:[{no:'199/A/NBP/2026',effectiveDate:'2026-10-02',mid:4.2711}]});
  throw Error('External network disabled in tests: unexpected host');
};
