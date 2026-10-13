import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerForwarding} from '../lib/forwarding.js';
import {PROFILES} from '../public/forwarding-engine.js';

test('API: PLN can be saved without FX; legacy EUR columns never receive PLN amounts',async()=>{
  const app=express(),writes=[];app.use(express.json());
  registerForwarding(app,{
    requireAuth:(req,res,next)=>{req.userId='fixture';next();},requireActiveSubscription:(req,res,next)=>next(),
    sbFetch:async(table,method,row)=>{if(method==='POST'){writes.push(row);return [row];}return writes;},
    buildQuoteRow:(item,user)=>({...item,auth_user_id:user,total_cost:item.calc.total_cost_eur,price_eur:item.calc.price_eur,margin_eur:item.calc.margin_eur}),
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const input={currency:'PLN',useCostModel:false,profile:'bus',mode:'dedicated',vehicle:PROFILES.bus,
      assumptions:{targetMargin:20,minimumMargin:10},route:{origin:'Poznań',destination:'Berlin',distanceKm:300},
      cargo:[{qty:1,length:120,width:80,height:100,weight:200}],offers:[{carrier:'Test',price:1000,status:'accepted'}]};
    const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/forwarding/quotes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let response=await post(input);assert.equal(response.status,201);
    let row=await response.json();assert.equal(row.input.currency,'PLN');assert.equal(row.input.eurPln,null);
    assert.equal(row.calc.forwarding.buy,1000);assert.equal(row.calc.forwarding.sell,1250);assert.equal(row.calc.forwarding.margin,20);
    assert.equal(row.price_eur,null);assert.equal(row.total_cost,null);assert.equal(row.margin_eur,null);
    response=await post({...input,showEur:true,eurPln:5});assert.equal(response.status,201);row=await response.json();
    assert.equal(row.calc.forwarding.sell,1250);assert.equal(row.price_eur,250);assert.equal(row.total_cost,200);assert.equal(row.margin_eur,50);
    assert.equal((await post({...input,eurPln:0})).status,400);
    assert.equal(writes.length,2);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
