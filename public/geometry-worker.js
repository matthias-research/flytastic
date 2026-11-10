import { Terrain, tileBounds, geometryDetail } from './terrain.js';

let terrain;
self.onmessage = ({ data }) => {
  if (data.type === 'init') { terrain = new Terrain(data.elevation, data.tree,data.metadata); return; }
  if (data.type !== 'build') return;
  try {
    const bounds = data.tiles.map(tile => tileBounds(tile.pack,tile.x,tile.y));
    const extent = [Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))];
    const refinement=terrain.refinement(data.eye,extent);
    const meshes=data.tiles.map((tile,i)=>({key:tile.key,vertices:terrain.mesh(bounds[i],terrain.depth,0,refinement)}));
    const ground=terrain.ground(data.eye[0],-data.eye[2]);
    self.postMessage({id:data.id,generation:data.generation,meshes,splitVertices:refinement.size,spacing:geometryDetail(data.eye[1]-ground,terrain.spacing,terrain.depth).spacing},meshes.map(m=>m.vertices.buffer));
  } catch (error) {
    self.postMessage({id:data.id,generation:data.generation,error:error.message});
  }
};
