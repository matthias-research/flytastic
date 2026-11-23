import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cesium';
import { addMeshNormals,withTerrainNormals } from '../public/terrain-normals.js';
import { Terrain } from '../public/terrain.js';

test('original vertex normals follow the height gradient and agree across clipped tiles',()=>{
  const width=9,elevation=new ArrayBuffer(width*width*2),tree=new Uint8Array(width*width).fill(15);
  const heights=new DataView(elevation);
  for(let x=0;x<width;x++)for(let y=0;y<width;y++)heights.setInt16((x*width+y)*2,1000+20*x+10*y+5*x*x,true);
  const terrain=new Terrain(elevation,tree.buffer,{width,height:width,origin:[0,0],treeSize:8,treeDepth:6});
  const expected=new C.Cartesian3(-.6,1,.1);C.Cartesian3.normalize(expected,expected);
  const actual=terrain.normal(.4,.4);
  assert.ok(C.Cartesian3.distance(C.Cartesian3.fromArray(actual),expected)<1.e-10);
  const bounds=[.2,.2,.6,.6],refinement=terrain.refinement([.4,2,-.4],bounds);
  const left=terrain.mesh([.2,.2,.4,.6],6,0,refinement,true);
  const right=terrain.mesh([.4,.2,.6,.6],6,0,refinement,true);
  const edge=mesh=>{
    const normals=new Map();
    for(let i=0;i<mesh.length;i+=8) {
      const normal=mesh.slice(i+5,i+8);assert.ok(Math.abs(Math.hypot(...normal)-1)<1.e-6);
      if(Math.abs(mesh[i]-.4)<1.e-6)normals.set(mesh[i+2].toFixed(6),[...normal]);
    }
    return [...normals].sort();
  };
  assert.ok(edge(left).length>0);assert.deepEqual(edge(left),edge(right));
});

for(const span of [.001,.1])test(`Cesium smooth normals preserve terrain attributes and skirts (${span} degrees)`,()=>{
  const center=C.Cartesian3.fromDegrees(8,47),rectangle=C.Rectangle.fromDegrees(8,47,8+span,47+span);
  const result=C.HeightmapTessellator.computeVertices({heightmap:new Float32Array([0,20,0,20,100,20,0,20,0]),
    width:3,height:3,skirtHeight:100,nativeRectangle:new C.Rectangle(8,47,8+span,47+span),rectangle,
    relativeToCenter:center,includeWebMercatorT:true,exaggeration:2});
  const grid=C.TerrainProvider.getRegularGridAndSkirtIndicesAndEdgeIndices(3,3);
  const mesh={vertices:result.vertices,encoding:result.encoding,indices:grid.indices,
    indexCountWithoutSkirts:grid.indexCountWithoutSkirts,vertexCountWithoutSkirts:9};
  const old=mesh.vertices,source=mesh.encoding,count=old.length/source.stride;
  addMeshNormals(C,mesh);
  assert.equal(mesh.encoding.hasVertexNormals,true);assert.equal(mesh.stride,source.stride+1);
  for(let i=0;i<count;i++) {
    assert.deepEqual(mesh.encoding.decodePosition(mesh.vertices,i),source.decodePosition(old,i));
    assert.equal(mesh.encoding.decodeHeight(mesh.vertices,i),source.decodeHeight(old,i));
    assert.deepEqual(mesh.encoding.decodeTextureCoordinates(mesh.vertices,i),source.decodeTextureCoordinates(old,i));
    const oct=mesh.encoding.getOctEncodedNormal(mesh.vertices,i,new C.Cartesian2());
    const normal=C.AttributeCompression.octDecode(oct.x,oct.y,new C.Cartesian3());
    assert.ok(Math.abs(C.Cartesian3.magnitude(normal)-1)<1.e-10);
    assert.ok(C.Cartesian3.dot(normal,source.decodePosition(old,i))>0);
  }
  const normalAt=i=>{
    const oct=mesh.encoding.getOctEncodedNormal(mesh.vertices,i,new C.Cartesian2());
    return C.AttributeCompression.octDecode(oct.x,oct.y,new C.Cartesian3());
  };
  assert.ok(C.Cartesian3.distance(normalAt(0),normalAt(4))>.001,'Curved terrain has different normals at neighboring vertices');
  const uvKey=(encoding,vertices,i)=>JSON.stringify(encoding.decodeTextureCoordinates(vertices,i));
  for(let i=9;i<count;i++) {
    const parent=Array.from({length:9},(_,j)=>j).find(j=>uvKey(source,old,j)===uvKey(source,old,i));
    assert.notEqual(parent,undefined);assert.deepEqual(normalAt(i),normalAt(parent),'Skirt inherits its surface vertex normal');
  }
  const once=mesh.vertices;addMeshNormals(C,mesh);assert.equal(mesh.vertices,once,'Existing normals are reused');
});

test('normal provider preserves throttling, method receivers and upsampled data',async()=>{
  const mesh={encoding:{hasVertexNormals:true}};
  const child={createMesh:()=>Promise.resolve(mesh)};
  const data={createMesh:()=>Promise.resolve(mesh),upsample:()=>Promise.resolve(child)};
  const base={tag:'base',hasVertexNormals:false,requestTileGeometry(x){assert.equal(this,base);return x?Promise.resolve(data):undefined;}};
  const provider=withTerrainNormals(C,base);
  assert.equal(provider.hasVertexNormals,true);assert.equal(provider.requestTileGeometry(0),undefined);
  const tile=await provider.requestTileGeometry(1);
  assert.equal(await tile.createMesh({}),mesh);
  assert.equal(await (await tile.upsample()).createMesh({}),mesh);
});
