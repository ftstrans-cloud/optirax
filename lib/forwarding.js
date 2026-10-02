import { randomUUID } from 'node:crypto';
import { calculate, ForwardingError } from '../public/forwarding-engine.js';

// Reuses existing JSON columns, with separate lists and no schema migration.
export const CARRIER_QUOTE_FILTER = '&or=(input->>module.is.null,input->>module.neq.forwarding)';
export function registerForwarding(app, {requireAuth, requireActiveSubscription, sbFetch, buildQuoteRow}) {
  const auth=[requireAuth,requireActiveSubscription];
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
      const item={id:randomUUID(),ts:Date.now(),name:input.reference||'Wycena spedycyjna',client:input.client,note:input.notes,
        route:{origin:input.route.origin,destination:input.route.destination,stops:[]},input,
        calc:{distance_km:input.route.distanceKm,duration_h:result.drivingHours,total_cost_eur:result.buy,
          price_eur:result.sell,margin_eur:result.profit,margin_pct:result.margin,forwarding:snapshot},
      };
      const row=buildQuoteRow(item,req.userId);
      const saved=await sbFetch('quotes','POST',row);
      res.status(201).json(saved?.[0]||row);
    } catch(e) {
      res.status(e instanceof ForwardingError?400:503).json({error:e instanceof ForwardingError?e.message:'Nie zapisano wyceny. Sprawdź połączenie i spróbuj ponownie.'});
    }
  });
}
