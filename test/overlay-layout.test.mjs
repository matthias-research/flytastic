import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectLabel,overlaps,labelBox,parseElevation} from '../public/overlay-layout.js';
import {validatePlaceFlags} from '../public/overlay-flags.js';

test('original labels use the terrain camera projection and reject points behind it',()=>{
  const state={eye:[632,3,-173],yaw:0,pitch:0,roll:0};
  assert.deepEqual(projectLabel(state,[632,3,-174],1200,800),{x:600,y:400});
  assert.equal(projectLabel(state,[632,3,-172],1200,800),undefined);
  assert.ok(projectLabel(state,[632,4,-175],1200,800).y<400);
  assert.ok(projectLabel(state,[633,3,-175],1200,800).x>600);
});
test('label collisions include the flag and screen padding',()=>{
  const box=labelBox({x:500,y:400},100,true);
  assert.ok(overlaps(box,{left:490,right:510,top:352,bottom:360}));
  assert.equal(overlaps(box,{left:560,right:570,top:360,bottom:400}),false);
});
test('published elevations accept decimal metres and reject ambiguous strings',()=>{
  assert.equal(parseElevation('3299,5 m'),3299.5);
  assert.equal(parseElevation('4478'),4478);
  assert.equal(parseElevation(' 3299.5 m '),3299.5);
  for(const value of ['',null,'unknown','4478 ft','4;478',-5,99999])assert.equal(parseElevation(value),undefined);
});
test('local snapshots have peak elevations, flag coverage and reusable source credits',async()=>{
  const load=async file=>JSON.parse(await readFile(new URL(`../public/overlays/${file}`,import.meta.url),'utf8'));
  const [villages,peaks,manifest,credits]=await Promise.all(['villages.json','peaks.json','flags.json','flag-credits.json'].map(load));
  const flags=validatePlaceFlags(manifest,villages.places);
  assert.equal(villages.places.length,3676);assert.ok(flags.mapping.size>3500);
  assert.ok(peaks.places.length>1000);
  assert.ok(peaks.places.some(p=>/Matterhorn/.test(p.name)&&p.elevation>4400));
  assert.equal(peaks.source.license,'ODbL-1.0');
  assert.ok(credits.flags.every(f=>f.source&&f.license));
  assert.ok(peaks.places.every(p=>Number.isFinite(p.elevation)&&p.elevation>0&&p.elevation<5000));
});
