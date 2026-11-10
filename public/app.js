import { Terrain } from './terrain.js';
import { perspective, view } from './math.js';
import { LEVELS, START_CLEARANCE, selectTiles, coverageIndex } from './lod.js';
import { readCamera, cameraHash, cameraInBounds } from './camera-state.js';
import { FlightController, clamp } from './flight.js';
import { configureFlightControls } from './flight-controls.js';

const $=id=>document.getElementById(id), canvas=$('scene'), message=$('message');
const gl=canvas.getContext('webgl2', { antialias:true, alpha:false });
const modelId=new URLSearchParams(location.search).get('model')||'original';
let model;
const api=path=>`${path}?model=${encodeURIComponent(modelId)}${model?.version?`&v=${model.version}`:''}`;
$('model').value=modelId;
$('model').disabled=true;
$('model').onchange=async()=>{
  const target=$('model').value;
  pauseFlight();
  const camera={eye:[...state.eye],yaw:state.yaw,pitch:state.pitch,roll:state.roll,speed:+$('speed').value,destination:$('destination').value};
  $('model').disabled=true;
  try {
    const targetModel=await fetchOK(`/api/model?model=${encodeURIComponent(target)}`).then(r=>r.json());
    if(!cameraInBounds(camera,targetModel.bounds)) {
      comparisonNotice='This view is outside the selected map’s coverage. Return to Interlaken to compare the pilot.';
      noticeUntil=performance.now()+7000;$('model').value=modelId;return;
    }
    const url=new URL(location.href);url.searchParams.set('model',target);url.hash=cameraHash(camera);location.href=url.href;
  } catch(error) {comparisonNotice=`Could not switch map: ${error.message}`;noticeUntil=performance.now()+7000;$('model').value=modelId;}
  finally {$('model').disabled=false;}
};
const destinations={interlaken:[632,173,Math.PI,-0.03],zermatt:[625,100,Math.PI,-0.03],lucerne:[668,213,Math.PI,-0.03]};
const state={eye:[632,1,-173],yaw:Math.PI,pitch:-0.03,roll:0,flying:false};
let comparisonNotice='', noticeUntil=0, flight=null;
const flightControls=configureFlightControls({activate:()=>startFlight(false),brake:()=>{if(flight)flight.cruise=false;},setHeight:value=>{
  if(startFlight(false))flight.clearance=clamp(Math.round(value),100,2000);
}});
const keys=new Set(), tiles=new Map();
let terrain, packs, queue=[], active=0, generation=0, lastCell='', triangles=0, failure='';
const coverage = new Map();
let geometryWorker, geometryBusy=null, geometryJobs=[], geometrySignature='', geometryAnchor='';
let geometryId=0, splitVertices=0, geometrySpacing=0, geometryBroken=false;
const meshCache=new Map();
const anchor=()=>{
  const horizontal=terrain?.spacing<100?4:1, vertical=terrain?.spacing<100?10:2;
  return [Math.floor(state.eye[0]*horizontal),Math.floor(state.eye[1]*vertical),Math.floor(-state.eye[2]*horizontal)].join('/');
};
function notify(text) { message.textContent=text; message.hidden=!text; }
function shader(type,source) {
  const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s;
}
function program() {
  const p=gl.createProgram();
  gl.attachShader(p,shader(gl.VERTEX_SHADER,`#version 300 es
    precision highp float;
    layout(location=0) in vec3 position; layout(location=1) in vec2 uv;
    uniform mat4 projection, camera; out vec2 texcoord, terrainPosition; out float distanceKm;
    void main(){vec4 v=camera*vec4(position,1.);gl_Position=projection*v;texcoord=uv;terrainPosition=vec2(position.x,-position.z);distanceKm=length(v.xyz);}`));
  gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float; precision highp int;
    in vec2 texcoord, terrainPosition; in float distanceKm;
    uniform sampler2D imagery;
    uniform highp usampler2D coverageD, coverageC;
    uniform vec3 gridD, gridC;
    uniform int imageryLevel;
    out vec4 color;
    bool covered(highp usampler2D mask, vec3 grid) {
      ivec2 cell=ivec2(floor((terrainPosition-grid.xy)/grid.z));
      if(any(lessThan(cell,ivec2(0))) || any(greaterThanEqual(cell,textureSize(mask,0)))) return false;
      return texelFetch(mask,cell,0).r!=0u;
    }
    void main(){
      // A coarse fragment yields only to a finer tile already uploaded to the GPU.
      // Missing, sparse or pending finer imagery therefore keeps its fallback.
      if(imageryLevel<2 && covered(coverageC,gridC)) discard;
      if(imageryLevel<1 && covered(coverageD,gridD)) discard;
      vec4 sampleColor=texture(imagery,texcoord);if(sampleColor.a<.5)discard;vec3 c=sampleColor.rgb;float fog=smoothstep(12.,39.,distanceKm);
      color=vec4(mix(c,vec3(.56,.68,.73),fog*.88),1.);
    }`));
  gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
}
let prog, projectionLocation, cameraLocation, levelLocation;
async function fetchOK(url) { const response=await fetch(url); if(!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response; }
function setCoverage(pack, x, y, ready) {
  const mask=coverage.get(pack.id); if(!mask) return;
  mask.data[coverageIndex(pack,x,y)]=ready?1:0; mask.dirty=true;
}
function dispose(tile) {
  setCoverage(tile.pack,tile.x,tile.y,false);
  gl.deleteTexture(tile.texture); gl.deleteBuffer(tile.buffer); gl.deleteVertexArray(tile.vao);
}
function installMesh(tile, mesh) {
  tile.count=mesh.length/5;
  if(mesh.length) {
    if(!tile.vao) {
      tile.vao=gl.createVertexArray(); tile.buffer=gl.createBuffer();
      gl.bindVertexArray(tile.vao); gl.bindBuffer(gl.ARRAY_BUFFER,tile.buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,tile.buffer); gl.bufferData(gl.ARRAY_BUFFER,mesh,gl.STATIC_DRAW);
  }
  setCoverage(tile.pack,tile.x,tile.y,mesh.length>0);
}
function updateGeometry() {
  if(geometryBroken || geometryBusy || !geometryJobs.length) return;
  const signature=geometryJobs.map(j=>j.key).sort().join(','), currentAnchor=anchor();
  if(signature===geometrySignature && currentAnchor===geometryAnchor) return;
  geometryBusy={id:++geometryId,generation,signature,anchor:currentAnchor};
  geometryWorker.postMessage({type:'build',id:geometryId,generation,eye:[...state.eye],tiles:geometryJobs.map(({key,pack,x,y})=>({key,x,y,pack:{...pack,available:undefined,tiles:undefined}}))});
}
function receiveGeometry({data}) {
  const request=geometryBusy; geometryBusy=null;
  if(!request || data.id!==request.id || data.generation!==generation) return;
  if(data.error) { failure=`Terrain refinement failed: ${data.error}`; geometryBroken=true; return; }
  const signature=geometryJobs.map(j=>j.key).sort().join(',');
  if(signature!==request.signature) return; // Tile selection changed while building.
  // All scales swap together in one event, using one shared, conforming mesh.
  // This keeps imagery boundaries from exposing different-height surfaces.
  meshCache.clear();
  for(const {key,vertices} of data.meshes) {
    meshCache.set(key,vertices);
    const tile=tiles.get(key); if(tile) installMesh(tile,vertices);
  }
  geometrySignature=request.signature; geometryAnchor=request.anchor;
  splitVertices=data.splitVertices; geometrySpacing=data.spacing;
}
function createCoverage(pack, unit) {
  const width=pack.maxX-pack.minX+1, height=pack.maxY-pack.minY+1;
  const size=pack.divisor/pack.factor*pack.width/1000;
  const texture=gl.createTexture(), data=new Uint8Array(width*height);
  gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.R8UI,width,height,0,gl.RED_INTEGER,gl.UNSIGNED_BYTE,data);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(prog,`coverage${pack.id}`),unit);
  gl.uniform3f(gl.getUniformLocation(prog,`grid${pack.id}`),pack.minX*size+pack.xstart/1000,pack.minY*size+pack.ystart/1000,size);
  coverage.set(pack.id,{texture,data,width,height,unit,dirty:false});
  gl.activeTexture(gl.TEXTURE0);
}
async function loadTile(job) {
  let texture;
  const {pack}=job;
  try {
    const response=await fetchOK(api(`/api/tile/${pack.id}/${job.x}/${job.y}`));
    // Explicit top-to-bottom flip: original bufferImage reverses JPEG rows.
    const bitmap=await createImageBitmap(await response.blob(), { imageOrientation:'flipY', colorSpaceConversion:'none' });
    if(job.generation!==generation || !desired.has(job.key)) { bitmap.close(); return; }
    texture=gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap); bitmap.close();
    gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const tile={texture,buffer:null,vao:null,count:0,pack,level:job.level,x:job.x,y:job.y};
    const mesh=meshCache.get(job.key); if(mesh) installMesh(tile,mesh);
    tiles.set(job.key,tile);
  } catch(error) {
    if(texture) gl.deleteTexture(texture);
    if(job.generation===generation) { failure='Some terrain tiles could not load. Reset view to retry.'; console.error(error); }
  }
}
const desired=new Set();
const pending=new Set();
function refreshTiles() {
  // Re-evaluate on horizontal movement AND altitude changes (250 m buckets).
  const cell=state.eye.map(v=>Math.floor(v*4)).join('/');
  if(cell===lastCell) return; lastCell=cell;
  desired.clear(); queue=[];
  geometryJobs=selectTiles(packs,state.eye,terrain);
  for(const job of geometryJobs) {
    desired.add(job.key);
    if(!tiles.has(job.key)&&!pending.has(`${generation}:${job.key}`)) queue.push({...job,generation});
  }
  for(const [key,tile] of tiles) if(!desired.has(key)) { dispose(tile); tiles.delete(key); }
}
function pump() {
  while(active<4 && queue.length) {
    const job=queue.shift(), token=`${job.generation}:${job.key}`; pending.add(token); active++;
    loadTile(job).finally(()=>{active--;pending.delete(token);pump();});
  }
}
function reset(camera=null) {
  pauseFlight();
  comparisonNotice='';noticeUntil=0;
  const [x,y,yaw,pitch]=destinations[$('destination').value];
  state.eye=camera?.eye?[...camera.eye]:[x,terrain.ground(x,y)+START_CLEARANCE,-y]; state.yaw=camera?.yaw??yaw; state.pitch=camera?.pitch??pitch;state.roll=camera?.roll??0; state.flying=false;
  if(!camera?.eye){const url=new URL(location.href);url.hash='';history.replaceState(null,'',url);}
  stopInput();
  generation++; failure=''; lastCell='';
  meshCache.clear(); geometrySignature=''; geometryAnchor=''; splitVertices=0; geometrySpacing=0;
  for(const tile of tiles.values()) dispose(tile); tiles.clear(); refreshTiles(); pump();
}
function stopInput() { keys.clear(); }
function pauseFlight() {
  flight=null;state.flying=false;stopInput();flightControls.reset();$('fly').textContent='Start cruise →';
}
function sampleFlightGround(east,north) {
  const [west,south,right,top]=model.bounds;
  if(east/1000<west||east/1000>right||north/1000<south||north/1000>top)return undefined;
  const value=terrain.ground(east/1000,north/1000)*1000;
  return value>0?value:undefined;
}
function startFlight(cruise=false) {
  if(!terrain||!model)return false;
  if(!flight) {
    const ground=sampleFlightGround(state.eye[0]*1000,-state.eye[2]*1000);
    if(!Number.isFinite(ground))return false;
    const [west,south,east,north]=model.bounds;
    flight=new FlightController({east:state.eye[0]*1000,north:-state.eye[2]*1000,height:state.eye[1]*1000,heading:state.yaw,pitch:state.pitch,roll:state.roll},sampleFlightGround,[west*1000+50,south*1000+50,east*1000-50,north*1000-50]);
    flight.lastGround=ground;flight.clearance=Math.max(100,state.eye[1]*1000-ground);
  }
  if(cruise)flight.cruise=true;
  state.flying=true;$('fly').textContent='Pause flight Ⅱ';return true;
}
window.addEventListener('blur',pauseFlight);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseFlight();});
window.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='Escape'){e.preventDefault();pauseFlight();return;}
  if(e.target.closest('input,select,button,textarea,[contenteditable],[role="slider"]'))return;
  if(e.code==='Space'){
    e.preventDefault();if(!e.repeat){if(flight)flight.cruise=!flight.cruise;else startFlight(true);}return;
  }
  if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) {
    e.preventDefault();if(!startFlight(false))return;keys.add(e.code);
    if(e.code==='KeyS'||e.code==='ArrowDown')flight.cruise=false;
  }
});
window.addEventListener('keyup',e=>keys.delete(e.code));
let drag=false;
canvas.addEventListener('pointerdown',e=>{pauseFlight();drag=true;canvas.setPointerCapture(e.pointerId);canvas.focus();});
canvas.addEventListener('pointerup',()=>drag=false); canvas.addEventListener('pointercancel',()=>drag=false); canvas.addEventListener('lostpointercapture',()=>drag=false);
canvas.addEventListener('pointermove',e=>{if(drag){state.roll=0;state.yaw+=e.movementX*.004;state.pitch=Math.max(-1.3,Math.min(1.1,state.pitch-e.movementY*.004));}});
$('speed').addEventListener('input',()=>{$('speed-value').textContent=`${$('speed').value} km/h`;});
$('reset').disabled=true;
function frame(now) {
  const dt=Math.min((now-frame.previous)/1000,.2)||0; frame.previous=now;
  const dpr=Math.min(devicePixelRatio,2), w=Math.round(canvas.clientWidth*dpr), h=Math.round(canvas.clientHeight*dpr);
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
  const input=flightControls.input(dt);
  if(flight) {
    flight.speedLimit=+$('speed').value;
    flight.x=keys.has('KeyD')||keys.has('ArrowRight')?1:keys.has('KeyA')||keys.has('ArrowLeft')?-1:input.x;
    flight.y=keys.has('KeyS')||keys.has('ArrowDown')?0:keys.has('KeyW')||keys.has('ArrowUp')?1:input.y;
    const vertical=Number(keys.has('KeyE'))-Number(keys.has('KeyQ'));
    if(vertical)flight.clearance=clamp(flight.clearance+vertical*300*dt,100,2000);
    flight.step(dt);
    const s=flight.state;
    state.eye=[s.east/1000,s.height/1000,-s.north/1000];state.yaw=s.heading;state.pitch=s.pitch;state.roll=s.roll;
    if(flight.boundaryReached){pauseFlight();comparisonNotice='Reached the edge of this map. Choose a departure or another landscape.';noticeUntil=now+7000;}
  }
  flightControls.render({active:Boolean(flight),cruise:flight?.cruise??false,x:flight?.x??0,y:flight?.y??0,speed:flight?flight.state.velocity*flight.speed:0,clearance:flight?.clearance??Math.max(1,(state.eye[1]-terrain.ground(state.eye[0],-state.eye[2]))*1000)});
  refreshTiles();pump();updateGeometry();
  gl.clearColor(.56,.68,.73,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(prog);
  gl.uniformMatrix4fv(projectionLocation,false,perspective(Math.PI/3,w/h,.03,100));gl.uniformMatrix4fv(cameraLocation,false,view(state.eye,state.yaw,state.pitch,state.roll));
  for(const mask of coverage.values()) {
    gl.activeTexture(gl.TEXTURE0+mask.unit); gl.bindTexture(gl.TEXTURE_2D,mask.texture);
    if(mask.dirty) { gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,mask.width,mask.height,gl.RED_INTEGER,gl.UNSIGNED_BYTE,mask.data); mask.dirty=false; }
  }
  gl.activeTexture(gl.TEXTURE0);
  triangles=0;
  const levels={E:0,D:0,C:0};
  for(const tile of tiles.values()){
    if(!tile.count) continue;
    gl.uniform1i(levelLocation,tile.level); gl.bindVertexArray(tile.vao);gl.bindTexture(gl.TEXTURE_2D,tile.texture);gl.drawArrays(gl.TRIANGLES,0,tile.count);
    triangles+=tile.count/3; levels[tile.pack.id]++;
  }
  $('position').textContent=`${state.eye[0].toFixed(2)} E / ${(-state.eye[2]).toFixed(2)} N`;
  $('altitude').textContent=`${Math.round(state.eye[1]*1000).toLocaleString()} m`;
  $('heading').textContent=`${((state.yaw*180/Math.PI%360+360)%360).toFixed(0).padStart(3,'0')}°`;
  $('stats').textContent=`E ${levels.E} · D ${levels.D} · C ${levels.C} tiles · ${Math.round(triangles/1000)}k triangles · ${geometrySpacing||'—'} m`;
  const loading=active+queue.length+Number(Boolean(geometryBusy));
  notify(failure || (performance.now()<noticeUntil?comparisonNotice:'') || (loading ? `Loading landscape · ${levels.E+levels.D+levels.C} tiles ready` : !tiles.size ? 'No imagery at this location. Choose a departure to return.' : ''));
  window.flytastic={ready:true,model:modelId,tiles:tiles.size,levels,triangles,loading,geometrySpacing,splitVertices,eye:[...state.eye],yaw:state.yaw,pitch:state.pitch,roll:state.roll,flightActive:Boolean(flight),cruise:flight?.cruise??false,flightSpeed:flight?flight.state.velocity*flight.speed:0,targetClearance:flight?.clearance,clearance:state.eye[1]-terrain.ground(state.eye[0],-state.eye[2]),error:failure,glError:gl.getError()};
  requestAnimationFrame(frame);
}
async function boot() {
  if(!gl) throw new Error('WebGL 2 is unavailable. Enable graphics acceleration or try another browser.');
  prog=program();projectionLocation=gl.getUniformLocation(prog,'projection');cameraLocation=gl.getUniformLocation(prog,'camera');gl.enable(gl.DEPTH_TEST);
  levelLocation=gl.getUniformLocation(prog,'imageryLevel');gl.useProgram(prog);gl.uniform1i(gl.getUniformLocation(prog,'imagery'),0);
  const [models,metadata]=await Promise.all([fetchOK('/api/models').then(r=>r.json()),fetchOK(api('/api/model')).then(r=>r.json())]);
  model=metadata;
  for(const option of $('model').options)option.disabled=!models.find(m=>m.id===option.value)?.available;
  $('model-credit').textContent=model.attribution;
  $('terrain-caption').textContent=model.pilot?'SWISSTOPO TERRAIN · WEBGL 2':'ORIGINAL TERRAIN · WEBGL 2';
  $('model-description').textContent=model.pilot?'Interlaken · 10 × 10 km pilot. 2 m aerial imagery and 10 m terrain.':'Explore the original Flytastic landscape, one mountain at a time.';
  if(model.pilot)for(const option of $('destination').options)option.disabled=option.value!=='interlaken';
  const [catalog,elevation,tree]=await Promise.all([fetchOK(api('/api/catalog')).then(r=>r.json()),fetchOK(api('/api/elevation')).then(r=>r.arrayBuffer()),fetchOK(api('/api/tree')).then(r=>r.arrayBuffer())]);
  terrain=new Terrain(elevation,tree,model.terrain);
  geometryWorker=new Worker('/geometry-worker.js',{type:'module'});
  geometryWorker.onmessage=receiveGeometry;
  geometryWorker.onerror=event=>{geometryBusy=null;geometryBroken=true;failure=`Terrain worker failed: ${event.message}`;};
  geometryWorker.postMessage({type:'init',elevation,tree,metadata:model.terrain});
  packs=LEVELS.map(({id})=>{
    const pack=catalog.find(p=>p.id===id);if(!pack)throw new Error(`Original imagery pack ${id} is missing.`);
    return {...pack,available:new Set(pack.tiles.map(([x,y])=>`${x}/${y}`))};
  });
  createCoverage(packs.find(p=>p.id==='D'),1); createCoverage(packs.find(p=>p.id==='C'),2);
  const savedCamera=readCamera(location.hash);
  const camera=savedCamera&&cameraInBounds(savedCamera,model.bounds)?savedCamera:null;
  if(camera){
    const option=[...$('destination').options].find(o=>o.value===camera.destination&&!o.disabled);
    if(option)$('destination').value=option.value;
    $('speed').value=camera.speed;$('speed-value').textContent=`${camera.speed} km/h`;
  }
  reset(camera);
  $('model').disabled=false;
  flightControls.enable();
  $('fly').disabled=false;$('reset').disabled=false;
  $('fly').onclick=()=>{if(flight)pauseFlight();else startFlight(true);document.getElementById('flight-pad').focus();};
  $('reset').onclick=reset;$('destination').onchange=reset;requestAnimationFrame(frame);
}
boot().catch(error=>{console.error(error);notify(error.message);$('stats').textContent='Unable to start';window.flytastic={ready:false,error:error.message};});
