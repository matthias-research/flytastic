import { Terrain } from '../terrain.js';
import { perspective, view } from '../math.js';
import { LEVELS, selectTiles, coverageIndex } from '../lod.js';
import { snowGLSL } from '../snow.js';

// Original Flytastic data and rendering only.
export function createRenderer({canvas}) {
const gl=canvas.getContext('webgl2',{antialias:true,alpha:false});
let state,terrain,packs,queue=[],active=0,generation=0,lastCell='',triangles=0,failure='';
const tiles=new Map(),coverage=new Map(),desired=new Set(),pending=new Set();
let geometryWorker,geometryBusy=null,geometryJobs=[],geometrySignature='',geometryAnchor='';
let geometryId=0,splitVertices=0,geometrySpacing=0,geometryBroken=false;
let geometryUpload=null,textureRevision=0;
const textureUploads=[],tileRequests=new Map(),tileRetries=new Map();
let nextTileRetry=Infinity,lastGlCheck=0,glError=0,disposed=false;
let winter=false,snowLine=1600,snowEnabledLocation,snowLineLocation;
const anchor=()=>{
  return [Math.floor(state.eye[0]),Math.floor(state.eye[1]*2),Math.floor(-state.eye[2])].join('/');
};
function shader(type,source) {
  const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s;
}
function program() {
  const p=gl.createProgram();
  gl.attachShader(p,shader(gl.VERTEX_SHADER,`#version 300 es
    precision highp float;
    layout(location=0) in vec3 position; layout(location=1) in vec2 uv;
    layout(location=2) in vec3 vertexNormal;
    uniform mat4 projection, camera; out vec2 texcoord, terrainPosition; out float distanceKm; out vec3 snowPosition,snowNormal;
    void main(){vec4 v=camera*vec4(position,1.);gl_Position=projection*v;texcoord=uv;terrainPosition=vec2(position.x,-position.z);distanceKm=length(v.xyz);snowPosition=position;snowNormal=vertexNormal;}`));
  gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float; precision highp int;
    in vec2 texcoord, terrainPosition; in float distanceKm;
    uniform sampler2D imagery;
    uniform highp usampler2D coverageD, coverageC;
    uniform vec3 gridD, gridC;
    uniform int imageryLevel;
    in vec3 snowPosition,snowNormal;
    uniform bool snowEnabled;
    uniform float snowLine;
    ${snowGLSL}
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
      if(snowEnabled) {
        float upFacing=clamp(normalize(snowNormal).y,0.,1.);
        vec4 snow=snowAppearance(c,snowCoverage(snowPosition.y*1000.,upFacing,snowPosition*1000.,snowLine,c));
        c=mix(c,snow.rgb,snow.a);
      }
      color=vec4(mix(c,vec3(.56,.68,.73),fog*.88),1.);
    }`));
  gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
}
let prog, projectionLocation, cameraLocation, levelLocation;
async function fetchOK(url,options) { const response=await fetch(url,options); if(!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response; }
function setCoverage(pack, x, y, ready) {
  const mask=coverage.get(pack.id); if(!mask) return;
  mask.data[coverageIndex(pack,x,y)]=ready?1:0; mask.dirty=true;
}
function dispose(tile) {
  setCoverage(tile.pack,tile.x,tile.y,false);
  gl.deleteTexture(tile.texture); gl.deleteBuffer(tile.buffer); gl.deleteVertexArray(tile.vao);
}
function installMesh(tile, mesh, markCoverage=true) {
  tile.count=mesh.length/8;
  if(mesh.length) {
    if(!tile.vao) {
      tile.vao=gl.createVertexArray(); tile.buffer=gl.createBuffer();
      gl.bindVertexArray(tile.vao); gl.bindBuffer(gl.ARRAY_BUFFER,tile.buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,32,0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,32,12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,3,gl.FLOAT,false,32,20);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,tile.buffer); gl.bufferData(gl.ARRAY_BUFFER,mesh,gl.STATIC_DRAW);
  }
  if(markCoverage)setCoverage(tile.pack,tile.x,tile.y,mesh.length>0);
}
function updateGeometry() {
  if(geometryBroken || geometryBusy || geometryUpload || !geometryJobs.length) return;
  const signature=geometryJobs.map(j=>j.key).sort().join(','), currentAnchor=anchor();
  if(signature===geometrySignature && currentAnchor===geometryAnchor) return;
  geometryBusy={id:++geometryId,generation,signature,anchor:currentAnchor,textureRevision};
  geometryWorker.postMessage({type:'build',id:geometryId,generation,eye:[...state.eye],tiles:geometryJobs.map(({key,pack,x,y})=>({key,x,y,pack:{...pack,available:undefined,tiles:undefined}}))});
}
function receiveGeometry({data}) {
  const request=geometryBusy; geometryBusy=null;
  if(!request || data.id!==request.id || data.generation!==generation) return;
  if(data.error) { failure=`Terrain refinement failed: ${data.error}`; geometryBroken=true; return; }
  const signature=geometryJobs.map(j=>j.key).sort().join(',');
  if(signature!==request.signature) return; // Tile selection changed while building.
  // Upload over several frames, then swap the whole conforming topology at once.
  geometryUpload={request,data,cursor:0,staged:new Map()};
}
function cancelGeometryUpload() {
  if(!geometryUpload)return;
  for(const tile of geometryUpload.staged.values()){gl.deleteBuffer(tile.buffer);gl.deleteVertexArray(tile.vao);}
  geometryUpload=null;
}
function uploadGeometry() {
  const upload=geometryUpload;if(!upload)return;
  if(upload.request.generation!==generation){cancelGeometryUpload();return;}
  const deadline=performance.now()+2;
  while(upload.cursor<upload.data.meshes.length) {
    const {key,vertices}=upload.data.meshes[upload.cursor++],tile=tiles.get(key);
    if(tile&&desired.has(key)) {
      const staged={...tile,vao:null,buffer:null,count:0};installMesh(staged,vertices,false);upload.staged.set(key,staged);
    }
    if(performance.now()>=deadline)return;
  }
  for(const [key,staged] of upload.staged) {
    const tile=tiles.get(key);
    if(tile&&desired.has(key)) {
      gl.deleteBuffer(tile.buffer);gl.deleteVertexArray(tile.vao);
      Object.assign(tile,{vao:staged.vao,buffer:staged.buffer,count:staged.count});setCoverage(tile.pack,tile.x,tile.y,tile.count>0);
    } else {gl.deleteBuffer(staged.buffer);gl.deleteVertexArray(staged.vao);}
  }
  // Textures may arrive during staging; schedule their meshes through the same
  // upload budget rather than performing an unbounded catch-up loop here.
  geometrySignature=upload.request.textureRevision===textureRevision?upload.request.signature:'';geometryAnchor=upload.request.anchor;
  splitVertices=upload.data.splitVertices;geometrySpacing=upload.data.spacing;geometryUpload=null;
}
function uploadTexture() {
  const task=textureUploads.shift();if(!task)return;
  const {job,bitmap,resolve}=task;
  try {
    if(job.generation!==generation||!desired.has(job.key))return;
    const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const tile={texture,buffer:null,vao:null,count:0,pack:job.pack,level:job.level,x:job.x,y:job.y};
    tiles.set(job.key,tile);
    // Queue geometry for the arriving texture through the budgeted mesh stage.
    // Invalidating the signature also covers arrival during a mesh swap.
    textureRevision++;geometrySignature='';
  } finally {bitmap.close();resolve();}
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
  const {pack}=job;
  try {
    const response=await fetchOK(`/api/tile/${pack.id}/${job.x}/${job.y}`,{signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(15000)])});
    // Explicit top-to-bottom flip: original bufferImage reverses JPEG rows.
    const bitmap=await createImageBitmap(await response.blob(), { imageOrientation:'flipY', colorSpaceConversion:'none' });
    if(job.generation!==generation || !desired.has(job.key)) { bitmap.close(); return; }
    await new Promise(resolve=>textureUploads.push({job,bitmap,resolve}));
    if(job.generation===generation){tileRetries.delete(job.key);if(!tileRetries.size&&failure==='Some imagery tiles could not load; retrying.')failure='';}
  } catch(error) {
    if(job.generation===generation&&!job.controller.signal.aborted) {
      const attempts=(tileRetries.get(job.key)?.attempts??0)+1,next=performance.now()+Math.min(30000,1000*2**attempts);
      tileRetries.set(job.key,{attempts,next});nextTileRetry=Math.min(nextTileRetry,next);
      failure='Some imagery tiles could not load; retrying.';console.warn(error.message);
    }
  }
}
function refreshTiles() {
  // Re-evaluate on horizontal movement AND altitude changes (250 m buckets).
  const cell=state.eye.map(v=>Math.floor(v*4)).join('/');
  if(performance.now()>=nextTileRetry){lastCell='';nextTileRetry=Infinity;}
  if(cell===lastCell) return; lastCell=cell;
  desired.clear(); queue=[];
  geometryJobs=selectTiles(packs,state.eye,terrain);
  for(const job of geometryJobs) {
    desired.add(job.key);
    const retry=tileRetries.get(job.key);
    if(retry&&retry.next>performance.now()){nextTileRetry=Math.min(nextTileRetry,retry.next);continue;}
    if(!tiles.has(job.key)&&!pending.has(`${generation}:${job.key}`)) queue.push({...job,generation});
  }
  for(const job of tileRequests.values())if(job.generation!==generation||!desired.has(job.key))job.controller.abort();
  for(const key of tileRetries.keys())if(!desired.has(key))tileRetries.delete(key);
  for(const [key,tile] of tiles) if(!desired.has(key)) { dispose(tile); tiles.delete(key); }
}
function pump() {
  if(disposed)return;
  while(active<4 && queue.length) {
    const job=queue.shift(), token=`${job.generation}:${job.key}`; pending.add(token); active++;
    job.controller=new AbortController();tileRequests.set(token,job);
    loadTile(job).finally(()=>{active--;pending.delete(token);tileRequests.delete(token);pump();});
  }
}

return {
  id:'flytastic',
  async init({model}) {
    const [catalog,elevation,tree]=await Promise.all([
      fetchOK('/api/catalog').then(r=>r.json()),fetchOK('/api/elevation').then(r=>r.arrayBuffer()),fetchOK('/api/tree').then(r=>r.arrayBuffer()),
    ]);
    terrain=new Terrain(elevation,tree,model.terrain);
    if(!gl)throw Error('WebGL 2 is unavailable. Enable graphics acceleration or try another browser.');
    prog=program();projectionLocation=gl.getUniformLocation(prog,'projection');cameraLocation=gl.getUniformLocation(prog,'camera');gl.enable(gl.DEPTH_TEST);
    levelLocation=gl.getUniformLocation(prog,'imageryLevel');gl.useProgram(prog);gl.uniform1i(gl.getUniformLocation(prog,'imagery'),0);
    snowEnabledLocation=gl.getUniformLocation(prog,'snowEnabled');snowLineLocation=gl.getUniformLocation(prog,'snowLine');
    geometryWorker=new Worker('/geometry-worker.js',{type:'module'});
    geometryWorker.onmessage=receiveGeometry;
    geometryWorker.onerror=event=>{geometryBusy=null;geometryBroken=true;failure=`Terrain worker failed: ${event.message}`;};
    packs=LEVELS.map(({id})=>{
      const pack=catalog.find(p=>p.id===id);if(!pack)throw Error(`Imagery pack ${id} is missing.`);
      return {...pack,available:new Set(pack.tiles.map(([x,y])=>`${x}/${y}`))};
    });
    geometryWorker.postMessage({type:'init',elevation,tree,metadata:model.terrain});
    createCoverage(packs.find(p=>p.id==='D'),1);createCoverage(packs.find(p=>p.id==='C'),2);
  },
  setWinter(enabled,line){winter=enabled;snowLine=line;},
  prepare:async(east,north)=>terrain.ground(east,north),
  ground:(east,north)=>terrain.ground(east,north),
  reset(pose) {
    state=pose;generation++;failure='';lastCell='';tileRetries.clear();nextTileRetry=Infinity;
    geometrySignature='';geometryAnchor='';splitVertices=0;geometrySpacing=0;cancelGeometryUpload();
    for(const tile of tiles.values())dispose(tile);tiles.clear();refreshTiles();pump();
  },
  frame(pose,now) {
    state=pose;
    const dpr=Math.min(devicePixelRatio,2),w=Math.round(canvas.clientWidth*dpr),h=Math.round(canvas.clientHeight*dpr);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
  refreshTiles();pump();uploadTexture();uploadGeometry();updateGeometry();
  gl.clearColor(.56,.68,.73,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(prog);
  gl.uniform1i(snowEnabledLocation,winter?1:0);gl.uniform1f(snowLineLocation,snowLine);
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

    if(now-lastGlCheck>1000){glError=gl.getError();lastGlCheck=now;}
    const loading=active+queue.length+Number(Boolean(geometryBusy))+Number(Boolean(geometryUpload));
    return {renderer:'flytastic-webgl2',tiles:tiles.size,levels,triangles,loading,geometrySpacing,splitVertices,error:failure,glError,
      description:`E ${levels.E} · D ${levels.D} · C ${levels.C} tiles · ${Math.round(triangles/1000)}k triangles · ${geometrySpacing||'—'} m`};
  },
  diagnostics() {
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),width:canvas.width,height:canvas.height,
      terrain:'Original 100 m ground grid',imagery:'Original Flytastic imagery',fovDegrees:60};
  },
  dispose() {
    disposed=true;geometryWorker?.terminate();cancelGeometryUpload();
    for(const job of tileRequests.values())job.controller.abort();
    for(const task of textureUploads){task.bitmap.close();task.resolve();}textureUploads.length=0;
    for(const tile of tiles.values())dispose(tile);tiles.clear();
    for(const mask of coverage.values())gl.deleteTexture(mask.texture);coverage.clear();gl.deleteProgram(prog);
  },
};
}
