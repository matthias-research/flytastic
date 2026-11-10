import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_DATA, readCatalog, readTile } from '../lib/data.mjs';
import { Terrain, tileBounds, WIDTH, HEIGHT } from '../public/terrain.js';

test('original C++ column-major heights, clipping, UVs and no-data handling',()=>{
  const elevation=new ArrayBuffer(WIDTH*HEIGHT*2), tree=new ArrayBuffer(WIDTH*HEIGHT);
  const heights=new DataView(elevation);
  for(let x=0;x<20;x++)for(let y=0;y<20;y++)heights.setInt16((x*HEIGHT+y)*2,1000+x*10+y,true);
  const terrain=new Terrain(elevation,tree);
  assert.equal(terrain.height(2,3),1.023);
  assert.ok(Math.abs(terrain.ground(483.25,72.35)-1.0285)<1e-9);
  new Uint8Array(tree).fill(15);
  const mesh=terrain.mesh([483.2,72.2,484.2,73.2],24,4);
  assert.ok(mesh.length>0);
  for(let i=0;i<mesh.length;i+=5){
    assert.ok(mesh[i]>=483.1999&&mesh[i]<=484.2001);
    assert.ok(-mesh[i+2]>=72.1999&&-mesh[i+2]<=73.2001);
    assert.ok(mesh[i+3]>=-1e-5&&mesh[i+3]<=1.00001);
    assert.ok(mesh[i+4]>=-1e-5&&mesh[i+4]<=1.00001);
    assert.ok(mesh[i+1]>0);
  }
  assert.equal(terrain.mesh([800,200,808,208]).length,0);
  assert.throws(()=>new Terrain(new ArrayBuffer(1),tree),/dimensions/);
});

test('installed archives and terrain produce a valid original-data mesh',async()=>{
  const root=process.env.FLYTASTIC_DATA||DEFAULT_DATA;
  const packs=await readCatalog(root);
  assert.equal(packs.length,7);
  assert.equal(packs.reduce((n,p)=>n+p.tiles.length,0),16523);
  for(const pack of packs){
    const [x,y]=pack.tiles[Math.floor(pack.tiles.length/2)];
    const jpeg=await readTile(root,pack,x,y);
    assert.equal(jpeg.readUInt16BE(0),0xffd8);
    assert.equal(await readTile(root,pack,-1,0),null);
  }
  const elevation=await readFile(path.join(root,'elev100.dat')),tree=await readFile(path.join(root,'elevtree.dat'));
  const terrain=new Terrain(elevation.buffer.slice(elevation.byteOffset,elevation.byteOffset+elevation.length),tree.buffer.slice(tree.byteOffset,tree.byteOffset+tree.length));
  const pack=packs.find(p=>p.id==='E');
  const size=pack.divisor/pack.factor*512/1000;
  const x=Math.floor(632/size),y=Math.floor((173-pack.ystart/1000)/size);
  const bounds=tileBounds(pack,x,y),mesh=terrain.mesh(bounds);
  assert.ok(mesh.length>150);
  assert.ok(terrain.ground(632,173)>0);
  assert.ok([...mesh].every(Number.isFinite));
});
