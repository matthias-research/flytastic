// Source baseline: dataTree.cpp renderQuadrant/renderMesh and ImageGrid.cpp
// cornerOfCell. Units are kilometers; GPU coordinates are (east, height, -north).
export const WIDTH = 3521, HEIGHT = 2240;
export function geometryDetail(distance, sourceSpacing = 100, treeDepth = 24) {
  if(sourceSpacing < 100) {
    const level=distance<1?0:distance<3?1:distance<8?2:distance<16?3:4;
    return {depth:Math.max(0,treeDepth-2*level),error:[0,1,3,6,8][level],spacing:sourceSpacing*2**level};
  }
  if (distance < 4) return { depth: 24, error: 0, spacing: 100 };
  if (distance < 12) return { depth: 22, error: 3, spacing: 200 };
  if (distance < 24) return { depth: 20, error: 6, spacing: 400 };
  return { depth: 18, error: 8, spacing: 800 };
}
export class Terrain {
  constructor(elevation, tree, metadata = {}) {
    this.width=metadata.width??WIDTH; this.heightCount=metadata.height??HEIGHT;
    this.origin=metadata.origin??[483,72]; this.spacing=metadata.spacingMeters??100;
    this.step=this.spacing/1000; this.size=metadata.treeSize??4096;
    this.depth=metadata.treeDepth??24; this.stride=this.size+1;
    this.encoding=metadata.heightEncoding??'int16'; this.heightUnit=metadata.heightUnitMeters??1;
    this.noData=metadata.noData;
    if (elevation.byteLength !== this.width * this.heightCount * 2 || tree.byteLength !== this.width * this.heightCount) throw new Error('Terrain file dimensions do not match the model metadata.');
    this.elevation = new DataView(elevation);
    this.tree = new Uint8Array(tree);
  }
  height(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.heightCount) return 0;
    // C++ elev[x][y]: the northing (y) index is contiguous on disk.
    const offset=(x*this.heightCount+y)*2;
    const value=this.encoding==='uint16'?this.elevation.getUint16(offset,true):this.elevation.getInt16(offset,true);
    return value===this.noData?0:value*this.heightUnit/1000;
  }
  ground(east, north) {
    const x = (east - this.origin[0]) / this.step, y = (north - this.origin[1]) / this.step;
    const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy;
    return (this.height(ix, iy) * (1-u) + this.height(ix+1, iy) * u) * (1-v)
      + (this.height(ix, iy+1) * (1-u) + this.height(ix+1, iy+1) * u) * v;
  }
  refinement(eye, bounds) {
    const splits = new Set();
    const force = (x, y) => {
      if (x < 0 || y < 0 || x > this.size || y > this.size) return;
      // Root corners are not split vertices and have no parents.
      if ((x === 0 || x === this.size) && (y === 0 || y === this.size)) return;
      const key = x * this.stride + y;
      if (splits.has(key)) return;
      splits.add(key);
      // Port of DataTree::forceVertexLOD's diamond dependencies. Force both
      // parents so the neighboring triangle introduces the same edge vertex.
      let offset = 1, xt = x, yt = y;
      while ((xt & 1) === 0 && (yt & 1) === 0) { xt >>= 1; yt >>= 1; offset *= 2; }
      if (!(xt & 1)) { force(x-offset,y); force(x+offset,y); }
      else if (!(yt & 1)) { force(x,y-offset); force(x,y+offset); }
      else if ((xt & 3) === (yt & 3)) { force(x+offset,y-offset); force(x-offset,y+offset); }
      else { force(x+offset,y+offset); force(x-offset,y-offset); }
    };
    const [west,south,east,north] = bounds;
    const visit = (lx,ly,tx,ty,rx,ry,depth) => {
      const minX=Math.min(lx,tx,rx)*this.step+this.origin[0], maxX=Math.max(lx,tx,rx)*this.step+this.origin[0];
      const minY=Math.min(ly,ty,ry)*this.step+this.origin[1], maxY=Math.max(ly,ty,ry)*this.step+this.origin[1];
      if (maxX<west || minX>east || maxY<south || minY>north || depth>=this.depth) return;
      const mx=(lx+rx)>>1, my=(ly+ry)>>1;
      const x=mx*this.step+this.origin[0], y=my*this.step+this.origin[1];
      const detail=geometryDetail(Math.hypot(eye[0]-x,eye[2]+y,eye[1]-this.height(mx,my)),this.spacing,this.depth);
      const value=mx<this.width && my<this.heightCount ? this.tree[mx*this.heightCount+my] & 15 : 15;
      if (depth>=detail.depth || value<=detail.error) return;
      force(mx,my);
      visit(tx,ty,mx,my,lx,ly,depth+1);
      visit(rx,ry,mx,my,tx,ty,depth+1);
    };
    visit(this.size,0,0,0,0,this.size,0);
    visit(0,this.size,this.size,this.size,this.size,0,0);
    return splits;
  }
  mesh(bounds, depth = 22, error = 4, refinement = null) {
    const [west, south, east, north] = bounds;
    const gridBounds = [(west-this.origin[0])/this.step, (south-this.origin[1])/this.step, (east-this.origin[0])/this.step, (north-this.origin[1])/this.step];
    const vertices = [];
    const code = (x,y) => (x < gridBounds[0] ? 2 : x > gridBounds[2] ? 1 : 0) | (y < gridBounds[1] ? 4 : y > gridBounds[3] ? 8 : 0);
    const emit = (points) => {
      // Sutherland-Hodgman clipping replaces the original clipTriangle's case table.
      for (const [axis, edge, sign] of [[0,west,1],[0,east,-1],[1,south,1],[1,north,-1]]) {
        const output = [];
        for (let i=0; i<points.length; i++) {
          const a=points[i], b=points[(i+1)%points.length];
          const ai=(a[axis]-edge)*sign>=0, bi=(b[axis]-edge)*sign>=0;
          if (ai) output.push(a);
          if (ai !== bi) { const t=(edge-a[axis])/(b[axis]-a[axis]); output.push(a.map((v,j)=>v+(b[j]-v)*t)); }
        }
        points = output;
      }
      for (let i=1;i<points.length-1;i++) {
        const tri=[points[0],points[i],points[i+1]];
        if (tri.some(v=>v[2]<=0)) continue; // Original renderTriangle no-data rule.
        for (const [x,y,z] of tri) vertices.push(x,z,-y,(x-west)/(east-west),(y-south)/(north-south));
      }
    };
    const visit = (lx,ly,tx,ty,rx,ry,level) => {
      if (code(lx,ly) & code(tx,ty) & code(rx,ry)) return;
      const mx=(lx+rx)>>1, my=(ly+ry)>>1;
      const value=mx>=0&&my>=0&&mx<this.width&&my<this.heightCount ? this.tree[mx*this.heightCount+my] : 15;
      const split=refinement ? refinement.has(mx*this.stride+my) : value>error;
      if (level<=0 || !split) {
        emit([[lx*this.step+this.origin[0],ly*this.step+this.origin[1],this.height(lx,ly)], [tx*this.step+this.origin[0],ty*this.step+this.origin[1],this.height(tx,ty)], [rx*this.step+this.origin[0],ry*this.step+this.origin[1],this.height(rx,ry)]]);
      } else {
        visit(tx,ty,mx,my,lx,ly,level-1);
        visit(rx,ry,mx,my,tx,ty,level-1);
      }
    };
    visit(this.size,0,0,0,0,this.size,depth);
    visit(0,this.size,this.size,this.size,this.size,0,depth);
    return new Float32Array(vertices);
  }
}
export function tileBounds(pack, x, y) {
  const size=pack.divisor/pack.factor*pack.width/1000;
  const west=x*size+pack.xstart/1000, south=y*size+pack.ystart/1000;
  return [west,south,west+size,south+size];
}
