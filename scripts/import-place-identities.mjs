import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const input=process.argv[2];
if(!input)throw Error('Usage: node scripts/import-place-identities.mjs <original-osm-snapshot.json>');
const bytes=await readFile(input),envelope=JSON.parse(bytes),raw=envelope.data||envelope;
const places=JSON.parse(await readFile('public/overlays/villages.json','utf8')).places;
const nodes=new Map(raw.elements.filter(p=>p.type==='node').map(p=>[p.id,p]));
const identities=places.flatMap(p=>{
  const node=nodes.get(p.id),qid=node?.tags?.wikidata;
  if(!qid||!/^Q[1-9]\d*$/.test(qid))return [];
  if(node.lon!==p.longitude||node.lat!==p.latitude)throw Error(`Moved place ${p.id}: refresh identities and municipality assignments together`);
  return [[p.id,p.longitude,p.latitude,qid]];
});
await mkdir('data',{recursive:true});
await writeFile('data/place-identities.json',JSON.stringify({format:'osm-place-identities-v1',source:{endpoint:envelope.endpoint,query:envelope.query,osmBaseTimestamp:raw.osm3s?.timestamp_osm_base,sha256:createHash('sha256').update(bytes).digest('hex'),attribution:'© OpenStreetMap contributors',license:'ODbL-1.0'},identities},null,2)+'\n');
console.log(`Imported ${identities.length} exact OSM node/Wikidata identities.`);
