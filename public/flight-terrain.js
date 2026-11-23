import { swissToWgs } from './swiss-coordinates.js';

// Loaded Cesium heights serve flight synchronously. Missing look-ahead samples
// are fetched in bounded batches, so terrain following never blocks a frame.
export function createFlightTerrain(C,viewer,departureProvider=viewer.terrainProvider) {
  const cache=new Map(),queued=new Map(),spacing=4e-6;
  let pending=false,nextRequest=0,disposed=false;
  const key=p=>`${Math.round(p.longitude/spacing)}/${Math.round(p.latitude/spacing)}`;
  const point=(east,north)=>C.Cartographic.fromDegrees(...swissToWgs(east*1000,north*1000));
  return {
    async prepare(east,north) {
      // Start above ground immediately; surface refinement arrives during rendering.
      const [p]=await C.sampleTerrain(departureProvider,14,[point(east,north)]);
      if(!Number.isFinite(p.height))throw Error('No terrain height is available at this departure');
      cache.set(key(p),p.height);return p.height/1000;
    },
    ground(east,north) {
      const p=point(east,north),loaded=viewer.scene.globe.getHeight(p);if(Number.isFinite(loaded))return loaded/1000;
      const k=key(p);if(cache.has(k))return cache.get(k)/1000;
      if(queued.size<64)queued.set(k,p);return undefined;
    },
    update(now) {
      if(disposed||pending||now<nextRequest||!queued.size)return;
      const batch=[...queued],provider=viewer.terrainProvider;queued.clear();pending=true;nextRequest=now+500;
      C.sampleTerrain(provider,14,batch.map(([,p])=>p)).then(points=>{
        if(disposed||provider!==viewer.terrainProvider)return;
        points.forEach((p,i)=>{if(Number.isFinite(p.height))cache.set(batch[i][0],p.height);});
        while(cache.size>512)cache.delete(cache.keys().next().value);
      }).catch(()=>{}).finally(()=>{pending=false;});
    },
    clear(){cache.clear();queued.clear();},
    dispose(){disposed=true;cache.clear();queued.clear();},
  };
}
