import { randomUUID } from 'node:crypto';
import { calculate, convertMoney, ForwardingError } from '../public/forwarding-engine.js';
import { createExchangeRateService } from './exchange-rate.js';
import express from 'express';
import {createEnquiryParser,ImportError} from './enquiry-parser.js';

// Reuses existing JSON columns, with separate lists and no schema migration.
export const CARRIER_QUOTE_FILTER = '&or=(input->>module.is.null,input->>module.neq.forwarding)';
export function registerForwarding(app, {requireAuth, requireActiveSubscription, sbFetch, buildQuoteRow}) {
  const auth=[requireAuth,requireActiveSubscription];
  const getRate=createExchangeRateService();
  const parseEnquiry=createEnquiryParser(),imports=new Map();
  const importBody=express.json({limit:'9mb'});
  app.post('/api/forwarding/parse', ...auth, (req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!req.userPlan)return res.status(503).json({error:'Nie można potwierdzić aktywności konta. Spróbuj ponownie.'});
    const now=Date.now();
    for(const [key,value]of imports)if(!value.active&&value.until<now)imports.delete(key);
    const state=imports.get(req.userId)||{count:0,until:now+60000,active:false};
    if(state.until<now){state.count=0;state.until=now+60000;}
    if(state.active||state.count>=10)return res.status(429).json({error:'Trwa odczyt lub wykorzystano 10 odczytów na minutę. Poczekaj chwilę.'});
    state.active=true;state.count++;imports.set(req.userId,state);
    res.once('finish',()=>{state.active=false;});res.once('close',()=>{state.active=false;});
    importBody(req,res,error=>error?res.status(error.type==='entity.too.large'?413:400).json({error:'Nieprawidłowe dane. Maksymalnie 6 MB plików i 20 000 znaków tekstu.'}):next());
  },async(req,res)=>{
    try{res.json(await parseEnquiry(req.body));}
    catch(e){res.status(e instanceof ImportError?e.status:503).json({error:e instanceof ImportError?e.message:'Nie udało się odczytać zapytania.'});}
  });
  app.get('/api/forwarding/exchange-rate', ...auth, async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {res.json(await getRate());}
    catch {res.status(503).json({error:'Nie udało się pobrać kursu NBP. Dotychczasowy kurs pozostaje bez zmian. Możesz wpisać kurs ręcznie lub spróbować ponownie.'});}
  });
  app.get('/api/forwarding/quotes', ...auth, async(req,res)=>{
    try {
      const rows=await sbFetch('quotes','GET',null,`?auth_user_id=eq.${encodeURIComponent(req.userId)}&input->>module=eq.forwarding&is_draft=eq.false&order=ts.desc&limit=200`);
      res.json(rows||[]);
    } catch { res.status(503).json({error:'Nie udało się pobrać historii spedycji. Spróbuj ponownie.'}); }
  });
  app.post('/api/forwarding/quotes', ...auth, async(req,res)=>{
    try {
      const result=calculate(req.body), input=result.input;
      const {input:ignored,...snapshot}=result;
      // Existing database columns retain their EUR contract. Snapshot/input retain quote currency.
      const inEur=value=>Math.round(convertMoney(value,input.currency,'EUR',input.eurPln)*100)/100;
      const item={id:randomUUID(),ts:Date.now(),name:input.reference||'Wycena spedycyjna',client:input.client,note:input.notes,
        route:{origin:input.route.origin,destination:input.route.destination,stops:[]},input,
        calc:{distance_km:input.route.distanceKm,duration_h:result.drivingHours,total_cost_eur:inEur(result.buy),
          price_eur:inEur(result.sell),margin_eur:inEur(result.profit),margin_pct:result.margin,forwarding:snapshot},
      };
      const row=buildQuoteRow(item,req.userId);
      const saved=await sbFetch('quotes','POST',row);
      res.status(201).json(saved?.[0]||row);
    } catch(e) {
      res.status(e instanceof ForwardingError?400:503).json({error:e instanceof ForwardingError?e.message:'Nie zapisano wyceny. Sprawdź połączenie i spróbuj ponownie.'});
    }
  });
}
