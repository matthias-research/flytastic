import { decodeQuantizedMesh } from './quantized-mesh.js';
import { loadSurfaceFields } from './surface-stream.js';
import { buildSurfaceTile } from './surface-tile.js';
import { TERRAIN_URL } from './models.js';

async function groundTile(level,x,y,signal) {
  for(let z=level;z>=0;z--,x=Math.floor(x/2),y=Math.floor(y/2)) {
    const response=await fetch(`${TERRAIN_URL}${z}/${x}/${y}.terrain`,{signal,headers:{Accept:'application/vnd.quantized-mesh,application/octet-stream;q=0.9'}});
    if(response.status===404||response.status===204)continue;
    if(!response.ok)throw Error(`Ground terrain HTTP ${response.status}`);
    return decodeQuantizedMesh(await response.arrayBuffer(),z,x,y);
  }
  throw Error('No ground terrain available');
}
self.onmessage=async({data:{id,x,y,level}})=>{
  const signal=AbortSignal.timeout(45000),size=180/2**level,bounds=[x*size-180,y*size-90,(x+1)*size-180,(y+1)*size-90];
  try {
    const [mesh,surface]=await Promise.all([groundTile(level,x,y,signal),loadSurfaceFields(bounds,signal)]);
    const result=buildSurfaceTile(mesh,bounds,surface.fields);
    self.postMessage({id,...result,sourceTiles:surface.sourceTiles},[result.heights.buffer]);
  } catch(error){self.postMessage({id,error:error.message});}
};
