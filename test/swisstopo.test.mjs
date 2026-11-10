import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { SWISS_ROOT, swissManifest, safeModelPath } from '../lib/models.mjs';
import { Terrain, tileBounds } from '../public/terrain.js';

test('swisstopo pilot dimensions, heights, NoData, hierarchy and source provenance',async t=>{
  let manifest;
  try {manifest=await swissManifest();}catch(error){if(error.code==='ENOENT'){t.skip('Prepare the swisstopo pilot first');return;}throw error;}
  const elevation=gunzipSync(await readFile(path.join(SWISS_ROOT,'terrain/10/heights.bin.gz')));
  const errors=gunzipSync(await readFile(path.join(SWISS_ROOT,'terrain/errors.bin.gz')));
  const terrain=new Terrain(elevation.buffer.slice(elevation.byteOffset,elevation.byteOffset+elevation.length),errors.buffer.slice(errors.byteOffset,errors.byteOffset+errors.length),manifest.terrain);
  assert.equal(terrain.spacing,10);
  assert.equal(terrain.depth,20);
  assert.ok(manifest.coverage.imageryFraction>.999);
  assert.equal(manifest.coverage.terrainFraction,1);
  assert.ok(manifest.sourceFiles.length>0);
  for(const file of manifest.sourceFiles){assert.match(file.sha256,/^[0-9a-f]{64}$/);assert.equal(file.checksum.slice(4).toLowerCase(),file.sha256);}
  for(const point of manifest.heightChecks)assert.ok(Math.abs(terrain.ground(point.east/1000,point.north/1000)*1000-point.meters)<.001);
  assert.equal(terrain.height(1024,1024),0,'padded NoData is not a 6.5 km mountain');
  for(const level of manifest.terrainLevels.slice(1)) {
    const values=gunzipSync(await readFile(safeModelPath(path.join(SWISS_ROOT,'terrain'),level.file)));
    const step=level.spacingMeters/10;
    for(let x=0;x<level.width;x+=7)for(let y=0;y<level.height;y+=7){
      assert.equal(values.readUInt16LE((x*level.height+y)*2),elevation.readUInt16LE((x*step*manifest.terrain.height+y*step)*2));
    }
  }
  const bounds=[631,172,633,174];
  const near=terrain.refinement([632,terrain.ground(632,173)+.65,-173],bounds);
  const far=terrain.refinement([632,20,-173],bounds);
  assert.ok(terrain.mesh(bounds,terrain.depth,0,near).length>terrain.mesh(bounds,terrain.depth,0,far).length);
  for(const pack of manifest.packs){
    const [x,y]=pack.tiles[0],file=pack.tileFiles[`${x}/${y}`];
    const data=await readFile(safeModelPath(path.join(SWISS_ROOT,'imagery'),file));
    assert.ok(data.length>0);
    assert.deepEqual(tileBounds(pack,0,0).slice(0,2),manifest.bounds.slice(0,2));
  }
});

test('model file paths cannot escape their data directory',()=>{
  assert.throws(()=>safeModelPath(SWISS_ROOT,'../original/manifest.json'),/Invalid/);
});
