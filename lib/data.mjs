import { readFile, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATA = fileURLToPath(new URL('../models/original/GEODAT/', import.meta.url));

export async function readCatalog(root) {
  const lines = (await readFile(path.join(root, 'birdinfo.dat'), 'utf8')).trim().split(/\r?\n/);
  const packs = [];
  for (const line of lines) {
    const [factor, divisor, flags, filename, xstart, ystart, , , width, height] = line.trim().split(/\s+/);
    if (!/^IMGPACK[A-Z]\.dat\//i.test(filename)) continue;
    const name = filename.split('/')[0];
    const index = await readFile(path.join(root, name.replace('.dat', '.dir')));
    const [minX, maxX, minY, maxY] = Array.from({ length: 4 }, (_, i) => index.readInt32LE(i * 4));
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (index.length !== 16 + count * 8) throw new Error(`Invalid index: ${name}`);
    const size = (await stat(path.join(root, name))).size;
    const tiles = [];
    for (let i = 0; i < count; i++) {
      const offset = index.readInt32LE(16 + i * 8), length = index.readInt32LE(20 + i * 8);
      if (length < 0 || (length > 0 && (offset < 0 || offset + length > size))) throw new Error(`Invalid tile range: ${name}`);
      if (length > 0) tiles.push([minX + i % (maxX - minX + 1), minY + Math.floor(i / (maxX - minX + 1))]);
    }
    packs.push({ id: name[7], name, factor: +factor, divisor: +divisor, flags, xstart: +xstart, ystart: +ystart, width: +width, height: +height, minX, maxX, minY, maxY, tiles, index });
  }
  return packs;
}

export async function readTile(root, pack, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < pack.minX || x > pack.maxX || y < pack.minY || y > pack.maxY) return null;
  const i = (x - pack.minX) + (y - pack.minY) * (pack.maxX - pack.minX + 1);
  const offset = pack.index.readInt32LE(16 + i * 8), length = pack.index.readInt32LE(20 + i * 8);
  if (length <= 0) return null;
  const handle = await open(path.join(root, pack.name));
  try {
    const data = Buffer.alloc(length);
    const { bytesRead } = await handle.read(data, 0, length, offset);
    if (bytesRead !== length) throw new Error('Truncated tile');
    for (let i = 0; i < data.length; i++) data[i] ^= 0x59;
    if (data[0] !== 255 || data[1] !== 216) throw new Error('Invalid JPEG');
    return data;
  } finally { await handle.close(); }
}
