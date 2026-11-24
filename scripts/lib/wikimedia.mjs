// Reused from SwissExplorer, with an optional persisted cooldown for safe resumption.
import {setTimeout as pause} from 'node:timers/promises';
const userAgent=process.env.WIKIMEDIA_USER_AGENT||'FlytasticVillageFlags/1.0 (https://github.com/matthias-research/flytastic; offline Swiss village image preparation)';
export function retryDelay(header, attempt, now = Date.now()) {
  const seconds = Number(header);
  const requested = header ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now) : 0;
  return Math.max(5000 * 2 ** Math.min(attempt, 6), Number.isFinite(requested) ? requested : 0);
}

export function createRequester({fetchFn = fetch, sleep = pause, now = Date.now, log = console.log, initialCooldown = 0, onCooldown = async () => {}, minimumGap = () => 1000, retryFloor = () => 0} = {}) {
 let nextRequestAt = initialCooldown;
 return async function request(url) {
  for (let attempt = 0;; attempt++) {
    // Chunk long waits so timer overflow cannot accidentally shorten a cooldown.
    while (nextRequestAt > now()) {
      const remaining = nextRequestAt - now();
      if (remaining >= 10000) log(`Waiting: ${Math.ceil(remaining / 1000)} seconds remaining; next request at ${new Date(nextRequestAt).toLocaleTimeString('en-GB', {timeZone: 'Europe/Zurich'})} (Europe/Zurich)`);
      await sleep(Math.min(30000, remaining));
    }
    log(`Request: ${new URL(url).hostname} (attempt ${attempt + 1})`);
    const response = await fetchFn(url, {
      headers: {'User-Agent': userAgent, Accept: 'application/json,image/svg+xml;q=0.9'},
      signal: AbortSignal.timeout(90000),
    });
    nextRequestAt = now() + minimumGap(new URL(url));
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) nextRequestAt = Math.max(nextRequestAt, now() + retryDelay(retryAfter, 0, now()));
    await onCooldown(nextRequestAt);
    // Action API overload errors can arrive with HTTP 200.
    const apiError = response.ok && new URL(url).pathname.endsWith('/w/api.php')
      ? (await response.clone().json()).error : null;
    const overloaded = ['maxlag', 'ratelimited'].includes(apiError?.code);
    if (response.ok && !overloaded) return response;
    if (overloaded || response.status === 429 || (response.status >= 500 && attempt < 3)) {
      const delay = Math.max(retryDelay(retryAfter, attempt, now()),retryFloor(new URL(url)));
      nextRequestAt = Math.max(nextRequestAt, now() + delay);
      await onCooldown(nextRequestAt);
      const detail=(await response.clone().text()).replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').replace(/Sensitive client information[\s\S]*/,'').slice(0,2000);
      if(detail)log(`Service response: ${detail}`);
      await response.body?.cancel();
      log(`Service busy (${apiError?.code || response.status}); next request no earlier than ${new Date(nextRequestAt).toISOString()} (${Math.ceil((nextRequestAt - now()) / 1000)} seconds)`);
      continue;
    }
    const error = new Error(`${apiError?.code || `HTTP ${response.status}`}: ${url}`);
    error.stopDownload = overloaded || [403, 429].includes(response.status) || response.status >= 500;
    throw error;
  }
 };
}

export function selectAsset(rows) {
  if (!rows.length) return {status: 'missing'};
  const municipalities = [...new Set(rows.map(row => row.item.value))];
  if (municipalities.length !== 1) return {status: 'ambiguous', municipalities};
  for (const property of ['flag', 'arms']) {
    const assets = [...new Set(rows.map(row => row[property]?.value).filter(value => value && /\.svg$/i.test(value)))];
    if (assets.length > 1) return {status: 'ambiguous', municipalities, assets};
    if (assets.length === 1) return {status: 'selected', municipality: municipalities[0], kind: property === 'flag' ? 'flag' : 'coat-of-arms', asset: assets[0]};
  }
  return {status: 'no-svg', municipalities};
}

