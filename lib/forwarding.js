import { randomUUID } from 'node:crypto';
import { calculate, convertMoney, ForwardingError } from '../public/forwarding-engine.js';
import { createExchangeRateService } from './exchange-rate.js';

// Reuses existing JSON columns, with separate lists and no schema migration.
export const CARRIER_QUOTE_FILTER = '&or=(input->>module.is.null,input->>module.neq.forwarding)';
export function registerForwarding(app, {requireAuth, requireActiveSubscription, sbFetch, buildQuoteRow}) {
  const auth=[requireAuth,requireActiveSubscription];
  const getRate=createExchangeRateService();
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
