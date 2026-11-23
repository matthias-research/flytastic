import { wgsToSwiss } from './swiss-coordinates.js';
import { sampleSurface } from './surface-heights.js';

export const TILE_WIDTH=65;
// Cesium heightmaps are north-to-south, west-to-east. Rasterize the streamed
// ground mesh in the worker, then replace heights with the surface where valid.
export function buildSurfaceTile(mesh,bounds,fields,width=TILE_WIDTH) {
  const [west,south,east,north]=bounds,n=width-1,vertices=new Float64Array(mesh.u.length*3);
  const heights=new Float32Array(width*width);heights.fill(NaN);
  for(let i=0;i<mesh.u.length;i++) {
    vertices[3*i]=((mesh.bounds[0]+(mesh.bounds[2]-mesh.bounds[0])*mesh.u[i]/32767)-west)/(east-west)*n;
    vertices[3*i+1]=(north-(mesh.bounds[1]+(mesh.bounds[3]-mesh.bounds[1])*mesh.v[i]/32767))/(north-south)*n;
    vertices[3*i+2]=mesh.minimum+(mesh.maximum-mesh.minimum)*mesh.h[i]/32767;
  }
  for(let i=0;i<mesh.indices.length;i+=3) {
    const a=mesh.indices[i]*3,b=mesh.indices[i+1]*3,c=mesh.indices[i+2]*3;
    const ax=vertices[a],ay=vertices[a+1],bx=vertices[b],by=vertices[b+1],cx=vertices[c],cy=vertices[c+1];
    const d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(d)<1e-12)continue;
    for(let y=Math.max(0,Math.ceil(Math.min(ay,by,cy)));y<=Math.min(n,Math.floor(Math.max(ay,by,cy)));y++) {
      for(let x=Math.max(0,Math.ceil(Math.min(ax,bx,cx)));x<=Math.min(n,Math.floor(Math.max(ax,bx,cx)));x++) {
        const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/d,v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/d,w=1-u-v;
        if(u>=-1e-7&&v>=-1e-7&&w>=-1e-7)heights[y*width+x]=u*vertices[a+2]+v*vertices[b+2]+w*vertices[c+2];
      }
    }
  }
  let covered=0,raised=0,maxRise=0;
  for(let y=0;y<width;y++)for(let x=0;x<width;x++) {
    const index=y*width+x,ground=heights[index];if(!Number.isFinite(ground))throw Error('Incomplete ground height tile');
    const [e,northing]=wgsToSwiss(west+(east-west)*x/n,north-(north-south)*y/n);
    const height=sampleSurface(fields,e,northing);if(!Number.isFinite(height))continue;covered++;
    const rise=Math.max(0,height-ground);if(rise>.1){raised++;maxRise=Math.max(maxRise,rise);}heights[index]=ground+rise;
  }
  return {heights,covered,raised,maxRise};
}
