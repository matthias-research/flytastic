import { readCamera, cameraHash, cameraInBounds } from './camera-state.js';
import { FlightController, clamp, MIN_PITCH, MAX_PITCH } from './flight.js';
import { configureFlightControls } from './flight-controls.js';
import { FrameMetrics } from './frame-metrics.js';
import { configurePlaceSearch } from './place-search.js';
import { wgsToSwiss } from './swiss-coordinates.js';
import { configureMapNavigation } from './map-navigation.js';
import { createGeographicLabels } from './geographic-labels.js';

const $=id=>document.getElementById(id),surface=$('viewport'),params=new URLSearchParams(location.search);
const modelId=params.get('model')==='swisstopo'?'swisstopo':params.get('model')==='original'?'original':$('model').value;
let flattened=params.get('flattened')!=='0';
let winter=params.get('winter')==='1';
const savedSnowLine=params.get('snowLine');
let snowLine=savedSnowLine!==null&&Number.isFinite(+savedSnowLine)?Math.round(clamp(+savedSnowLine,0,3500)/50)*50:1600;
const rendererId=modelId==='original'?'flytastic':'cesium';
const state={eye:[632,1,-173],yaw:Math.PI,pitch:-.03,roll:0};
const destinations={interlaken:[632,173,Math.PI,-.03],zermatt:[625,100,Math.PI,-.03],lucerne:[668,213,Math.PI,-.03]};
const keys=new Set(),metrics=new FrameMetrics();
let models,model,renderer,flight=null,resetting=true,resetId=0,failure='',notice='',noticeUntil=0;
let placeSearch,mapNavigation,geographicLabels,navigationMode='map',cameraSaveTimer;
const camera=()=>({eye:[...state.eye],yaw:state.yaw,pitch:state.pitch,roll:state.roll,speed:+$('speed').value,destination:$('destination').value});
const ground=()=>renderer.ground(state.eye[0],-state.eye[2])??((flight?.lastGround??(state.eye[1]*1000-650))/1000);
function notify(text){$('message').textContent=text;$('message').hidden=!text;}
function pauseFlight(){flight=null;keys.clear();controls.reset();navigationMode='map';$('fly').textContent='Start cruise →';}
function useFlightNavigation(){navigationMode='flight';mapNavigation?.cancel();placeSearch?.cancelNavigation();clearTimeout(cameraSaveTimer);}
function saveMapCamera(){
  clearTimeout(cameraSaveTimer);cameraSaveTimer=setTimeout(()=>{
    if(navigationMode!=='map'||resetting)return;
    const url=new URL(location.href);url.hash=cameraHash(camera());history.replaceState(null,'',url);
  },150);
}
function switchView(target,flat=flattened) {
  placeSearch?.cancelNavigation();
  const pose=camera();pauseFlight();
  if(!cameraInBounds(pose,models.find(m=>m.id===target).bounds)) {
    notice='This position is outside the selected map. Choose a departure first.';noticeUntil=performance.now()+7000;
    $('model').value=modelId;$('flattened').checked=flattened;return;
  }
  const url=new URL(location.href);url.searchParams.set('model',target);url.searchParams.set('flattened',flat?'1':'0');url.hash=cameraHash(pose);location.href=url.href;
}
$('model').value=modelId;$('flattened').checked=flattened;
$('swisstopo-settings').hidden=modelId!=='swisstopo';
$('winter').checked=winter;$('snow-line').value=snowLine;
function updateWinter(save=false) {
  $('snow-settings').hidden=!winter;$('snow-line-value').textContent=`${snowLine} m`;
  renderer?.setWinter(winter,snowLine);
  if(save) {
    const url=new URL(location.href);url.searchParams.set('winter',winter?'1':'0');url.searchParams.set('snowLine',snowLine);
    history.replaceState(null,'',url);
  }
}
updateWinter();
$('winter').onchange=()=>{winter=$('winter').checked;updateWinter(true);};
$('snow-line').oninput=()=>{snowLine=+$('snow-line').value;updateWinter(true);};
$('model').disabled=$('flattened').disabled=$('reset').disabled=true;
$('model').onchange=()=>switchView($('model').value);
$('flattened').onchange=()=>{
  flattened=$('flattened').checked;renderer.setFlattened(flattened);
  const url=new URL(location.href);url.searchParams.set('flattened',flattened?'1':'0');url.hash=cameraHash(camera());history.replaceState(null,'',url);
};
const controls=configureFlightControls({activate:()=>startFlight(false),brake:()=>{if(flight)flight.cruise=false;},setHeight:value=>{
  if(startFlight(false))flight.clearance=clamp(Math.round(value),100,2000);
},setPitch:value=>{
  if(!renderer||resetting)return;
  useFlightNavigation();
  state.pitch=clamp(value,MIN_PITCH,MAX_PITCH);
  if(flight){flight.viewPitch=state.pitch;flight.state.pitch=state.pitch;}
}});
function sampleGround(east,north) {
  const [w,s,e,n]=model.bounds;
  if(east/1000<w||east/1000>e||north/1000<s||north/1000>n)return undefined;
  const value=renderer.ground(east/1000,north/1000);return Number.isFinite(value)&&value>0?value*1000:undefined;
}
function startFlight(cruise=false) {
  if(!renderer||resetting)return false;
  if(!flight) {
    const height=sampleGround(state.eye[0]*1000,-state.eye[2]*1000);if(!Number.isFinite(height))return false;
    flight=new FlightController({east:state.eye[0]*1000,north:-state.eye[2]*1000,height:state.eye[1]*1000,heading:state.yaw,pitch:state.pitch,roll:state.roll},sampleGround,model.bounds.map((v,i)=>v*1000+(i<2?50:-50)));
    flight.lastGround=height;flight.clearance=Math.max(100,state.eye[1]*1000-height);
  }
  useFlightNavigation();
  if(cruise)flight.cruise=true;$('fly').textContent='Pause flight Ⅱ';return true;
}
async function reset(pose=null,place=null,isCurrent=()=>true) {
  if(!place)placeSearch?.cancelNavigation();
  mapNavigation?.cancel();clearTimeout(cameraSaveTimer);
  const id=++resetId;pauseFlight();notice='';noticeUntil=0;resetting=true;$('fly').disabled=$('reset').disabled=true;
  let [x,y,yaw,pitch]=destinations[$('destination').value];
  if(place){x=place.east;y=place.north+place.offset;yaw=Math.PI;}
  try {
    const [height,targetHeight]=await Promise.all([
      renderer.prepare(pose?.eye?.[0]??x,-(pose?.eye?.[2]??-y)),
      place?renderer.prepare(place.east,place.north):Promise.resolve(null),
    ]);
    if(id!==resetId||!isCurrent())return false;
    if(place&&(!Number.isFinite(height)||!Number.isFinite(targetHeight)||targetHeight<=0))throw Error('No terrain is available for this place in the selected version.');
    const altitude=place?Math.max(height+.65,targetHeight+place.offset*Math.tan(50*Math.PI/180)):height+.65;
    if(place)pitch=-Math.atan2(altitude-targetHeight,place.offset);
    state.eye=pose?.eye?[...pose.eye]:[x,altitude,-y];state.yaw=pose?.yaw??yaw;state.pitch=clamp(pose?.pitch??pitch,MIN_PITCH,MAX_PITCH);state.roll=pose?.roll??0;
    renderer.reset(state);failure='';
    if(!pose?.eye){const url=new URL(location.href);url.hash=place?cameraHash(camera()):'';history.replaceState(null,'',url);}
    document.title=place?`Flytastic · ${place.name}`:'Flytastic — Swiss terrain explorer';
    return true;
  } catch(error){if(id===resetId&&isCurrent()){if(place)throw error;failure=`Terrain unavailable: ${error.message}. Reset view to retry.`;}return false;}
  finally{if(id===resetId){resetting=false;$('reset').disabled=false;$('fly').disabled=Boolean(failure);}}
}
async function navigatePlace(place,isCurrent) {
  const [east,north]=wgsToSwiss(place.longitude,place.latitude);
  const target={...place,east:east/1000,north:north/1000,offset:(place.origin==='address'||place.origin==='parcel') ? 0.5 : 1.1};
  if(!cameraInBounds({eye:[target.east,1,-target.north]},model.bounds)||!cameraInBounds({eye:[target.east,1,-(target.north+target.offset)]},model.bounds))throw Error(`This place is outside the selected map. ${modelId==='original'?'Try the Swisstopo version.':'Choose another place in Switzerland.'}`);
  return reset(null,target,isCurrent);
}
window.flytasticMetrics={reset:()=>metrics.reset(),snapshot:()=>metrics.snapshot()};
if(globalThis.PerformanceObserver&&PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{
  if(!document.hidden)for(const entry of list.getEntries())metrics.longTask(entry.duration);
}).observe({type:'longtask'});
window.addEventListener('blur',()=>{pauseFlight();mapNavigation?.cancel();});
document.addEventListener('visibilitychange',()=>{metrics.previous=undefined;if(document.hidden)pauseFlight();});
window.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='Escape'){e.preventDefault();pauseFlight();return;}
  if(e.target.closest('input,select,button,textarea,[contenteditable],[role="slider"]'))return;
  if(e.code==='Space'){e.preventDefault();if(!e.repeat){if(flight)flight.cruise=!flight.cruise;else startFlight(true);}return;}
  if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) {
    e.preventDefault();if(!startFlight(false))return;keys.add(e.code);if(e.code==='KeyS'||e.code==='ArrowDown')flight.cruise=false;
  }
});
window.addEventListener('keyup',e=>keys.delete(e.code));
$('speed').oninput=()=>{$('speed-value').textContent=`${$('speed').value} km/h`;};
function frame(now) {
  if(!document.hidden)metrics.frame(now);else metrics.previous=undefined;
  const dt=Math.min((now-frame.previous)/1000,.2)||0;frame.previous=now;
  const input=controls.input(dt);
  if(flight&&!resetting) {
    flight.speedLimit=+$('speed').value;
    flight.x=keys.has('KeyD')||keys.has('ArrowRight')?1:keys.has('KeyA')||keys.has('ArrowLeft')?-1:input.x;
    flight.y=keys.has('KeyS')||keys.has('ArrowDown')?0:keys.has('KeyW')||keys.has('ArrowUp')?1:input.y;
    flight.clearance=clamp(flight.clearance+(Number(keys.has('KeyE'))-Number(keys.has('KeyQ')))*300*dt,100,2000);
    flight.step(dt);const s=flight.state;state.eye=[s.east/1000,s.height/1000,-s.north/1000];state.yaw=s.heading;state.pitch=s.pitch;state.roll=s.roll;
    if(flight.boundaryReached){pauseFlight();notice='Reached the edge of this map. Choose another departure.';noticeUntil=now+7000;}
  }
  const clearance=state.eye[1]-ground();
  controls.render({active:Boolean(flight),navigationMode,cruise:flight?.cruise??false,x:flight?.x??0,y:flight?.y??0,speed:flight?flight.state.velocity*flight.speed:0,clearance:flight?.clearance??Math.max(1,clearance*1000),pitch:state.pitch});
  const status=renderer.frame(state,now),error=failure||status.error;
  try{geographicLabels?.frame(state,now);}catch(error){console.warn('Geographic labels disabled:',error);geographicLabels?.dispose();geographicLabels=null;$('overlay-status').textContent='Geographic labels unavailable.';$('village-names').disabled=$('mountain-peaks').disabled=true;$('overlay-credits').hidden=true;}
  $('position').textContent=`${state.eye[0].toFixed(2)} E / ${(-state.eye[2]).toFixed(2)} N`;
  $('altitude').textContent=`${Math.round(state.eye[1]*1000).toLocaleString()} m`;
  $('heading').textContent=`${((state.yaw*180/Math.PI%360+360)%360).toFixed(0).padStart(3,'0')}°`;
  $('stats').textContent=status.description;notify(error||(resetting?'Loading departure…':'')||(now<noticeUntil?notice:'')||(status.loading?'Loading landscape…':''));
  window.flytastic={...status,ready:!resetting,model:modelId,rendererId,navigationMode,winter,snowLine,labels:geographicLabels?.status,flattened:modelId==='swisstopo'?flattened:undefined,eye:[...state.eye],yaw:state.yaw,pitch:state.pitch,roll:state.roll,flightActive:Boolean(flight),clearance,error};
  requestAnimationFrame(frame);
}
window.flytasticSession={camera,sampleHeight:(east,north)=>renderer.ground(east,north)*1000,diagnostics:()=>renderer.diagnostics()};
async function boot() {
  const response=await fetch('/api/models');if(!response.ok)throw Error('Could not load the model list');models=await response.json();
  model=models.find(m=>m.id===modelId);if(!model?.available)throw Error('Original Flytastic data is unavailable. Restore GEODAT or select Swisstopo.');
  for(const option of $('model').options)option.disabled=!models.find(m=>m.id===option.value)?.available;
  $('model-credit').textContent=model.attribution;
  $('model-description').textContent=modelId==='original'?'The original Flytastic landscape and renderer.':'Live swisstopo imagery and terrain across Switzerland.';
  $('terrain-caption').textContent=modelId==='original'?'ORIGINAL FLYTASTIC':'SWISSTOPO · CESIUM';
  const module=modelId==='original'?await import('./renderers/flytastic.js'):await import('./renderers/cesium.js');
  renderer=module.createRenderer({canvas:$('scene'),host:$('cesium-scene'),credits:$('renderer-credits')});await renderer.init({model,flattened});
  updateWinter();
  $('winter').disabled=$('snow-line').disabled=false;
  const saved=readCamera(location.hash),pose=saved&&cameraInBounds(saved,model.bounds)?saved:null;
  if(pose){if(Object.hasOwn(destinations,pose.destination))$('destination').value=pose.destination;$('speed').value=pose.speed;$('speed').oninput();}
  await reset(pose);$('model').disabled=$('flattened').disabled=false;controls.enable();
  geographicLabels=createGeographicLabels(renderer);
  placeSearch=configurePlaceSearch(navigatePlace);$('place-search').disabled=false;
  mapNavigation=configureMapNavigation({element:surface,state,
    ground:(east,north)=>renderer.ground(east,north),bounds:()=>model.bounds,
    pick:(x,y)=>renderer.pickTerrain?.(x,y),enabled:()=>navigationMode==='map'&&!resetting,
    activate:()=>{if(resetting)return false;pauseFlight();placeSearch.cancelNavigation();return true;},onChange:saveMapCamera,
  });
  $('fly').onclick=()=>{if(flight)pauseFlight();else startFlight(true);$('flight-pad').focus();};
  $('reset').onclick=()=>reset();$('destination').onchange=()=>reset();requestAnimationFrame(frame);
}
window.addEventListener('pagehide',()=>{geographicLabels?.dispose();renderer?.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
boot().catch(error=>{console.error(error);notify(error.message);$('stats').textContent='Unable to start';$('model').disabled=false;window.flytastic={ready:false,error:error.message};});
