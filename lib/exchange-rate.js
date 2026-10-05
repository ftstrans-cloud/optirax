// NBP table A, latest publication (also works on weekends / before today's publication).
// Documentation: https://api.nbp.pl/
export function createExchangeRateService({fetchImpl=globalThis.fetch,now=()=>Date.now(),ttlMs=300000,timeoutMs=6000}={}) {
  let cache=null,pending=null;
  return async function getRate(){
    if(cache && now()-cache.timestamp<ttlMs)return {...cache.value};
    if(pending)return {...await pending};
    pending=(async()=>{
      const controller=new AbortController();
      let timer;
      try {
        return await Promise.race([(async()=>{
          const response=await fetchImpl('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json',{headers:{Accept:'application/json'},signal:controller.signal});
          if(!response.ok)throw Error('NBP unavailable');
          const data=await response.json(),r=data?.rates?.[0];
          if(data?.table!=='A'||data?.code!=='EUR'||data?.rates?.length!==1||typeof r?.mid!=='number'||!Number.isFinite(r.mid)||r.mid<0.01||r.mid>100||Math.abs(r.mid*10000-Math.round(r.mid*10000))>1e-7||!/^\d{4}-\d{2}-\d{2}$/.test(r.effectiveDate||'')||!Number.isFinite(Date.parse(r.effectiveDate))||new Date(r.effectiveDate).toISOString().slice(0,10)!==r.effectiveDate||!/^\d{1,3}\/A\/NBP\/\d{4}$/.test(r.no||''))throw Error('Invalid NBP response');
          const timestamp=now(),value={eurPln:r.mid,fxSource:'NBP',fxDate:r.effectiveDate,fxTable:r.no,fetchedAt:new Date(timestamp).toISOString()};
          if(controller.signal.aborted)throw Error('NBP timeout');
          cache={timestamp,value};return value;
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('NBP timeout'));},timeoutMs);})]);
      } finally {clearTimeout(timer);}
    })();
    try{return {...await pending};}finally{pending=null;}
  };
}
