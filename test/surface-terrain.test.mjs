import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeQuantizedMesh } from '../public/quantized-mesh.js';
import { buildSurfaceTile } from '../public/surface-tile.js';
import { averageSurface,sampleSurface } from '../public/surface-heights.js';
import { swissToWgs,wgsToSwiss } from '../public/swiss-coordinates.js';

function encodedTile() {
  const buffer=new ArrayBuffer(132),v=new DataView(buffer);v.setFloat32(24,1000,true);v.setFloat32(28,1000,true);v.setUint32(88,4,true);
  let offset=92;
  for(const values of [[0,32767,0,32767],[0,0,32767,32767],[0,0,0,0]]) {
    let previous=0;for(const value of values){const delta=value-previous;v.setUint16(offset,(delta<<1)^(delta>>31),true);offset+=2;previous=value;}
  }
  v.setUint32(offset,2,true);offset+=4;
  for(const code of [0,0,0,2,0,2]){v.setUint16(offset,code,true);offset+=2;}return buffer;
}
test('surface tiles preserve ground without coverage and raise real sample footprints',()=>{
  const [lon,lat]=swissToWgs(632000,173000),z=14,size=180/2**z,x=Math.floor((lon+180)/size),y=Math.floor((lat+90)/size);
  const mesh=decodeQuantizedMesh(encodedTile(),z,x,y),empty=buildSurfaceTile(mesh,mesh.bounds,new Map());
  assert.ok(empty.heights.every(h=>h===1000));assert.equal(empty.raised,0);
  const fields=new Map();
  for(let x=2628;x<=2636;x++)for(let y=1168;y<=1176;y++)fields.set(`${x}-${y}`,{values:new Float32Array(125**2).fill(1020),width:125,height:125,bounds:[x*1000,y*1000,(x+1)*1000,(y+1)*1000]});
  const surface=buildSurfaceTile(mesh,mesh.bounds,fields);assert.equal(surface.raised,65*65);assert.ok(surface.heights.every(h=>h===1020));assert.ok(Math.abs(surface.maxRise-20)<1e-9);
  const child=[mesh.bounds[0],mesh.bounds[1],(mesh.bounds[0]+mesh.bounds[2])/2,(mesh.bounds[1]+mesh.bounds[3])/2];
  assert.ok(buildSurfaceTile(mesh,child,new Map()).heights.every(h=>h===1000),'Missing ground children can use the parent mesh');
});
test('quantized mesh rejects corrupt data and decodes south-up source indices',()=>{
  const mesh=decodeQuantizedMesh(encodedTile(),12,4274,3110);assert.deepEqual([...mesh.indices],[0,1,2,1,3,2]);
  assert.throws(()=>decodeQuantizedMesh(new ArrayBuffer(16),0,0,0),/Truncated/);
  assert.throws(()=>decodeQuantizedMesh(encodedTile().slice(0,-2),0,0,0),/triangles/);
});
test('surface footprints exclude NoData and interpolate across neighboring files',()=>{
  const field=averageSurface(new Float32Array([100,100,200,200,100,100,200,200,-9999,-9999,300,300,-9999,-9999,300,300]),4,4,[0,0,16,16]);
  assert.deepEqual([...field.values].map(v=>Number.isNaN(v)?null:v),[100,200,null,300]);
  const fields=new Map();
  for(const x of [2632,2633])fields.set(`${x}-1172`,{values:new Float32Array(125**2).fill(1020),width:125,height:125,bounds:[x*1000,1172000,(x+1)*1000,1173000]});
  assert.equal(sampleSurface(fields,633000,172500),1020);assert.equal(sampleSurface(fields,635000,172500),undefined);
});
test('Swiss projection retains published heights and roundtrips departures',()=>{
  for(const point of [[632000,173000],[625000,100000],[668000,213000]]) {
    const p=wgsToSwiss(...swissToWgs(...point),1234);assert.ok(Math.hypot(p[0]-point[0],p[1]-point[1])<.001);assert.equal(p[2],1234);
  }
});
