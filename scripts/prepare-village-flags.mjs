import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {validatePlaceFlags,validateVillageFlags} from '../public/overlay-flags.js';

const cache='.local/village-flags',output='public/overlays';
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const [download,places,baseData]=await Promise.all([json(`${cache}/manifest.json`),json(`${output}/villages.json`),json(`${output}/flags.json`)]);
if(download.format!=='village-image-download-v1')throw Error('Invalid source manifest');
const base=validatePlaceFlags(baseData,places.places),current=new Map(places.places.map(p=>[p.id,p]));
const assets={},rows=[],sources=[],images=[],newImages=new Map();
const keyFor=title=>createHash('sha256').update(title).digest('hex').slice(0,24);
for(const p of download.candidates) {
  const place=current.get(p.id);
  if(!place||place.longitude!==p.longitude||place.latitude!==p.latitude)throw Error(`Stale place mapping: ${p.id}`);
  let key;
  if(p.baseRegion) {
    if(!base.regions.has(p.baseRegion))throw Error('Missing reusable municipality image');
    key=`bfs:${p.baseRegion}`;assets[key]={baseRegion:p.baseRegion,kind:p.kind};
    if(!images.some(c=>c.key===key))images.push({key,...p.credits});
  } else {
    const entry=download.assets[p.filename];
    if(entry?.status==='unavailable')continue;
    if(entry?.status!=='downloaded')throw Error(`Download incomplete: ${p.filename}. Rerun download-village-flags.mjs first.`);
    if(!/^(?:svg|images)\/[a-f0-9]{24}\.(?:svg|png)$/.test(entry.file))throw Error('Invalid cached image path');
    const bytes=await readFile(`${cache}/${entry.file}`);
    if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error(`Cached source checksum mismatch: ${p.filename}`);
    key=keyFor(p.filename);
    newImages.set(key,{key,filename:p.filename,kind:p.kind,bytes,entry,format:entry.format||'svg'});
  }
  rows.push([p.id,p.longitude,p.latitude,key]);
  sources.push({id:p.id,name:p.name,wikidata:p.wikidata,filename:p.filename,kind:p.kind,key,...(p.evidence?{evidence:p.evidence}:{})});
}
const columns=32,tileSize=48,width=columns*tileSize,height=Math.max(48,Math.ceil(newImages.size/columns)*tileSize);
if(height>4000)throw Error('Village image sheet exceeds supported size');
await mkdir(output,{recursive:true});
let sheet;
if(newImages.size) {
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({offline:true}),page=await context.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(({width,height})=>{window.sheet=document.createElement('canvas');window.sheet.width=width;window.sheet.height=height;},{width,height});
    let i=0;
    for(const {key,filename,kind,bytes,entry,format} of newImages.values()) {
      const x=i%columns*tileSize,y=Math.floor(i/columns)*tileSize;
      const result=await page.evaluate(async({svg,png,x,y,metadata})=>{
        let url;
        if(svg) {
          const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
          if(doc.querySelector('parsererror'))throw Error('Malformed SVG');
          for(const node of doc.querySelectorAll('foreignObject')) {
            if(node.textContent.trim()||[...node.children].some(child=>child.localName!=='pgfRef'))throw Error('Unexpected visible foreignObject');
            node.remove();
          }
          doc.querySelectorAll('metadata,script').forEach(node=>node.remove());
          url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)],{type:'image/svg+xml'}));
        } else {
          url=`data:image/png;base64,${png}`;
        }
        try {
          const image=new Image();image.src=url;await image.decode();
          if(!image.naturalWidth||!image.naturalHeight)throw Error('SVG has no intrinsic size');
          const canvas=document.createElement('canvas');canvas.width=canvas.height=48;
          const ctx=canvas.getContext('2d'),scale=44/Math.max(image.naturalWidth,image.naturalHeight);
          const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
          ctx.drawImage(image,(48-w)/2,(48-h)/2,w,h);
          const pixels=ctx.getImageData(0,0,48,48).data;
          let opaque=0,transparent=0;
          for(let j=3;j<pixels.length;j+=4){opaque+=pixels[j]>0;transparent+=pixels[j]===0;}
          if(!opaque||!transparent)throw Error('Empty image or missing transparent padding');
          window.sheet.getContext('2d').drawImage(canvas,x,y);
          const plain=value=>new DOMParser().parseFromString(value||'','text/html').body.textContent.trim();
          return {artist:plain(metadata.Artist?.value),license:plain(metadata.LicenseShortName?.value),licenseUrl:metadata.LicenseUrl?.value||'',credit:plain(metadata.Credit?.value)};
        }finally{URL.revokeObjectURL(url);}
      },{svg:format==='svg'?bytes.toString('utf8'):null,png:format==='png'?bytes.toString('base64'):null,x,y,metadata:entry.source.extmetadata}).catch(e=>{throw Error(`${filename}: ${e.message}`);});
      assets[key]={kind,rect:[x,y,48,48]};
      images.push({key,filename,kind,source:entry.source.descriptionurl,sourceSvg:entry.source.url,sourceImage:format==='png'?entry.source.thumburl:entry.source.url,sourceImageSha256:entry.sha256,originalSvgSha1:entry.source.sha1,...result,
        modification:format==='svg'?'Rasterized offline from original SVG into transparent 48 × 48 PNG; aspect ratio preserved with two-pixel padding. Non-rendering editor metadata/PGF references removed.':'Wikimedia-rendered PNG preview of the original SVG, resized offline into transparent 48 × 48 PNG; aspect ratio preserved with two-pixel padding.'});
      i++;if(i%50===0)console.log(`Converted ${i}/${newImages.size} village images`);
    }
    const bytes=Buffer.from(await page.evaluate(()=>window.sheet.toDataURL('image/png').split(',')[1]),'base64');
    const file=`village-flags-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.png`;
    await writeFile(`${output}/${file}`,bytes);sheet={file,width,height,tileSize};
  }finally{await browser.close();}
}
const manifest={format:'swiss-village-flags-v1',baseSheet:base.sheet.file,sheet:sheet||null,assets,places:rows};
validateVillageFlags(manifest,places.places,base);
const credits={source:download.source,places:sources,images,fallbacks:download.counts};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,title)=>/^https?:\/\//.test(url||'')?`<a href="${escape(url)}">${escape(title)}</a>`:escape(title);
const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Village image credits</title><style>body{font:16px/1.6 system-ui;max-width:1000px;margin:3rem auto;padding:1rem}li{margin:1rem 0}</style><h1>Village flags and coats of arms</h1><p>Images are associated with the individual settlement through its OpenStreetMap Wikidata identity or an explicitly reviewed mapping. Municipality images remain the fallback. <a href="/overlays/credits.html">Municipality credits</a></p><ul>'+sources.map(p=>{
  const c=images.find(c=>c.key===p.key);
  return `<li><strong>${escape(p.name)}</strong> — ${link(`https://www.wikidata.org/wiki/${p.wikidata}`,p.wikidata)}; ${link(c.source,'Original image')}; ${link(c.licenseUrl,c.license)}<br>Artist: ${escape(c.artist)}<br>${escape(c.credit)}<br>${escape(c.modification)}</li>`;
}).join('\n')+'</ul></html>\n';
await writeFile(`${output}/village-flag-credits.json`,JSON.stringify(credits,null,2)+'\n');
await writeFile(`${output}/village-flag-credits.html`,html);
const existing=await readFile(`${output}/credits.html`,'utf8');
const marker='<p><a href="/overlays/village-flag-credits.html">Village-specific flag and coat-of-arms credits</a></p>';
if(!existing.includes(marker))await writeFile(`${output}/credits.html`,existing.replace('<h1>Data and flag credits</h1>',`<h1>Data and flag credits</h1>${marker}`));
// Publish the manifest last: a failed conversion never replaces a working map.
await writeFile(`${output}/village-flags.json.tmp`,JSON.stringify(manifest,null,2)+'\n');
await rename(`${output}/village-flags.json.tmp`,`${output}/village-flags.json`);
console.log(JSON.stringify({places:rows.length,newImages:newImages.size,reusedImages:images.length-newImages.size,sheet},null,2));
