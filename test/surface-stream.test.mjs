import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSurfaceFields } from '../public/surface-stream.js';
import { swissToWgs } from '../public/swiss-coordinates.js';

test('overlapping terrain requests share regional catalogs and failed catalogs can retry',async()=>{
  const original=globalThis.fetch,requests=[];
  let fail=false;
  globalThis.fetch=async url=>{
    requests.push(url);
    if(fail)throw Error('temporary network failure');
    await new Promise(resolve=>setTimeout(resolve,5));
    return {ok:true,json:async()=>({features:[],links:[]})};
  };
  const bounds=(east,north)=>{
    const [lon,lat]=swissToWgs(east,north);return [lon-.001,lat-.001,lon+.001,lat+.001];
  };
  try {
    const signal=AbortSignal.timeout(5000);
    const results=await Promise.all([loadSurfaceFields(bounds(634000,174000),signal),loadSurfaceFields(bounds(634050,174050),signal)]);
    assert.equal(requests.length,1,'Concurrent adjacent tiles share one request');
    assert.ok(results.every(result=>result.fields.size===0));
    fail=true;
    await assert.rejects(loadSurfaceFields(bounds(626000,102000),signal),/temporary network failure/);
    fail=false;
    await loadSurfaceFields(bounds(626000,102000),signal);
    assert.equal(requests.length,3,'A rejected catalog does not poison the cache');
  }finally{globalThis.fetch=original;}
});
