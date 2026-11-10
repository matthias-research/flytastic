import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SWISS_ROOT=fileURLToPath(new URL('../models/swisstopo/',import.meta.url));
export const ORIGINAL_MODEL={id:'original',name:'Original Flytastic',attribution:'Original Flytastic dataset',pilot:false,bounds:[483,72,835,295.9],terrain:{width:3521,height:2240,origin:[483,72],spacingMeters:100,treeSize:4096,treeDepth:24,heightEncoding:'int16',heightUnitMeters:1}};
export async function swissManifest() {
  const manifest=JSON.parse(await readFile(path.join(SWISS_ROOT,'manifest.json'),'utf8'));
  if(manifest.status!=='ready')throw new Error('Swisstopo model is not ready');
  return manifest;
}
export function safeModelPath(root,relative) {
  const result=path.resolve(root,relative);
  if(!result.startsWith(path.resolve(root)+path.sep))throw new Error('Invalid model file path');
  return result;
}
