import { averageSurface } from './surface-heights.js';
import { swissToWgs,wgsToSwiss } from './swiss-coordinates.js';

const fields=new Map(),catalogs=new Map(),fieldRequests=new Map();
let decoder;
function extent(points) {
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}
async function queryCatalog(x,y,signal) {
  // Share a 4 km catalog across overlapping Cesium parents and children.
  const bbox=extent([[-10,-10],[4010,-10],[-10,4010],[4010,4010]].map(([dx,dy])=>swissToWgs(x*4000+dx,y*4000+dy)));
  let url=`https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisssurface3d-raster/items?bbox=${bbox.join(',')}&limit=100`;
  const selected=new Map();let pages=0;
  while(url) {
    if(++pages>20)throw Error('Surface catalog exceeded the bounded query size');
    const response=await fetch(url,{signal});if(!response.ok)throw Error(`Surface catalog HTTP ${response.status}`);
    const page=await response.json();
    for(const item of page.features)for(const asset of Object.values(item.assets)) {
      if(asset.gsd!==.5||asset['proj:epsg']!==2056||!asset.href.endsWith('.tif'))continue;
      const cell=item.id.split('_').at(-1),date=item.properties.datetime;
      if(!selected.has(cell)||date>selected.get(cell).date)selected.set(cell,{cell,date,url:asset.href});
    }
    const next=page.links.find(link=>link.rel==='next');url=next?new URL(next.href,url).href:null;
  }
  return [...selected.values()];
}
async function catalog(bounds,signal) {
  const [w,s,e,n]=bounds;
  const projected=extent([[w,s],[e,s],[w,n],[e,n],[(w+e)/2,s],[(w+e)/2,n]].map(([lon,lat])=>wgsToSwiss(lon,lat)));
  // Include neighboring 8 m samples for interpolation at raster boundaries.
  const [left,bottom,right,top]=projected.map((v,i)=>v+(i<2?-10:10));
  const queries=[];
  for(let x=Math.floor(left/4000);x<=Math.floor(right/4000);x++)for(let y=Math.floor(bottom/4000);y<=Math.floor(top/4000);y++) {
    const key=`${x}/${y}`;
    if(!catalogs.has(key)) {
      const request=queryCatalog(x,y,signal).catch(error=>{catalogs.delete(key);throw error;});
      catalogs.set(key,request);while(catalogs.size>64)catalogs.delete(catalogs.keys().next().value);
    }
    queries.push(catalogs.get(key));
  }
  const records=new Map();
  for(const record of (await Promise.all(queries)).flat()) {
    const [x,y]=record.cell.split('-').map(Number),east=x*1000-2000000,north=y*1000-1000000;
    if(east>right||east+1000<left||north>top||north+1000<bottom)continue;
    if(!records.has(record.cell)||record.date>records.get(record.cell).date)records.set(record.cell,record);
  }
  return [...records.values()];
}
async function readField(record,signal) {
  if(fields.has(record.url)){const field=fields.get(record.url);fields.delete(record.url);fields.set(record.url,field);return field;}
  if(!decoder)decoder=import('/vendor/geotiff/geotiff.js').then(()=>globalThis.GeoTIFF);
  const {fromUrl}=await decoder,tiff=await fromUrl(record.url,{allowFullFile:false,blockSize:65536,cacheSize:16},signal);
  const base=await tiff.getImage(),bounds=base.getBoundingBox();let image=base;
  for(let i=1;i<await tiff.getImageCount();i++) {
    const candidate=await tiff.getImage(i),spacing=(bounds[2]-bounds[0])/candidate.getWidth();
    if(spacing<=8&&candidate.getWidth()<image.getWidth())image=candidate;
  }
  const raster=await image.readRasters({samples:[0],interleave:true,signal});signal.throwIfAborted();
  const field=averageSurface(raster,image.getWidth(),image.getHeight(),bounds,base.getGDALNoData());
  fields.set(record.url,field);while(fields.size>96)fields.delete(fields.keys().next().value);
  return field;
}
export async function loadSurfaceFields(bounds,signal) {
  const records=await catalog(bounds,signal),result=new Map();let cursor=0;
  await Promise.all(Array.from({length:2},async()=>{
    while(cursor<records.length){
      signal.throwIfAborted();const record=records[cursor++];
      if(!fieldRequests.has(record.url))fieldRequests.set(record.url,readField(record,signal).finally(()=>fieldRequests.delete(record.url)));
      result.set(record.cell,await fieldRequests.get(record.url));
    }
  }));
  return {fields:result,sourceTiles:records.length,cachedFields:fields.size};
}
