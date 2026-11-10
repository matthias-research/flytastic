import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain, WIDTH, HEIGHT, geometryDetail } from '../public/terrain.js';

function fixture() {
  const elevation=new ArrayBuffer(WIDTH*HEIGHT*2), tree=new ArrayBuffer(WIDTH*HEIGHT);
  const heights=new DataView(elevation);
  for(let x=150;x<300;x++) for(let y=150;y<300;y++) {
    heights.setInt16((x*HEIGHT+y)*2,1000+(x%17)*60+(y%13)*30,true);
  }
  new Uint8Array(tree).fill(15);
  return new Terrain(elevation,tree);
}
const bounds=[500.13,89.27,508.17,97.31];
const key=v=>v.map(n=>n.toFixed(4)).join(',');

test('approaching terrain adds geometry and reaches the 100 m source grid',()=>{
  const terrain=fixture(), near=[503,terrain.ground(503,93)+.65,-93], far=[503,20,-93];
  const fine=terrain.mesh(bounds,24,0,terrain.refinement(near,bounds));
  const coarse=terrain.mesh(bounds,24,0,terrain.refinement(far,bounds));
  assert.ok(fine.length>coarse.length*2);
  let sourceGridEdge=false;
  for(let i=0;i<fine.length;i+=15) {
    const distance=Math.hypot(fine[i]-fine[i+5],fine[i+2]-fine[i+7]);
    if(Math.abs(distance-.1)<.0001) sourceGridEdge=true;
  }
  assert.ok(sourceGridEdge,'fine mesh includes edges spaced at the 100 m source resolution');
  assert.equal(geometryDetail(.65).spacing,100);
  assert.equal(geometryDetail(30).spacing,800);
});

test('shared adaptive topology has no unmatched interior edges or imagery boundary heights',()=>{
  const terrain=fixture(), eye=[503,2.3,-93], refinement=terrain.refinement(eye,bounds);
  const mesh=terrain.mesh(bounds,24,0,refinement), edges=new Map();
  for(let i=0;i<mesh.length;i+=15) {
    const v=[0,5,10].map(o=>[mesh[i+o],mesh[i+o+1],-mesh[i+o+2]]);
    const area=(v[1][0]-v[0][0])*(v[2][2]-v[0][2])-(v[2][0]-v[0][0])*(v[1][2]-v[0][2]);
    if(Math.abs(area)<1e-8) continue;
    for(let j=0;j<3;j++) {
      const a=v[j],b=v[(j+1)%3],k=[key(a),key(b)].sort().join('/');
      const edge=edges.get(k)||{count:0,a,b};edge.count++;edges.set(k,edge);
    }
  }
  for(const {count,a,b} of edges.values()) {
    if(count===2) continue;
    const boundary=[0,2].some((axis,i)=>[bounds[i],bounds[i+2]].some(edge=>Math.abs(a[axis]-edge)<.0001&&Math.abs(b[axis]-edge)<.0001));
    assert.ok(count===1&&boundary,`unmatched interior edge: ${key(a)} to ${key(b)} (${count})`);
  }
  const split=503.17;
  const boundarySegments=b=>{
    const m=terrain.mesh(b,24,0,refinement), segments=new Set();
    for(let i=0;i<m.length;i+=15)for(let j=0;j<3;j++) {
      const a=i+j*5, c=i+((j+1)%3)*5;
      if(Math.abs(m[a]-split)>.0001||Math.abs(m[c]-split)>.0001)continue;
      const va=[m[a+1],m[a+2]],vb=[m[c+1],m[c+2]];
      if(key(va)!==key(vb))segments.add([key(va),key(vb)].sort().join('/'));
    }
    return [...segments].sort();
  };
  assert.deepEqual(boundarySegments([bounds[0],bounds[1],split,bounds[3]]),boundarySegments([split,bounds[1],bounds[2],bounds[3]]));
});
