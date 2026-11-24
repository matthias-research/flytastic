import { wgsToSwiss } from './swiss-coordinates.js';
import { overlaps, labelBox } from './overlay-layout.js';
import { validatePlaceFlags, validateVillageFlags, resolvePlaceFlag, fetchFlagBytes } from './overlay-flags.js';

// One bounded canvas overlay shared by both renderers. Terrain reads use only
// existing local/loaded data; optional labels never trigger scenery requests.
export function createGeographicLabels(renderer) {
  const canvas=document.getElementById('geographic-labels'),ctx=canvas.getContext('2d');
  const credits=document.getElementById('overlay-credits'),message=document.getElementById('overlay-status');
  const controller=new AbortController(),signal=controller.signal;
  const groups={villages:[],peaks:[]},enabled={},status={villages:'loading',peaks:'loading',flags:'loading',villageFlags:'loading',villageImages:0,shown:0};
  let selected=[],next=0,flags,image,villageFlags,villageImage,destroyed=false;
  const controls={villages:document.getElementById('village-names'),peaks:document.getElementById('mountain-peaks')};
  const params=new URLSearchParams(location.search);
  function report() {
    message.textContent=Object.entries(status).filter(([,value])=>value==='error').map(([key])=>`${key==='villageFlags'?'Village-specific flags':key==='flags'?'Flags':key==='peaks'?'Mountain peaks':'Village names'} unavailable.`).join(' ');
    credits.hidden=!Object.keys(groups).some(key=>enabled[key]&&status[key]==='ready');
  }
  for(const [key,control] of Object.entries(controls)) {
    enabled[key]=params.get(key)!=='0';control.checked=enabled[key];
    control.onchange=()=>{
      enabled[key]=control.checked;next=0;selected=[];
      const url=new URL(location.href);url.searchParams.set(key,enabled[key]?'1':'0');history.replaceState(null,'',url);report();
    };
  }
  async function json(file,max=2*1024*1024) {
    const bytes=await fetchFlagBytes(`/overlays/${file}`,AbortSignal.any([signal,AbortSignal.timeout(15000)]),max);
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }
  async function load(key,file) {
    try {
      const data=await json(file);
      if(!Array.isArray(data.places)||!data.places.length||data.places.length>20000)throw Error('Invalid label dataset');
      const seen=new Set();
      groups[key]=data.places.map(p=>{
        if(!Number.isSafeInteger(p.id)||seen.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>300||
          !Number.isFinite(p.longitude)||!Number.isFinite(p.latitude)||p.longitude<5||p.longitude>11.5||p.latitude<45||p.latitude>48.5||
          (key==='peaks'&&(!Number.isFinite(p.elevation)||p.elevation<=0||p.elevation>5000))||
          (key==='villages'&&!['city','town','village'].includes(p.kind)))throw Error('Invalid label feature');
        seen.add(p.id);
        const [east,north]=wgsToSwiss(p.longitude,p.latitude);
        return {...p,east:east/1000,north:north/1000,group:key};
      });
      if(destroyed)return;
      status[key]='ready';controls[key].disabled=false;next=0;
      if(key==='villages')loadFlags();
    } catch(error) {if(!destroyed){status[key]='error';console.warn(`Optional ${key} overlay: ${error.message}`);}}
    report();
  }
  async function loadFlags() {
    let url;
    try {
      flags=validatePlaceFlags(await json('flags.json'),groups.villages);
      const bytes=await fetchFlagBytes(`/overlays/${flags.sheet.file}`,AbortSignal.any([signal,AbortSignal.timeout(15000)]),8*1024*1024);
      const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      if(bytes.length<24||header.getUint32(0)!==0x89504e47||header.getUint32(16)!==flags.sheet.width||header.getUint32(20)!==flags.sheet.height)throw Error('Invalid flag image');
      url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      const decoded=new Image();decoded.src=url;await decoded.decode();
      if(!destroyed){image=decoded;status.flags='ready';next=0;loadVillageFlags();}
    } catch(error){if(!destroyed){status.flags='error';flags=undefined;console.warn(`Optional flags: ${error.message}`);}}
    finally{if(url)URL.revokeObjectURL(url);report();}
  }
  async function loadVillageFlags() {
    let url;
    try {
      const assets=validateVillageFlags(await json('village-flags.json'),groups.villages,flags);
      if(assets.sheet) {
        const bytes=await fetchFlagBytes(`/overlays/${assets.sheet.file}`,AbortSignal.any([signal,AbortSignal.timeout(15000)]),8*1024*1024);
        const h=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        if(bytes.length<24||h.getUint32(0)!==0x89504e47||h.getUint32(16)!==assets.sheet.width||h.getUint32(20)!==assets.sheet.height)throw Error('Invalid village image');
        url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
        const decoded=new Image();decoded.src=url;await decoded.decode();
        if(destroyed)return;villageImage=decoded;
      }
      if(!destroyed){villageFlags=assets;status.villageFlags='ready';status.villageImages=assets.mapping.size;next=0;}
    } catch(error){if(!destroyed){status.villageFlags='error';console.warn(`Optional village images: ${error.message}`);}}
    finally{if(url)URL.revokeObjectURL(url);report();}
  }
  load('villages','villages.json');load('peaks','peaks.json');
  return {
    get status(){return {...status,enabled:{...enabled},counts:{villages:groups.villages.length,peaks:groups.peaks.length}};},
    frame(state,now) {
      const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio,2);
      if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);status.shown=0;
      if(now>=next) {
        next=now+250;
        const candidates=[];
        for(const [key,entries] of Object.entries(groups))if(enabled[key])for(const p of entries) {
          const distance=Math.hypot(p.east-state.eye[0],p.north+state.eye[2]);
          const limit=key==='peaks'?65:p.kind==='city'?80:p.kind==='town'?35:12;
          if(distance>limit)continue;
          // Nearer peaks and larger settlements take precedence. Reserve room
          // for each type before the final shared collision layout.
          const priority=key==='peaks'?distance/(1+p.elevation/2000):distance/({city:5,town:2,village:1}[p.kind]);
          candidates.push({p,distance,priority});
        }
        candidates.sort((a,b)=>a.priority-b.priority);
        selected=[];const count={villages:0,peaks:0};
        for(const {p,distance} of candidates.slice(0,180)) {
          if(count[p.group]>=40)continue;
          const ground=renderer.labelGround(p);
          if(!Number.isFinite(ground)||ground<=0)continue;
          const altitude=Math.max(ground,p.group==='peaks'?p.elevation/1000:ground)+.045;
          const pixel=renderer.projectLabel(p,altitude,state);
          if(!pixel||pixel.x<0||pixel.x>width||pixel.y<0||pixel.y>height||!renderer.labelVisible(p,altitude,state))continue;
          // Display published summit elevations; sampled ground only anchors labels.
          const text=p.group==='peaks'?`▲ ${p.name} · ${Math.round(p.elevation).toLocaleString('en-CH')} m`:p.name;
          selected.push({p,altitude,text,distance});count[p.group]++;
        }
      }
      const blocked=[...document.querySelectorAll('header,aside,.place-search,.flight-controls,footer,#message,#renderer-credits,#overlay-credits')]
        .filter(el=>!el.hidden).map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height);
      ctx.font='600 14px "Segoe UI",sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.lineJoin='round';ctx.lineWidth=3;
      for(const {p,altitude,text} of selected) {
        if(!enabled[p.group])continue;
        const pixel=renderer.projectLabel(p,altitude,state);if(!pixel)continue;
        const flag=p.group==='villages'&&image&&resolvePlaceFlag(p.id,flags,villageFlags),hasFlag=Boolean(flag);
        const box=labelBox(pixel,ctx.measureText(text).width,hasFlag);
        if(box.left<0||box.right>width||box.top<0||box.bottom>height||blocked.some(b=>overlaps(box,b)))continue;
        blocked.push(box);ctx.strokeStyle='#172b31';ctx.fillStyle=p.group==='peaks'?'#fff0bf':'#ffffff';
        ctx.strokeText(text,pixel.x,pixel.y);ctx.fillText(text,pixel.x,pixel.y);
        if(hasFlag)ctx.drawImage(flag.sheet==='village'?villageImage:image,...flag.rect,pixel.x-14,pixel.y-47,28,28);
        if(++status.shown>=48)break;
      }
    },
    dispose(){destroyed=true;controller.abort();ctx.clearRect(0,0,canvas.width,canvas.height);},
  };
}
