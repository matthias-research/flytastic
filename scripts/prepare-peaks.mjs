import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseElevation} from '../public/overlay-layout.js';

// Explicit offline import: browser startup and ordinary builds never call Overpass.
const input=process.argv[2]||'.local/osm-peaks.json';
const endpoint=process.argv[3]||'https://overpass.osm.ch/api/interpreter';
const query='[out:json][timeout:25];node["natural"="peak"]["name"]["ele"](45.8,5.9,47.85,10.5);out body;';
const bytes=await readFile(input),raw=JSON.parse(bytes),retrievedAt=(await stat(input)).mtime.toISOString();
if(raw.remark||!Array.isArray(raw.elements)||!raw.osm3s?.timestamp_osm_base)throw Error('Incomplete OSM peak snapshot');
const places=[],seen=new Set();
for(const p of raw.elements) {
  const elevation=parseElevation(p.tags?.ele);
  if(p.type!=='node'||p.tags?.natural!=='peak'||!p.tags?.name||elevation===undefined)continue;
  if(!Number.isSafeInteger(p.id)||seen.has(p.id)||!Number.isFinite(p.lon)||!Number.isFinite(p.lat)||p.lon<5.9||p.lon>10.5||p.lat<45.8||p.lat>47.85)throw Error('Invalid peak');
  seen.add(p.id);places.push({id:p.id,name:p.tags.name,kind:'peak',longitude:p.lon,latitude:p.lat,elevation});
}
if(places.length<1000||!places.some(p=>/Matterhorn/.test(p.name)))throw Error('Unexpected peak coverage');
places.sort((a,b)=>b.elevation-a.elevation||a.id-b.id);
await mkdir('public/overlays',{recursive:true});
await writeFile('public/overlays/peaks.json',JSON.stringify({format:'flytastic-peaks-v1',source:{name:'OpenStreetMap',endpoint,query,coverage:'Switzerland and neighbouring mountains within the query rectangle; not an administrative country extract',sourceBaseVersion:raw.osm3s.timestamp_osm_base,retrievedAt,preparedAt:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex'),attribution:'© OpenStreetMap contributors',attributionUrl:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0',licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/'},places},null,2)+'\n');
console.log(`Prepared ${places.length} named mountain peaks with published elevations.`);
