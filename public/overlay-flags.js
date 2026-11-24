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
