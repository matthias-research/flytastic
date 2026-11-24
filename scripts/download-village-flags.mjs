import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequester} from './lib/wikimedia.mjs';
import {planVillageImages,normalizeTitle,originalImageUrl,completeVillageCatalogue,VILLAGE_QUERY} from './lib/village-images.mjs';

const folder='.local/village-flags',args=new Set(process.argv.slice(2));
if([...args].some(arg=>!['--refresh','--plan-only','--png'].includes(arg)))throw Error('Usage: node scripts/download-village-flags.mjs [--refresh] [--plan-only] [--png]');
const pngMode=args.has('--png');
await mkdir(`${folder}/svg`,{recursive:true});
await mkdir(`${folder}/images`,{recursive:true});
const json=async file=>JSON.parse(await readFile(file,'utf8'));
async function atomic(file,value){await writeFile(`${file}.tmp`,JSON.stringify(value,null,2)+'\n');await rename(`${file}.tmp`,file);}
let cooldown=0;
try{cooldown=(await json(`${folder}/cooldown.json`)).nextRequestAt;}catch(e){if(e.code!=='ENOENT')throw e;}
const request=createRequester({initialCooldown:cooldown,onCooldown:nextRequestAt=>atomic(`${folder}/cooldown.json`,{nextRequestAt}),
  minimumGap:url=>url.hostname==='upload.wikimedia.org'&&url.pathname.toLowerCase().endsWith('.svg')?125000:1000,
  retryFloor:url=>url.hostname==='upload.wikimedia.org'&&url.pathname.toLowerCase().endsWith('.svg')?630000:0});
const catalogFile=`${folder}/wikidata.json`;
let catalogue;
try{if(args.has('--refresh'))throw Object.assign(Error(),{code:'ENOENT'});catalogue=await json(catalogFile);}
catch(e){
  if(e.code!=='ENOENT')throw e;
  const url=new URL('https://query.wikidata.org/sparql');url.search=new URLSearchParams({format:'json',query:VILLAGE_QUERY});
  catalogue=await(await request(url)).json();
  if(!Array.isArray(catalogue.results?.bindings))throw Error('Invalid Wikidata catalogue');
  await atomic(catalogFile,catalogue);
}
if(!Array.isArray(catalogue.results?.bindings)||catalogue.results.bindings.length<1000)throw Error('Incomplete Swiss image catalogue');
const [places,identities,base,credits,overrides]=await Promise.all([
  json('public/overlays/villages.json'),json('data/place-identities.json'),json('public/overlays/flags.json'),
  json('public/overlays/flag-credits.json'),json('data/village-flag-overrides.json'),
]);
await completeVillageCatalogue(catalogue,identities.identities,request,value=>atomic(catalogFile,value));
const plan=planVillageImages({places:places.places,identities:identities.identities,catalogue:catalogue.results.bindings,base,credits:credits.flags,overrides:overrides.places});
let saved={assets:{}};
try{saved=await json(`${folder}/manifest.json`);}catch(e){if(e.code!=='ENOENT')throw e;}
const assets=saved.assets;
const source={endpoint:'https://query.wikidata.org/sparql',query:VILLAGE_QUERY,additionalQueries:catalogue.additionalQueries||[],retrievedAt:(await stat(catalogFile)).mtime.toISOString(),sha256:createHash('sha256').update(await readFile(catalogFile)).digest('hex'),identitySource:identities.source};
const manifest={format:'village-image-download-v1',source,...plan,assets};
const save=()=>atomic(`${folder}/manifest.json`,manifest);
await save();
const needed=[...new Set(plan.candidates.filter(c=>!c.baseRegion).map(c=>c.filename))];
console.log(JSON.stringify({places:places.places.length,overrides:plan.candidates.length,newImages:needed.length,reusedImages:plan.candidates.filter(c=>c.baseRegion).length,fallbacks:plan.counts},null,2));
if(args.has('--plan-only'))process.exit(0);
// Batch source/licence metadata, retaining redirects so the original requested
// title remains the cache key. Only missing originals are fetched afterwards.
const missing=needed.filter(title=>!assets[title]?.source||(pngMode&&assets[title]?.status!=='downloaded'&&!assets[title]?.source.thumburl));
for(let offset=0;offset<missing.length;offset+=50) {
  const titles=missing.slice(offset,offset+50),url=new URL('https://commons.wikimedia.org/w/api.php');
  url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',maxlag:'5',redirects:'1',
    titles:titles.map(t=>`File:${t}`).join('|'),prop:'imageinfo',iiprop:'url|mime|timestamp|sha1|extmetadata',...(pngMode?{iiurlwidth:'120'}:{})});
  const result=await(await request(url)).json();
  if(result.error||!Array.isArray(result.query?.pages))throw Error(result.error?.info||'Invalid Commons metadata');
  const redirects=new Map([...(result.query.normalized||[]),...(result.query.redirects||[])].map(r=>[normalizeTitle(r.from),normalizeTitle(r.to)]));
  const pages=new Map(result.query.pages.map(p=>[normalizeTitle(p.title),p]));
  for(const title of titles) {
    let resolved=title;const seen=new Set();
    while(redirects.has(resolved)&&!seen.has(resolved)){seen.add(resolved);resolved=redirects.get(resolved);}
    const source=pages.get(resolved)?.imageinfo?.[0];
    assets[title]=source?.mime==='image/svg+xml'&&source.extmetadata?.LicenseShortName?.value
      ?{status:'pending',source}:{status:'unavailable',reason:'Original SVG or licence metadata missing'};
  }
  await save();console.log(`Source metadata: ${Math.min(offset+50,missing.length)}/${missing.length}`);
}
let done=0;
for(const title of needed) {
  const entry=assets[title];if(!entry?.source)continue;
  const hash=createHash('sha256').update(title).digest('hex').slice(0,24);
  if(entry.sha256&&/^(?:svg|images)\/[a-f0-9]{24}\.(?:svg|png)$/.test(entry.file)) {
    try{if(createHash('sha256').update(await readFile(`${folder}/${entry.file}`)).digest('hex')===entry.sha256){done++;continue;}}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const format=pngMode&&entry.source.thumburl?'png':'svg';
  const url=originalImageUrl(format==='png'?entry.source.thumburl:entry.source.url);
  const relative=format==='png'?`images/${hash}.png`:`svg/${hash}.svg`,file=`${folder}/${relative}`;
  console.log(`[${done+1}/${needed.length}] Downloading ${title} (${format})`);
  const response=await request(url),bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>16*1024*1024)throw Error(`Image exceeds byte limit: ${title}`);
  if(format==='svg') {
    const svg=bytes.toString('utf8');
    if(!/<svg[\s>]/i.test(svg)||/<!doctype\s+html|<html[\s>]/i.test(svg))throw Error(`Invalid SVG: ${title}`);
    if(entry.source.sha1&&createHash('sha1').update(bytes).digest('hex')!==entry.source.sha1)throw Error(`Source SHA-1 mismatch: ${title}`);
  } else if(bytes.length<24||bytes.readBigUInt64BE(0)!==0x89504e470d0a1a0an||bytes.readUInt32BE(16)>2048||bytes.readUInt32BE(20)>2048)throw Error(`Invalid Wikimedia PNG: ${title}`);
  await writeFile(`${file}.tmp`,bytes);await rename(`${file}.tmp`,file);
  Object.assign(entry,{status:'downloaded',format,file:relative,sha256:createHash('sha256').update(bytes).digest('hex')});
  await save();done++;
}
console.log(`Finished: ${done} additional image assets cached; municipality files were reused.`);
