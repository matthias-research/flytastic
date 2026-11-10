import { tileBounds } from './terrain.js';

// ImageGrid's original scale factors and coordinates define each grid. The
// first browser LOD policy uses distance to terrain, including camera altitude.
export const LEVELS = [
  { id: 'E', radius: 3, distance: Infinity },
  { id: 'D', radius: 4, distance: 14 },
  { id: 'C', radius: 3, distance: 6 },
];
export const START_CLEARANCE = 0.65; // kilometers above the local terrain

export function selectTiles(packs, eye, terrain) {
  const jobs = [];
  for (let level = 0; level < LEVELS.length; level++) {
    const policy = LEVELS[level], pack = packs.find(p => p.id === policy.id);
    const size = pack.divisor / pack.factor * pack.width / 1000;
    const cx = Math.floor((eye[0] - pack.xstart / 1000) / size);
    const cy = Math.floor((-eye[2] - pack.ystart / 1000) / size);
    for (let y = cy - policy.radius; y <= cy + policy.radius; y++) {
      for (let x = cx - policy.radius; x <= cx + policy.radius; x++) {
        if (!pack.available.has(`${x}/${y}`)) continue;
        const bounds = tileBounds(pack, x, y);
        const nearestX = Math.max(bounds[0], Math.min(bounds[2], eye[0]));
        const nearestY = Math.max(bounds[1], Math.min(bounds[3], -eye[2]));
        const ground = terrain.ground(nearestX, nearestY);
        const distance = Math.hypot(eye[0] - nearestX, -eye[2] - nearestY, eye[1] - ground);
        if (distance > policy.distance) continue;
        jobs.push({ pack, level, x, y, key: `${pack.id}/${x}/${y}`, distance });
      }
    }
  }
  // Coarse imagery is usable while the finer levels arrive.
  return jobs.sort((a, b) => a.level - b.level || a.distance - b.distance);
}

export function coverageIndex(pack, x, y) {
  return x - pack.minX + (y - pack.minY) * (pack.maxX - pack.minX + 1);
}
