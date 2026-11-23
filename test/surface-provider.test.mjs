import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceProvider } from '../public/surface-provider.js';

test('surface cache survives Cesium buffer transfers and avoids repeated worker jobs',async()=>{
  const original=globalThis.Worker;let worker;
  globalThis.Worker=class {
    jobs=[];
    constructor(){worker=this;}
    postMessage(job){this.jobs.push(job);}
    terminate(){}
  };
  let provider;
  try {
    provider=createSurfaceProvider({HeightmapTerrainData:class {constructor(options){Object.assign(this,options);}}},{});
    const first=provider.requestTileGeometry(10,20,14);
    const heights=new Float32Array(65**2).fill(1234);
    worker.onmessage({data:{id:worker.jobs[0].id,heights,covered:1,raised:1,sourceTiles:1,maxRise:10}});
    const tile=await first;
    structuredClone(tile.buffer,{transfer:[tile.buffer.buffer]});
    const cached=await provider.requestTileGeometry(10,20,14);
    assert.equal(cached.buffer[0],1234);
    assert.equal(worker.jobs.length,1);
    assert.equal(cached.childTileMask,15);
    cached.buffer.fill(0);
    assert.equal((await provider.requestTileGeometry(10,20,14)).buffer[0],1234);
  }finally{provider?.dispose();globalThis.Worker=original;}
});
