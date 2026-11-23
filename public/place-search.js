// Search labels are untrusted HTML from the service; only plain text reaches the UI.
export function parsePlaces(data) {
  const categories={address:'Address',gg25:'Municipality',gazetteer:'Place',swissnames:'Place',zipcode:'Postal area',kantone:'Canton',district:'District',parcel:'Parcel'};
  return (data.features||[]).flatMap(feature=>{
    const [longitude,latitude]=feature.geometry?.type==='Point'?feature.geometry.coordinates:[];
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude<5.9||longitude>10.6||latitude<45.7||latitude>47.9)return [];
    const props=feature.properties||{};
    const doc=new DOMParser().parseFromString(String(props.label||''),'text/html');
    const name=doc.body.textContent.trim();
    if(!name)return [];
    return [{longitude,latitude,name,category:categories[props.origin]||'Place',origin:props.origin}];
  });
}

export function configurePlaceSearch(onNavigate) {
  const root=document.querySelector('.place-search');
  const input=document.getElementById('place-search'),clear=document.getElementById('search-clear');
  const panel=document.getElementById('search-panel'),list=document.getElementById('place-results');
  const message=document.getElementById('search-message'),announcement=document.getElementById('search-announcement');
  let timer,controller,revision=0,places=[],active=-1,navigation=0;
  function cancelRequest() { clearTimeout(timer);controller?.abort();revision++; }
  function resetList() { places=[];active=-1;list.replaceChildren();input.removeAttribute('aria-activedescendant'); }
  function close() { cancelRequest();panel.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant'); }
  function show(text='') { message.textContent=text;panel.hidden=false;input.setAttribute('aria-expanded','true'); }
  function activate(index) {
    active=index;
    [...list.children].forEach((li,i)=>li.setAttribute('aria-selected',String(i===active)));
    if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}
  }
  function cancelNavigation() { navigation++; }
  async function choose(index) {
    const place=places[index];if(!place)return;
    close();input.value=place.name;clear.hidden=false;input.blur();
    cancelNavigation();const token=navigation;
    announcement.textContent=`Moving to ${place.name}`;
    try {
      const moved=await onNavigate(place,()=>token===navigation);
      if(token===navigation)announcement.textContent=moved?`At ${place.name}`:'Navigation cancelled.';
    } catch(error) {
      if(token===navigation){announcement.textContent=error.message;show(error.message);}
    }
  }
  async function search() {
    cancelRequest();resetList();const query=input.value.trim(),token=revision;
    if(query.length<2){close();return;}
    controller=new AbortController();const request=controller;
    show('Searching Switzerland…');
    const deadline=setTimeout(()=>request.abort(),10000);
    try {
      const url=new URL('https://api3.geo.admin.ch/rest/services/api/SearchServer');
      url.search=new URLSearchParams({type:'locations',searchText:query,sr:'4326',geometryFormat:'geojson',limit:'7',lang:'en'});
      const response=await fetch(url,{signal:request.signal});
      if(!response.ok)throw Error('Search unavailable');
      const data=await response.json();if(token!==revision)return;
      places=parsePlaces(data);
      show(places.length?'':'No places found. Try a town, summit or street address.');
      places.forEach((place,i)=>{
        const li=document.createElement('li');li.id=`place-option-${i}`;li.role='option';li.setAttribute('aria-selected','false');
        const name=document.createElement('span');name.className='place-name';name.textContent=place.name;
        const category=document.createElement('span');category.className='place-category';category.textContent=place.category;
        li.append(name,category);li.addEventListener('pointerdown',e=>e.preventDefault());li.addEventListener('click',()=>choose(i));list.append(li);
      });
      announcement.textContent=`${places.length} places found`;
    } catch {if(token===revision)show('Search is unavailable. Edit your search to try again.');}
    finally {clearTimeout(deadline);}
  }
  input.addEventListener('input',event=>{
    cancelRequest();resetList();cancelNavigation();clear.hidden=!input.value;
    if(input.value.trim().length<2){close();return;}
    show('Searching Switzerland…');
    if(!event.isComposing)timer=setTimeout(search,250);
  });
  input.addEventListener('compositionend',()=>{cancelRequest();timer=setTimeout(search,250);});
  input.addEventListener('focus',()=>{if(input.value.trim().length>=2)search();});
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();close();}
    else if(event.key==='Tab')close();
    else if(event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();
      if(panel.hidden){search();return;}
      if(places.length)activate(active<0?(event.key==='ArrowDown'?0:places.length-1):(active+(event.key==='ArrowDown'?1:places.length-1)+places.length)%places.length);
    } else if(event.key==='Enter') {
      event.preventDefault();if(!panel.hidden&&places.length)choose(active<0?0:active);else search();
    }
  });
  clear.addEventListener('click',()=>{close();resetList();cancelNavigation();input.value='';clear.hidden=true;input.focus();});
  document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close();});
  root.addEventListener('focusout',event=>{if(!root.contains(event.relatedTarget))close();});
  document.getElementById('viewport').addEventListener('pointerdown',cancelNavigation);
  document.getElementById('viewport').addEventListener('wheel',cancelNavigation,{passive:true});
  return {cancelNavigation};
}
