// Separate optional metadata: stale/missing flags never invalidate place names.
export function validatePlaceFlags(data, places) {
  if (data?.format !== 'swiss-place-flags-v1' || !/^flags-[a-f0-9]{16}\.png$/.test(data.sheet?.file) ||
      !Number.isInteger(data.sheet.width) || !Number.isInteger(data.sheet.height) ||
      data.sheet.width < 48 || data.sheet.height < 48 || data.sheet.width > 4000 || data.sheet.height > 4000 ||
      data.sheet.tileSize !== 48 || !data.regions || typeof data.regions !== 'object' ||
      !Array.isArray(data.places) || data.places.length > 20000 || Object.keys(data.regions).length > 2500) {
    throw Error('Invalid municipality flag manifest');
  }
  const regions = new Map();
  for (const [key, rect] of Object.entries(data.regions)) {
    if (!/^[1-9]\d{0,4}$/.test(key) || !Array.isArray(rect) || rect.length !== 4 ||
        !rect.every(Number.isInteger) || rect[0] < 0 || rect[1] < 0 || rect[2] !== 48 || rect[3] !== 48 ||
        rect[0] + 48 > data.sheet.width || rect[1] + 48 > data.sheet.height) throw Error('Invalid flag image region');
    regions.set(Number(key), Object.freeze([...rect]));
  }
  const current = new Map(places.map(p => [p.id, p])), mapping = new Map(), seen = new Set();
  for (const row of data.places) {
    if (!Array.isArray(row) || row.length !== 4 || !Number.isSafeInteger(row[0]) || row[0] <= 0 ||
        !Number.isFinite(row[1]) || !Number.isFinite(row[2]) || !Number.isInteger(row[3]) || row[3] <= 0 || row[3] > 99999 || seen.has(row[0])) {
      throw Error('Invalid place-to-municipality mapping');
    }
    seen.add(row[0]);
    const place = current.get(row[0]);
    // A re-extracted or moved OSM point must be reassigned offline, never guessed.
    if (place && place.longitude === row[1] && place.latitude === row[2] && regions.has(row[3])) mapping.set(row[0], row[3]);
  }
  return {mapping, regions, sheet: {...data.sheet}};
}

export function validateVillageFlags(data, places, base) {
  if(data?.format!=='swiss-village-flags-v1'||!data.assets||typeof data.assets!=='object'||
    !Array.isArray(data.places)||data.places.length>20000||Object.keys(data.assets).length>10000)throw Error('Invalid village image manifest');
  const sheet=data.sheet;
  if(sheet&&(!/^village-flags-[a-f0-9]{16}\.png$/.test(sheet.file)||!Number.isInteger(sheet.width)||!Number.isInteger(sheet.height)||
    sheet.width<48||sheet.height<48||sheet.width>4000||sheet.height>4000||sheet.tileSize!==48))throw Error('Invalid village image sheet');
  const assets=new Map();
  for(const [key,asset] of Object.entries(data.assets)) {
    if(!/^(?:[a-f0-9]{24}|bfs:[1-9]\d{0,4})$/.test(key)||!['flag','coat-of-arms'].includes(asset.kind))throw Error('Invalid village image asset');
    if(asset.baseRegion!==undefined) {
      if(!Number.isInteger(asset.baseRegion)||asset.baseRegion<1||asset.baseRegion>99999)throw Error('Invalid reused image region');
      // A rebuilt municipality sheet must never silently change reused artwork.
      if(data.baseSheet===base.sheet.file&&base.regions.has(asset.baseRegion))assets.set(key,{sheet:'municipality',rect:base.regions.get(asset.baseRegion),kind:asset.kind});
    } else {
      const r=asset.rect;
      if(!sheet||!Array.isArray(r)||r.length!==4||!r.every(Number.isInteger)||r[0]<0||r[1]<0||r[2]!==48||r[3]!==48||r[0]+48>sheet.width||r[1]+48>sheet.height)throw Error('Invalid village image region');
      assets.set(key,{sheet:'village',rect:[...r],kind:asset.kind});
    }
  }
  const current=new Map(places.map(p=>[p.id,p])),mapping=new Map(),seen=new Set();
  for(const row of data.places) {
    if(!Array.isArray(row)||row.length!==4||!Number.isSafeInteger(row[0])||row[0]<=0||!Number.isFinite(row[1])||!Number.isFinite(row[2])||
      typeof row[3]!=='string'||!Object.hasOwn(data.assets,row[3])||seen.has(row[0]))throw Error('Invalid village image mapping');
    seen.add(row[0]);const place=current.get(row[0]);
    if(place&&place.longitude===row[1]&&place.latitude===row[2]&&assets.has(row[3]))mapping.set(row[0],assets.get(row[3]));
  }
  return {mapping,sheet};
}

export function resolvePlaceFlag(id, base, villages) {
  const local=villages?.mapping.get(id);
  if(local)return local;
  const rect=base?.regions.get(base.mapping.get(id));
  return rect?{sheet:'municipality',rect}:undefined;
}

export async function fetchFlagBytes(url, signal, maxBytes) {
  const response = await fetch(url, {signal, credentials: 'same-origin'});
  if (!response.ok) throw Error(`Municipality flags HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw Error('Flag asset exceeds byte limit');
  }
  if (!response.body) throw Error('Empty flag response');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw Error('Flag asset exceeds byte limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
