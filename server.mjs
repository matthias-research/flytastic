import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_DATA, readCatalog, readTile } from './lib/data.mjs';
import { ORIGINAL_MODEL, SWISS_ROOT, swissManifest, safeModelPath } from './lib/models.mjs';

const root = process.env.FLYTASTIC_DATA || DEFAULT_DATA;
const port = Number(process.env.PORT || 3000);
let packs;
try { packs = await readCatalog(root); }
catch (error) { console.error(`Cannot load Flytastic data from ${root}: ${error.message}\nSet FLYTASTIC_DATA to your GEODAT folder.`); process.exit(1); }
const publicRoot = new URL('./public/', import.meta.url);
const files = new Map([['/', 'index.html'], ['/app.js', 'app.js'], ['/terrain.js', 'terrain.js'], ['/geometry-worker.js', 'geometry-worker.js'], ['/lod.js', 'lod.js'], ['/math.js', 'math.js'], ['/camera-state.js', 'camera-state.js'], ['/flight.js', 'flight.js'], ['/flight-controls.js', 'flight-controls.js'], ['/style.css', 'style.css']]);
const mime = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
    const modelId=url.searchParams.get('model')||'original';
    if(pathname.startsWith('/api/')&&!['original','swisstopo'].includes(modelId)){res.writeHead(400);res.end('Unknown model');return;}
    let body, type, encoding;
    if(pathname==='/api/models') {
      let available=false;try{await swissManifest();available=true;}catch(error){if(error.code!=='ENOENT')console.error(error.message);}
      body=JSON.stringify([{id:'original',name:'Original Flytastic',available:true},{id:'swisstopo',name:'Swisstopo · Interlaken pilot',available}]);type='application/json';
    } else if(pathname==='/api/model') {
      if(modelId==='original')body=JSON.stringify(ORIGINAL_MODEL);
      else {const {id,name,attribution,bounds,terrain,buildId}=await swissManifest();body=JSON.stringify({id,name,attribution,bounds,terrain,version:buildId,pilot:true});}
      type='application/json';
    } else if (pathname === '/api/catalog') {
      body = JSON.stringify(modelId==='original'?packs.map(({ index, ...pack }) => pack):(await swissManifest()).packs); type = 'application/json';
    } else if (pathname === '/api/elevation' || pathname === '/api/tree') {
      const name = pathname.endsWith('elevation') ? 'elev100.dat' : 'elevtree.dat';
      if(modelId==='original')body = await readFile(path.join(root, name));
      else {body=await readFile(path.join(SWISS_ROOT,'terrain',pathname.endsWith('elevation')?'10/heights.bin.gz':'errors.bin.gz'));encoding='gzip';}
      type = 'application/octet-stream';
    } else if (/^\/api\/tile\/[C-I]\/\d+\/\d+$/.test(pathname)) {
      const [, , , id, x, y] = pathname.split('/');
      if(modelId==='original') {
        const pack = packs.find(p => p.id === id);
        body = pack && await readTile(root, pack, +x, +y); type = 'image/jpeg';
      } else {
        const pack=(await swissManifest()).packs.find(p=>p.id===id),file=pack?.tileFiles[`${+x}/${+y}`];
        if(file){body=await readFile(safeModelPath(path.join(SWISS_ROOT,'imagery'),file));type=file.endsWith('.png')?'image/png':'image/jpeg';}
      }
    } else if (files.has(pathname)) {
      const name = files.get(pathname); body = await readFile(fileURLToPath(new URL(name, publicRoot))); type = mime[name.split('.').at(-1)];
    }
    if (body == null) { res.writeHead(404); res.end('Not found'); return; }
    const headers={ 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': pathname.startsWith('/api/tile/')||pathname==='/api/elevation'||pathname==='/api/tree' ? 'private, max-age=3600' : 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if(encoding)headers['Content-Encoding']=encoding;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error(error); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Could not load local Flytastic data. Check the server terminal.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Flytastic: http://localhost:${port}\nData: ${root}`));
