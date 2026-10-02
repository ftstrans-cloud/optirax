// Shared by browser and server. EUR net; explicit planning assumptions, not market tariffs.
export const ENGINE_VERSION = 'forwarding-1.0';
export const PROFILES = {
  bus: { name:'Bus plandeka 3,5 t', length:420, width:210, height:220, payload:900, grossWeightKg:3500, axleWeightKg:2000, lengthCm:690, widthCm:220, heightCm:320, axleCount:2, kmRate:0.38, hourRate:14 },
  solo75: { name:'Solo 7,5 t', length:600, width:245, height:240, payload:2500, grossWeightKg:7500, axleWeightKg:4500, lengthCm:820, widthCm:255, heightCm:350, axleCount:2, kmRate:0.55, hourRate:18 },
  solo12: { name:'Solo 12 t', length:720, width:245, height:260, payload:5000, grossWeightKg:12000, axleWeightKg:8000, lengthCm:940, widthCm:255, heightCm:380, axleCount:2, kmRate:0.68, hourRate:20 },
};
export const DEFAULT_ASSUMPTIONS = {
  kmRate:0.38, hourRate:14, deadheadKm:30, averageSpeed:65, fixed:25,
  tolls:0, crossing:0, extra:0, waitingHours:0, waitingRate:20,
  carrierMarkup:15, uncertainty:15, minimumBuy:90, minimumShare:30,
  targetMargin:18, minimumMargin:12,
};
export class ForwardingError extends Error {}
const fail = message => { throw new ForwardingError(message); };
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
function num(value, label, min=0, max=1e6, integer=false) {
  if (value === '' || value == null || typeof value === 'boolean' || !['string','number'].includes(typeof value)) fail(`Uzupełnij: ${label}.`);
  const n=Number(typeof value==='string'?value.replace(',','.'):value);
  if (!Number.isFinite(n) || n<min || n>max || (integer && !Number.isInteger(n))) fail(`Sprawdź pole: ${label} (${min}–${max}).`);
  return n;
}
function str(value, label, max=300, required=false) {
  if (value != null && typeof value!=='string') fail(`Sprawdź pole: ${label}.`);
  const s=(value||'').trim();
  if (s.length>max || (required&&!s)) fail(`Uzupełnij poprawnie: ${label} (maks. ${max} znaków).`);
  return s;
}
function date(value,label) {
  const s=str(value,label,10);
  if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10)!==s)) fail(`Sprawdź: ${label}.`);
  return s;
}
export function normalizeInput(raw) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail('Brak danych przesyłki.');
  const profile=Object.hasOwn(PROFILES,raw.profile)?PROFILES[raw.profile]:null;
  if (!profile) fail('Wybierz busa lub solo.');
  if (!['dedicated','partload'].includes(raw.mode)) fail('Wybierz sposób przewozu.');
  const v=raw.vehicle||{}, a=raw.assumptions||{}, r=raw.route||{};
  const vehicle={name:profile.name};
  for (const key of ['length','width','height','payload','grossWeightKg','axleWeightKg','lengthCm','widthCm','heightCm','axleCount']) {
    const limits={length:[100,1400],width:[100,300],height:[100,400],payload:[100,20000],grossWeightKg:[1000,40000],axleWeightKg:[500,20000],lengthCm:[200,2000],widthCm:[100,300],heightCm:[100,500],axleCount:[2,6]}[key];
    vehicle[key]=num(v[key],`parametr pojazdu ${key}`,...limits,key==='axleCount');
  }
  if (vehicle.payload>=vehicle.grossWeightKg || vehicle.axleWeightKg>vehicle.grossWeightKg) fail('Ładowność i nacisk osi muszą odpowiadać masie pojazdu.');
  if (vehicle.length>vehicle.lengthCm || vehicle.width>vehicle.widthCm || vehicle.height>vehicle.heightCm) fail('Wymiary ładowni nie mogą przekraczać wymiarów zewnętrznych auta.');
  const assumptions={};
  for (const key of Object.keys(DEFAULT_ASSUMPTIONS)) {
    const bounds={averageSpeed:[10,100],targetMargin:[0,80],minimumMargin:[0,80],uncertainty:[0,50],carrierMarkup:[0,100],minimumShare:[1,100],kmRate:[0,10],hourRate:[0,200],deadheadKm:[0,5000],waitingHours:[0,200]}[key]||[0,10000];
    assumptions[key]=num(a[key],`założenie ${key}`,...bounds);
  }
  if (!assumptions.kmRate && !assumptions.hourRate) fail('Koszt kilometra lub godziny musi być większy od zera.');
  if (assumptions.minimumMargin>assumptions.targetMargin) fail('Marża minimalna nie może przekraczać docelowej.');
  if (!Array.isArray(raw.cargo) || !raw.cargo.length || raw.cargo.length>30) fail('Dodaj od 1 do 30 pozycji ładunku.');
  if (raw.cargo.some(c=>!c||typeof c!=='object'||Array.isArray(c))) fail('Nieprawidłowa pozycja ładunku.');
  const cargo=raw.cargo.map((c,i)=>({
    qty:num(c.qty,`pozycja ${i+1}: liczba sztuk`,1,200,true),
    length:num(c.length,`pozycja ${i+1}: długość cm`,1,1400),
    width:num(c.width,`pozycja ${i+1}: szerokość cm`,1,400),
    height:num(c.height,`pozycja ${i+1}: wysokość cm`,1,450),
    weight:num(c.weight,`pozycja ${i+1}: kg/szt.`,0.1,20000),
    stackable:c.stackable===true,
  }));
  if (cargo.reduce((s,c)=>s+c.qty,0)>500) fail('Limit wynosi 500 sztuk w jednej wycenie.');
  const route={origin:str(r.origin,'załadunek',300,true),destination:str(r.destination,'rozładunek',300,true),
    distanceKm:num(r.distanceKm,'dystans km',1,20000),
    durationHours:r.durationHours===''||r.durationHours==null?null:num(r.durationHours,'czas jazdy h',0.01,500),
    source:r.source==='TomTom'?'TomTom':'manual',
  };
  const pickup=date(raw.pickup,'data załadunku'), delivery=date(raw.delivery,'data dostawy');
  if (pickup&&delivery&&delivery<pickup) fail('Dostawa nie może być przed załadunkiem.');
  if (raw.offers!=null && (!Array.isArray(raw.offers)||raw.offers.length>50)) fail('Limit wynosi 50 ofert przewoźników.');
  if ((raw.offers||[]).some(o=>!o||typeof o!=='object'||Array.isArray(o))) fail('Nieprawidłowa oferta przewoźnika.');
  const offers=(raw.offers||[]).map(o=>({carrier:str(o.carrier,'przewoźnik',120,true),price:num(o.price,'cena przewoźnika',0.01,1e6),status:['received','accepted','rejected'].includes(o.status)?o.status:fail('Nieprawidłowy status oferty.'),needsConfirmation:o.needsConfirmation===true}));
  if (offers.some(o=>o.status==='accepted'&&o.needsConfirmation)) fail('Po zmianie przesyłki ponownie potwierdź ofertę przewoźnika.');
  if (offers.filter(o=>o.status==='accepted').length>1) fail('Możesz przyjąć tylko jedną ofertę przewoźnika.');
  return {module:'forwarding',version:ENGINE_VERSION,profile:raw.profile,mode:raw.mode,vehicle,assumptions,cargo,route,pickup,delivery,
    client:str(raw.client,'klient',200),reference:str(raw.reference,'referencja',120),notes:str(raw.notes,'warunki przewozu',3000),
    tailLift:raw.tailLift===true,palletJack:raw.palletJack===true,reviewed:raw.reviewed===true,
    sellPrice:raw.sellPrice===''||raw.sellPrice==null?null:num(raw.sellPrice,'cena dla klienta',0.01,1e6),offers,
  };
}

export function calculate(raw) {
  const input=normalizeInput(raw),{vehicle:v,assumptions:a,cargo,route:r}=input;
  const summary=cargo.reduce((s,c)=>({pieces:s.pieces+c.qty,weight:s.weight+c.qty*c.weight,
    volume:s.volume+c.qty*c.length*c.width*c.height/1e6,area:s.area+c.qty*c.length*c.width/1e4}),{pieces:0,weight:0,volume:0,area:0});
  const shares={weight:summary.weight/v.payload,floor:summary.area/(v.length*v.width/1e4),volume:summary.volume/(v.length*v.width*v.height/1e6)};
  const blockers=[];
  if (shares.weight>1+1e-9) blockers.push('Przekroczona ładowność pojazdu.');
  if (shares.floor>1+1e-9) blockers.push('Przekroczona powierzchnia podłogi (liczona bez piętrowania).');
  if (shares.volume>1+1e-9) blockers.push('Przekroczona objętość ładowni.');
  cargo.forEach((c,i)=>{if (c.height>v.height || !((c.length<=v.length&&c.width<=v.width)||(c.width<=v.length&&c.length<=v.width))) blockers.push(`Pozycja ${i+1} nie mieści się wymiarami w ładowni.`);});
  const warnings=[
    'Stawki startowe są przykładowymi założeniami. Przed ofertowaniem dopasuj je do swoich zakupów.',
    'Waga, objętość i powierzchnia nie potwierdzają układu załadunku. Zweryfikuj drzwi, rozmieszczenie i mocowanie z przewoźnikiem.',
    'Myto, przeprawa i dopłaty wymagają ręcznego sprawdzenia dla konkretnego auta i trasy. Wartość 0 oznacza brak kosztu w modelu.',
    'Czas jazdy służy wyłącznie do modelu kosztowego. Termin dostawy wymaga osobnego potwierdzenia.',
  ];
  if (cargo.some(c=>c.stackable)) warnings.push('Piętrowalność zapisana informacyjnie. Cena i powierzchnia nadal liczone bez piętrowania.');
  if (r.source==='manual') warnings.push('Dystans wpisany ręcznie. Przebieg trasy nie został potwierdzony na mapie.');
  if (input.mode==='partload') warnings.push('Doładunek wymaga dostępnego auta na tej relacji i zgodnych terminów. Udział przestrzeni nie gwarantuje ceny ani dostępności.');
  const drivingHours=r.durationHours??r.distanceKm/a.averageSpeed;
  const linehaul=r.distanceKm*a.kmRate+drivingHours*a.hourRate+a.tolls+a.crossing;
  const shipmentCosts=a.deadheadKm*a.kmRate+(a.deadheadKm/a.averageSpeed)*a.hourRate+a.fixed+a.extra+a.waitingHours*a.waitingRate;
  const share=input.mode==='dedicated'?1:Math.max(a.minimumShare/100,shares.weight,shares.floor,shares.volume);
  const operatingCost=linehaul*share+shipmentCosts;
  const modelBuy=Math.max(a.minimumBuy,operatingCost*(1+a.carrierMarkup/100));
  const low=Math.max(a.minimumBuy,modelBuy*(1-a.uncertainty/100)), high=modelBuy*(1+a.uncertainty/100);
  const accepted=input.offers.find(o=>o.status==='accepted');
  const buy=accepted?accepted.price:modelBuy;
  const suggestedSell=round(buy/(1-a.targetMargin/100));
  const sell=input.sellPrice??suggestedSell;
  const profit=sell-buy,margin=profit/sell*100,maxBuy=sell*(1-a.minimumMargin/100);
  return {version:ENGINE_VERSION,input,summary:{...summary,ldm:summary.area/2.4},shares,blockers,warnings,drivingHours,share,
    costs:{linehaul:round(linehaul),shipment:round(shipmentCosts),operating:round(operatingCost)},
    modelBuy:round(modelBuy),low:round(low),high:round(high),opening:round(low),buy:round(buy),buySource:accepted?'accepted':'model',
    suggestedSell,sell:round(sell),profit:round(profit),margin:round(margin),maxBuy:round(maxBuy),
    overBudget:buy>maxBuy+0.005,ready:!blockers.length&&input.reviewed&&!!input.pickup&&!!input.delivery,
  };
}

// Deliberately conservative offline extraction: ambiguous weights/dates stay empty.
export function parseEnquiry(text) {
  const raw=str(text,'treść zapytania',12000,true);
  const read=labels=>raw.match(new RegExp(`^(?:${labels})\\s*:\\s*(.+)$`,'im'))?.[1]?.trim()||'';
  const cargo=[];
  for (const line of raw.split('\n')) {
    const m=line.match(/(?:(\d+)\s*(?:szt\.?|pal(?:et(?:y|a)?)?\.?|x|×)\s*)?(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*cm\b/i);
    if (!m) continue;
    const weight=line.match(/(\d+(?:[.,]\d+)?)\s*kg\s*(?:\/\s*szt\.?|na\s*sztukę)/i);
    cargo.push({qty:m[1]||'',length:m[2].replace(',','.'),width:m[3].replace(',','.'),height:m[4].replace(',','.'),weight:weight?weight[1].replace(',','.'):'',stackable:false});
  }
  return {origin:read('załadunek|zaladunek|odbiór|pickup'),destination:read('rozładunek|rozladunek|dostawa|delivery'),cargo:cargo.slice(0,30),
    warning:'To szkic z tekstu. Sprawdź adresy i sztuki; uzupełnij brakujące wagi, terminy oraz warunki. Wagę odczytuję tylko przy oznaczeniu kg/szt. Piętrowalność potwierdź ręcznie.'};
}

export function customerOffer(result) {
  if (!result.ready) fail('Przed przygotowaniem oferty sprawdź założenia, daty i ładowność.');
  const i=result.input;
  return [
    'WSTĘPNA OFERTA TRANSPORTU',i.reference?`Referencja: ${i.reference}`:'',i.client?`Klient: ${i.client}`:'',
    `Trasa: ${i.route.origin} → ${i.route.destination}`,
    `Załadunek: ${i.pickup} | Dostawa: ${i.delivery} (do potwierdzenia)`,
    `Transport: ${i.mode==='dedicated'?'dedykowany':'doładunek'}, ${i.vehicle.name}`,
    ...i.cargo.map(c=>`${c.qty} szt. × ${c.length} × ${c.width} × ${c.height} cm; ${c.weight} kg/szt.; ${c.stackable?'piętrowalne po uzgodnieniu':'bez piętrowania'}`),
    `Łącznie: ${round(result.summary.weight)} kg | ${round(result.summary.volume)} m³`,
    i.tailLift?'Wymagana winda.':'',i.palletJack?'Wymagany paleciak.':'',
    `Cena: ${result.sell.toFixed(2)} EUR netto. VAT zgodnie z właściwymi zasadami rozliczenia.`,
    i.notes?`Uzgodnione warunki / zakres ceny: ${i.notes}`:'',
    'Oferta wstępna, wymaga potwierdzenia dostępności pojazdu, terminów i warunków załadunku. Zmiana danych przesyłki wymaga ponownej wyceny.',
  ].filter(Boolean).join('\n');
}
