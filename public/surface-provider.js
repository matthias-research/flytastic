// Adapt the streamed surface rasters to Cesium's public TerrainProvider API.
// Coarse terrain stays native; nearby tiles become worker-built heightmaps.
export function createSurfaceProvider(C,base) {
  const worker=new Worker('/surface-worker.js',{type:'module'}),pending=new Map(),cache=new Map();let nextId=0,disposed=false;
  // Cesium transfers height buffers to its mesh worker. Keep our own copy.
  const terrain=(heights,level)=>new C.HeightmapTerrainData({buffer:heights.slice(),width:65,height:65,childTileMask:level<16?15:0});
  const stats={tiles:0,covered:0,raised:0,sourceTiles:0,maxRise:0};
  worker.onmessage=({data})=>{
    const task=pending.get(data.id);if(!task)return;pending.delete(data.id);
    if(data.error){task.reject(Error(data.error));return;}
    stats.tiles++;stats.covered+=data.covered;stats.raised+=data.raised;stats.sourceTiles+=data.sourceTiles;stats.maxRise=Math.max(stats.maxRise,data.maxRise);
    cache.set(task.key,data.heights);while(cache.size>256)cache.delete(cache.keys().next().value);
    task.resolve(terrain(data.heights,task.level));
  };
  worker.onerror=error=>{for(const task of pending.values())task.reject(Error(error.message));pending.clear();};
  return {
    tilingScheme:base.tilingScheme,credit:base.credit,errorEvent:base.errorEvent,availability:base.availability,
    hasWaterMask:false,hasVertexNormals:false,
    getLevelMaximumGeometricError:level=>base.getLevelMaximumGeometricError(level),
    getTileDataAvailable:(x,y,level)=>level>16?false:base.getTileDataAvailable(x,y,level),
    loadTileDataAvailability:(x,y,level)=>base.loadTileDataAvailability(x,y,level),
    requestTileGeometry(x,y,level,request) {
      if(disposed)return undefined;
      if(level<13)return base.requestTileGeometry(x,y,level,request);
      const key=`${level}/${x}/${y}`;
      if(cache.has(key)) {
        const heights=cache.get(key);cache.delete(key);cache.set(key,heights);
        return Promise.resolve(terrain(heights,level));
      }
      if(pending.size>=4)return undefined; // Let Cesium reschedule, without a growing work queue.
      const id=++nextId;
      const promise=new Promise((resolve,reject)=>pending.set(id,{resolve,reject,level,key}));
      worker.postMessage({id,x,y:2**level-1-y,level});return promise;
    },
    stats,
    dispose(){disposed=true;worker.terminate();for(const task of pending.values())task.reject(Error('Surface provider disposed'));pending.clear();cache.clear();},
  };
}
