// Add smooth normals once when Cesium builds a mesh, never during rendering.
// Keep supplied normals, vertex compression, positions, and skirts intact.
export function addMeshNormals(C,mesh) {
  const source=mesh.encoding;
  if(source.hasVertexNormals)return mesh;
  const old=mesh.vertices,count=old.length/source.stride;
  const surfaceCount=mesh.vertexCountWithoutSkirts??count;
  const positions=new Float64Array(count*3),normals=new Float64Array(count*3);
  const position=new C.Cartesian3(),uv=new C.Cartesian2();
  const edgeNormals=new Map();
  for(let i=0;i<count;i++) {
    source.decodePosition(old,i,position);
    positions.set([position.x,position.y,position.z],i*3);
  }
  const indices=mesh.indices;
  for(let i=0;i<(mesh.indexCountWithoutSkirts??indices.length);i+=3) {
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ax=positions[b]-positions[a],ay=positions[b+1]-positions[a+1],az=positions[b+2]-positions[a+2];
    const bx=positions[c]-positions[a],by=positions[c+1]-positions[a+1],bz=positions[c+2]-positions[a+2];
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
    for(const j of [a,b,c]){normals[j]+=nx;normals[j+1]+=ny;normals[j+2]+=nz;}
  }
  const uvKey=i=>{source.decodeTextureCoordinates(old,i,uv);return `${uv.x.toFixed(5)}/${uv.y.toFixed(5)}`;};
  for(let i=0;i<surfaceCount;i++)edgeNormals.set(uvKey(i),i);
  // Skirts hide cracks; their vertical faces must not tilt the surface normals.
  for(let i=surfaceCount;i<count;i++) {
    const parent=edgeNormals.get(uvKey(i));
    if(parent!==undefined)normals.set(normals.subarray(parent*3,parent*3+3),i*3);
  }
  const encoding=C.TerrainEncoding.clone({...source,hasVertexNormals:true});
  const vertices=new Float32Array(count*encoding.stride),normal=new C.Cartesian3(),oct=new C.Cartesian2();
  // Normals follow the position/height/UV fields and precede geodetic normals.
  const prefix=source.stride-(source.hasGeodeticSurfaceNormals?3:0);
  for(let i=0;i<count;i++) {
    const j=i*3;
    normal.x=normals[j];normal.y=normals[j+1];normal.z=normals[j+2];
    if(C.Cartesian3.magnitudeSquared(normal)<1.e-20) {
      normal.x=positions[j];normal.y=positions[j+1];normal.z=positions[j+2];
    }
    if(normal.x*positions[j]+normal.y*positions[j+1]+normal.z*positions[j+2]<0)C.Cartesian3.negate(normal,normal);
    C.Cartesian3.normalize(normal,normal);C.AttributeCompression.octEncode(normal,oct);
    const from=i*source.stride,to=i*encoding.stride;
    vertices.set(old.subarray(from,from+prefix),to);
    vertices[to+prefix]=C.AttributeCompression.octPackFloat(oct);
    vertices.set(old.subarray(from+prefix,from+source.stride),to+prefix+1);
  }
  mesh.vertices=vertices;mesh.encoding=encoding;mesh.stride=encoding.stride;
  return mesh;
}

export function withTerrainNormals(C,provider) {
  const wrapped=new WeakSet();
  function wrapData(data) {
    if(!data||wrapped.has(data))return data;
    wrapped.add(data);
    const createMesh=data.createMesh;
    data.createMesh=function(options) {
      const result=createMesh.call(this,options);
      return result&&Promise.resolve(result).then(mesh=>addMeshNormals(C,mesh));
    };
    const upsample=data.upsample;
    if(upsample)data.upsample=function(...args) {
      const result=upsample.apply(this,args);
      return result&&Promise.resolve(result).then(wrapData);
    };
    return data;
  }
  return new Proxy(provider,{get(target,key) {
    if(key==='hasVertexNormals')return true;
    if(key==='requestTileGeometry')return (...args)=>{
      const result=target.requestTileGeometry(...args);
      return result&&Promise.resolve(result).then(wrapData);
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}
