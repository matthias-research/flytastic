// Quantized-mesh 1.0 reader for the surface worker. fetch() decompresses HTTP.
export function decodeQuantizedMesh(buffer, z, x, y) {
  const view=new DataView(buffer);
  if(buffer.byteLength<92)throw Error('Truncated terrain header');
  const minimum=view.getFloat32(24,true), maximum=view.getFloat32(28,true);
  const count=view.getUint32(88,true);
  if(!count || count>1000000 || 92+count*6>buffer.byteLength || !Number.isFinite(minimum+maximum) || maximum<minimum)throw Error('Invalid terrain vertices');
  let offset=92;
  const arrays=[];
  for(let axis=0;axis<3;axis++) {
    const values=new Uint16Array(count); let previous=0;
    for(let i=0;i<count;i++,offset+=2) {
      const code=view.getUint16(offset,true); previous+=(code>>>1)^-(code&1);
      if(previous<0 || previous>32767)throw Error('Invalid quantized coordinate');
      values[i]=previous;
    }
    arrays.push(values);
  }
  const bytes=count>65536?4:2;
  offset=Math.ceil(offset/bytes)*bytes;
  if(offset+4>buffer.byteLength)throw Error('Truncated terrain indices');
  const triangles=view.getUint32(offset,true); offset+=4;
  if(triangles>2000000 || offset+triangles*3*bytes>buffer.byteLength)throw Error('Invalid terrain triangles');
  const indices=new Uint32Array(triangles*3); let highest=0;
  for(let i=0;i<indices.length;i++,offset+=bytes) {
    const code=bytes===2?view.getUint16(offset,true):view.getUint32(offset,true);
    const index=highest-code;
    if(index<0 || index>=count)throw Error('Invalid terrain index');
    indices[i]=index; if(code===0)highest++;
  }
  const size=180/2**z;
  return {u:arrays[0],v:arrays[1],h:arrays[2],indices,minimum,maximum,
    bounds:[x*size-180,y*size-90,(x+1)*size-180,(y+1)*size-90]};
}

