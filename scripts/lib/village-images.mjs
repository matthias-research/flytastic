import {selectAsset} from './wikimedia.mjs';

export const imageTitle=value=>decodeURIComponent(new URL(value).pathname.split('/').pop()).replaceAll('_',' ');
export const normalizeTitle=value=>value.replace(/^File:/,'').replaceAll('_',' ');
export function originalImageUrl(value) {
  const url=new URL(value);
  if(!['upload.wikimedia.org','thumb.wikimedia.org'].includes(url.hostname))throw Error('Unexpected Wikimedia image host');
  url.protocol='https:';
  // API imageinfo adds analytics parameters; these are not part of the asset.
  for(const name of [...url.searchParams.keys()])if(name.startsWith('utm_'))url.searchParams.delete(name);
  return url;
}
export const VILLAGE_QUERY='SELECT DISTINCT ?item ?flag ?arms WHERE { { ?item wdt:P41 ?flag } UNION { ?item wdt:P94 ?arms } ?item wdt:P17 wd:Q39. OPTIONAL { ?item wdt:P41 ?flag } OPTIONAL { ?item wdt:P94 ?arms } }';

export async function completeVillageCatalogue(catalogue,identities,request,save,log=console.log) {
  const represented=catalogue.results.bindings.map(row=>row.item.value.split('/').pop());
  const checked=new Set([...represented,...(catalogue.checkedQids||[])]);
  const missing=[...new Set(identities.map(row=>row[3]))].filter(qid=>!checked.has(qid));
  if(missing.some(qid=>!/^Q[1-9]\d*$/.test(qid)))throw Error('Invalid village Wikidata identity');
  catalogue.additionalQueries??=[];
  for(let i=0;i<missing.length;i+=100) {
    const ids=missing.slice(i,i+100);
    // Locality items do not always carry P17 (country). The exact OSM identity
    // lets us query those items directly without name or proximity matching.
    const query=`SELECT DISTINCT ?item ?flag ?arms WHERE { VALUES ?item { ${ids.map(qid=>`wd:${qid}`).join(' ')} } OPTIONAL { ?item wdt:P17 ?country } FILTER(!BOUND(?country)||?country=wd:Q39) OPTIONAL { ?item wdt:P41 ?flag } OPTIONAL { ?item wdt:P94 ?arms } FILTER(BOUND(?flag)||BOUND(?arms)) }`;
    const url=new URL('https://query.wikidata.org/sparql');url.search=new URLSearchParams({format:'json',query});
    const result=await(await request(url)).json();
    if(!Array.isArray(result.results?.bindings))throw Error('Invalid direct locality catalogue');
    const wanted=new Set(ids);
    if(result.results.bindings.some(row=>!wanted.has(row.item?.value?.split('/').pop())))throw Error('Unexpected Wikidata entity in locality catalogue');
    catalogue.results.bindings.push(...result.results.bindings);
    ids.forEach(qid=>checked.add(qid));catalogue.checkedQids=[...checked];
    catalogue.additionalQueries.push(query);await save(catalogue);
    log(`Checked localities without a country catalogue entry: ${Math.min(i+100,missing.length)}/${missing.length}`);
  }
  return catalogue;
}

export function planVillageImages({places,identities,catalogue,base,credits,overrides}) {
  const links=new Map(identities.map(row=>[row[0],row])),groups=new Map();
  for(const row of catalogue) {
    const qid=row.item?.value?.split('/').pop();
    if(!groups.has(qid))groups.set(qid,[]);
    groups.get(qid).push(row);
  }
  const existing=new Map(credits.map(c=>[imageTitle(c.sourceSvg),c]));
  const parent=new Map(base.places.map(row=>[row[0],row[3]]));
  const candidates=[],counts={sameAsMunicipality:0,unlinked:0,unavailable:0,ambiguous:0,overrides:0};
  for(const p of places) {
    const identity=links.get(p.id),override=overrides[String(p.id)];
    let filename,kind,qid;
    if(override) {
      if(p.longitude!==override.longitude||p.latitude!==override.latitude||!/^Q[1-9]\d*$/.test(override.wikidata)||
        !/\.svg$/i.test(override.filename)||!['flag','coat-of-arms'].includes(override.kind)||!override.evidence?.length)throw Error(`Invalid or stale reviewed image for ${p.id}`);
      if(identity&&(identity[1]!==p.longitude||identity[2]!==p.latitude||identity[3]!==override.wikidata))throw Error(`Reviewed image conflicts with OSM identity for ${p.id}`);
      ({filename,kind}=override);qid=override.wikidata;counts.overrides++;
    } else {
      if(!identity){counts.unlinked++;continue;}
      if(identity[1]!==p.longitude||identity[2]!==p.latitude)throw Error(`Stale Wikidata identity for ${p.id}`);
      qid=identity[3];
      const selected=selectAsset(groups.get(qid)||[]);
      if(selected.status!=='selected'){counts[selected.status==='ambiguous'?'ambiguous':'unavailable']++;continue;}
      filename=imageTitle(selected.asset);kind=selected.kind;
    }
    const cached=existing.get(filename);
    if(cached&&cached.bfs===parent.get(p.id)&&!override){counts.sameAsMunicipality++;continue;}
    candidates.push({id:p.id,name:p.name,longitude:p.longitude,latitude:p.latitude,wikidata:qid,filename,kind,
      ...(override?{evidence:override.evidence}:{}),...(cached&&base.regions[cached.bfs]?{baseRegion:cached.bfs,credits:cached}:{})});
  }
  // Reviewed examples first; thereafter deterministic OSM identity order.
  candidates.sort((a,b)=>Number(Boolean(b.evidence))-Number(Boolean(a.evidence))||Number(b.name==='Esslingen')-Number(a.name==='Esslingen')||a.id-b.id);
  return {candidates,counts};
}
