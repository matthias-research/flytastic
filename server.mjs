import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_DATA, readCatalog, readTile } from './lib/data.mjs';
import { ORIGINAL_MODEL, SWISSTOPO_MODEL } from './public/models.js';

const root=process.env.FLYTASTIC_DATA||DEFAULT_DATA,port=Number(process.env.PORT||3000);
let packs=[];
try{packs=await readCatalog(root);}catch(error){console.warn(`Original dataset unavailable: ${error.message}\nSwisstopo streaming remains available.`);}
const publicRoot=new URL('./public/',import.meta.url),cesiumRoot=fileURLToPath(new URL('./node_modules/cesium/Build/Cesium/',import.meta.url));
const files=new Map([['/','index.html']]);
for(const name of ['app.js','models.js','terrain.js','geometry-worker.js','lod.js','math.js','camera-state.js','flight.js','flight-controls.js','frame-metrics.js','flight-terrain.js','swiss-coordinates.js','quantized-mesh.js','surface-heights.js','surface-stream.js','surface-tile.js','surface-worker.js','surface-provider.js','renderers/flytastic.js','renderers/cesium.js','style.css'])files.set(`/${name}`,name);
const mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',wasm:'application/wasm',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml'};
files.set('/snow.js','snow.js');
files.set('/terrain-normals.js','terrain-normals.js');
files.set('/place-search.js','place-search.js');
files.set('/map-navigation.js','map-navigation.js');
const server=http.createServer(async(req,res)=>{
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    const pathname=new URL(req.url,'http://localhost').pathname;
    let body,type;
    if(pathname==='/api/models'){
      body=JSON.stringify([{...ORIGINAL_MODEL,available:packs.length>0},{...SWISSTOPO_MODEL,available:true}]);type=mime.json;
    }else if(pathname==='/api/catalog'){
      body=JSON.stringify(packs.map(({index,...pack})=>pack));type=mime.json;
    }else if(pathname==='/api/elevation'||pathname==='/api/tree'){
      body=await readFile(path.join(root,pathname.endsWith('elevation')?'elev100.dat':'elevtree.dat'));type='application/octet-stream';
    }else if(/^\/api\/tile\/[C-I]\/\d+\/\d+$/.test(pathname)){
      const [,,,id,x,y]=pathname.split('/'),pack=packs.find(p=>p.id===id);body=pack&&await readTile(root,pack,+x,+y);type='image/jpeg';
    }else if(pathname==='/vendor/geotiff/geotiff.js'){
      body=await readFile(new URL('./node_modules/geotiff/dist-browser/geotiff.js',import.meta.url));type=mime.js;
    }else if(pathname.startsWith('/vendor/cesium/')){
      const relative=decodeURIComponent(pathname.slice('/vendor/cesium/'.length)),file=path.resolve(cesiumRoot,relative),inside=path.relative(cesiumRoot,file);
      if(inside.startsWith('..')||path.isAbsolute(inside)){res.writeHead(403).end('Forbidden');return;}
      body=await readFile(file);type=mime[path.extname(file).slice(1)]||'application/octet-stream';
    }else if(files.has(pathname)){
      const name=files.get(pathname);body=await readFile(new URL(name,publicRoot));type=mime[path.extname(name).slice(1)];
      if(pathname==='/'&&!packs.length)body=body.toString().replace('<option value="original">','<option value="original" disabled>').replace('<option value="swisstopo">','<option value="swisstopo" selected>');
    }
    if(body==null){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':type,'Content-Length':Buffer.byteLength(body),'Cache-Control':pathname.startsWith('/api/tile/')||pathname==='/api/elevation'||pathname==='/api/tree'?'private, max-age=3600':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch(error){
    if(error.code==='ENOENT'||error.code==='EISDIR'){res.writeHead(404).end('Not found');return;}
    console.error(error);res.writeHead(500,{'Content-Type':'text/plain'}).end('Could not load the landscape. Check the server terminal.');
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`Flytastic: http://localhost:${server.address().port}\nOriginal data: ${root}`));
