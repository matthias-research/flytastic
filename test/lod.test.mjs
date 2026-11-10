import test from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog, DEFAULT_DATA } from '../lib/data.mjs';
import { LEVELS, selectTiles, coverageIndex, START_CLEARANCE } from '../public/lod.js';
import { tileBounds } from '../public/terrain.js';

test('imagery refines near terrain, coarsens with altitude, and skips sparse entries',async()=>{
  const catalog=await readCatalog(process.env.FLYTASTIC_DATA||DEFAULT_DATA);
  const packs=LEVELS.map(({id})=>{
    const pack=catalog.find(p=>p.id===id);
    return {...pack,available:new Set(pack.tiles.map(([x,y])=>`${x}/${y}`))};
  });
  const terrain={ground:()=>1};
  const near=selectTiles(packs,[632,1+START_CLEARANCE,-173],terrain);
  const medium=selectTiles(packs,[632,10,-173],terrain);
  const high=selectTiles(packs,[632,20,-173],terrain);
  assert.ok(near.some(j=>j.pack.id==='C'));
  assert.ok(medium.some(j=>j.pack.id==='D'));
  assert.ok(medium.every(j=>j.pack.id!=='C'));
  assert.ok(high.length>0 && high.every(j=>j.pack.id==='E'));
  assert.ok(near.length<=49+81+49,'resident tile selection stays bounded');
  assert.equal(new Set(near.map(j=>j.key)).size,near.length);
  for(const job of near){
    assert.ok(job.pack.available.has(`${job.x}/${job.y}`));
    if(job.level)assert.ok(job.distance<=LEVELS[job.level].distance);
    assert.ok(coverageIndex(job.pack,job.x,job.y)>=0);
  }
  const c=packs.find(p=>p.id==='C');
  c.available.clear();
  const sparse=selectTiles(packs,[632,1.65,-173],terrain);
  assert.ok(sparse.every(j=>j.pack.id!=='C'));
  assert.ok(sparse.some(j=>j.pack.id==='E')&&sparse.some(j=>j.pack.id==='D'));
  assert.equal(coverageIndex(c,c.minX,c.minY),0);
  assert.equal(coverageIndex(c,c.maxX,c.maxY),(c.maxX-c.minX+1)*(c.maxY-c.minY+1)-1);
  // Preserve each original scale factor; E is not an exact dyadic parent of D.
  const e=packs.find(p=>p.id==='E'),d=packs.find(p=>p.id==='D');
  assert.notEqual(tileBounds(e,79,21)[0],tileBounds(d,158,42)[0]);
});
