// Route inputs use the same geocoding and routing services as the main calculator.
export function googleMapsUrl(value){
  const url=new URL(value.trim());
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw Error('Wklej link Google Maps.');
  if(!/^(?:(?:www|maps)\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(url.hostname)&&!['maps.app.goo.gl','goo.gl'].includes(url.hostname))throw Error('Wklej link Google Maps.');
  return url;
}
export function parseMapsRoute(value){
  const url=googleMapsUrl(value),q=url.searchParams;
  let parts=[];
  if(q.get('origin')&&q.get('destination'))parts=[q.get('origin'),...(q.get('waypoints')||'').split('|').filter(Boolean),q.get('destination')];
  else if(q.get('saddr')&&q.get('daddr'))parts=[q.get('saddr'),...q.get('daddr').split(/(?:\s+|\+)to:/i)];
  else {
    const path=url.pathname.match(/\/maps\/dir\/(.*)/);
    if(path)parts=path[1].split('/').filter(p=>p&&!p.startsWith('@')&&!p.startsWith('data=')).map(p=>decodeURIComponent(p.replace(/\+/g,' ')));
  }
  parts=parts.map(p=>p.trim());
  if(parts.length<2||parts.some(p=>!p||p.length>300)||parts.length>20)throw Error('Link musi zawierać załadunek, rozładunek i najwyżej 18 punktów pośrednich. Skopiuj link do całej trasy.');
  return {origin:parts[0],destination:parts.at(-1),stops:parts.slice(1,-1)};
}

export function setupRouteInputs({api,onChange,message}){
  const $=id=>document.getElementById(id),list=$('routeStops');
  let active=null,items=[],selected=-1,timer,request,sequence=0,importSequence=0;
  const dropdown=document.createElement('div');dropdown.id='routeSuggestions';dropdown.className='route-suggestions';dropdown.role='listbox';dropdown.hidden=true;document.body.append(dropdown);
  function close(){sequence++;clearTimeout(timer);request?.abort();dropdown.hidden=true;active?.setAttribute('aria-expanded','false');active?.removeAttribute('aria-activedescendant');}
  function position(){if(!active||dropdown.hidden)return;const r=active.getBoundingClientRect();dropdown.style.width=`${r.width}px`;dropdown.style.left=`${r.left}px`;const h=Math.min(dropdown.scrollHeight,240);dropdown.style.top=`${r.bottom+h+6>innerHeight&&r.top>h?r.top-h-4:r.bottom+4}px`;}
  function choose(index){if(!active||!items[index])return;const input=active;input.value=items[index].display_name;close();input.dispatchEvent(new Event('input',{bubbles:true}));close();input.focus({preventScroll:true});}
  function attach(input){
    input.dataset.routeAddress='';input.autocomplete='off';input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',dropdown.id);input.setAttribute('aria-expanded','false');
    input.addEventListener('input',()=>{
      close();active=input;const query=input.value.trim(),seq=sequence;if(query.length<3)return;
      timer=setTimeout(async()=>{request=new AbortController();try{
        const data=await api('/api/geocode?q='+encodeURIComponent(query),{signal:request.signal});
        if(seq!==sequence||document.activeElement!==input||!input.isConnected)return;
        items=(Array.isArray(data)?data:[]).filter(x=>typeof x.display_name==='string'&&x.display_name.length<=300).slice(0,6);selected=-1;dropdown.replaceChildren();
        items.forEach((item,index)=>{const row=document.createElement('div');row.role='option';row.id=`routeSuggestion-${index}`;row.textContent=item.display_name;row.addEventListener('pointerdown',e=>{e.preventDefault();choose(index);});dropdown.append(row);});
        dropdown.hidden=!items.length;input.setAttribute('aria-expanded',String(!!items.length));position();
      }catch(e){if(e.name!=='AbortError'&&seq===sequence){close();$('routeStatus').textContent='Podpowiedzi są niedostępne. Możesz wpisać pełny adres ręcznie.';}}},300);
    });
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'){close();return;}if(dropdown.hidden||active!==input)return;
      if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;[...dropdown.children].forEach((row,i)=>row.setAttribute('aria-selected',String(i===selected)));input.setAttribute('aria-activedescendant',dropdown.children[selected].id);dropdown.children[selected].scrollIntoView({block:'nearest'});}
      if(e.key==='Enter'&&selected>=0){e.preventDefault();choose(selected);}
    });
    input.addEventListener('blur',close);
  }
  function addStop(value=''){
    if(list.children.length>=18){message('Możesz dodać najwyżej 18 punktów pośrednich.',true);return;}
    const row=document.createElement('div');row.className='route-stop';
    const label=document.createElement('label'),caption=document.createElement('span'),input=document.createElement('input');input.maxLength=300;input.value=value;input.placeholder='Kraj, kod, miasto, ulica';input.dataset.stop='';label.append(caption,input);
    const remove=document.createElement('button');remove.type='button';remove.className='quiet';remove.textContent='×';remove.setAttribute('aria-label','Usuń punkt pośredni');remove.onclick=()=>{close();row.remove();number();onChange();};row.append(label,remove);list.append(row);attach(input);number();return input;
  }
  function number(){[...list.children].forEach((row,i)=>row.querySelector('label span').textContent=`Przez · punkt ${i+1}`);$('addRouteStop').disabled=list.children.length>=18;}
  const getStops=()=>[...list.querySelectorAll('[data-stop]')].map(e=>e.value.trim()).filter(Boolean);
  function setStops(stops=[]){close();list.replaceChildren();stops.forEach(addStop);number();}
  attach($('origin'));attach($('destination'));
  $('addRouteStop').onclick=()=>{const input=addStop();input?.focus();};
  window.addEventListener('resize',position);document.addEventListener('scroll',position,true);
  $('importMaps').onclick=async()=>{
    const button=$('importMaps'),raw=$('mapsUrl').value,scope=JSON.stringify([$('origin').value,getStops(),$('destination').value]),seq=++importSequence;button.disabled=true;
    try{
      let url=googleMapsUrl(raw);
      if(['maps.app.goo.gl','goo.gl'].includes(url.hostname)){const data=await api('/api/expand-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url.href})});url=googleMapsUrl(data.url||'');}
      const parsed=parseMapsRoute(url.href);
      if(seq!==importSequence||raw!==$('mapsUrl').value||scope!==JSON.stringify([$('origin').value,getStops(),$('destination').value]))throw Error('Trasa zmieniła się podczas importu. Wczytaj link ponownie.');
      $('origin').value=parsed.origin;$('destination').value=parsed.destination;setStops(parsed.stops);onChange();$('mapsImport').open=false;
      $('routeStatus').textContent='Wczytano punkty Google Maps. Kliknij „Pobierz trasę”, aby policzyć km dla wybranego auta.';
    }catch(e){message(e.message,true);}finally{button.disabled=false;}
  };
  return {getStops,setStops};
}
