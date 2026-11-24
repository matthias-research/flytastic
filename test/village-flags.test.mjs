import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planVillageImages,originalImageUrl,completeVillageCatalogue} from '../scripts/lib/village-images.mjs';
import {createRequester} from '../scripts/lib/wikimedia.mjs';
import {validatePlaceFlags,validateVillageFlags,resolvePlaceFlag} from '../public/overlay-flags.js';

const place={id:30757706,name:'Ürikon',longitude:8.7573767,latitude:47.2350588};
const base={sheet:{file:'flags-0123456789abcdef.png'},mapping:new Map([[place.id,158]]),regions:new Map([[158,[0,0,48,48]]])};
const key='0123456789abcdef01234567';
test('original image requests use canonical HTTPS URLs while retaining meaningful query parameters',()=>{
  assert.equal(originalImageUrl('http://upload.wikimedia.org/wikipedia/commons/a/ab/Flag.svg?utm_source=commons&utm_medium=api&download=1').href,
    'https://upload.wikimedia.org/wikipedia/commons/a/ab/Flag.svg?download=1');
  assert.throws(()=>originalImageUrl('https://example.org/image.svg'),/host/);
  assert.equal(originalImageUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Flag.svg/120px-Flag.svg.png?utm_source=api').hostname,'thumb.wikimedia.org');
});
function fixture(){return {format:'swiss-village-flags-v1',baseSheet:base.sheet.file,sheet:{file:'village-flags-0123456789abcdef.png',width:1536,height:48,tileSize:48},assets:{[key]:{kind:'coat-of-arms',rect:[48,0,48,48]}},places:[[place.id,place.longitude,place.latitude,key]]};}
test('village artwork overrides the municipality; missing or moved mappings fall back',()=>{
  const data=fixture(),village=validateVillageFlags(data,[place],base);
  assert.deepEqual(resolvePlaceFlag(place.id,base,village),{sheet:'village',rect:[48,0,48,48],kind:'coat-of-arms'});
  const stale=validateVillageFlags(data,[{...place,longitude:place.longitude+.01}],base);
  assert.deepEqual(resolvePlaceFlag(place.id,base,stale),{sheet:'municipality',rect:[0,0,48,48]});
  assert.deepEqual(resolvePlaceFlag(place.id,base,undefined),{sheet:'municipality',rect:[0,0,48,48]});
  assert.equal(resolvePlaceFlag(123,base,village),undefined);
});
test('village manifest rejects unsafe assets, duplicate places and invalid sprite regions',()=>{
  for(const change of [d=>d.sheet.file='../outside.png',d=>d.assets[key].rect[0]=-1,d=>d.assets[key].rect[0]=1536,
    d=>d.assets[key].rect[2]=500,d=>d.assets[key].kind='unknown',d=>d.places.push([...d.places[0]])]) {
    const data=fixture();change(data);assert.throws(()=>validateVillageFlags(data,[place],base));
  }
});
test('reused artwork is accepted only for the exact municipality sheet version',()=>{
  const data=fixture();data.assets={'bfs:158':{kind:'flag',baseRegion:158}};data.places[0][3]='bfs:158';
  assert.equal(validateVillageFlags(data,[place],base).mapping.size,1);
  data.baseSheet='flags-0000000000000000.png';
  assert.equal(validateVillageFlags(data,[place],base).mapping.size,0);
});
const row=(qid,flag,arms)=>({item:{value:`http://www.wikidata.org/entity/${qid}`},...(flag?{flag:{value:`http://commons.wikimedia.org/wiki/Special:FilePath/${flag}`}}:{}),...(arms?{arms:{value:`http://commons.wikimedia.org/wiki/Special:FilePath/${arms}`}}:{})});
function planInput(){return {places:[place],identities:[[place.id,place.longitude,place.latitude,'Q7877470']],catalogue:[],base:{places:[[place.id,place.longitude,place.latitude,158]],regions:{158:[0,0,48,48]}},credits:[],overrides:{}};}
test('discovery uses exact Wikidata identities, prefers flags, and rejects conflicting assets',()=>{
  const input=planInput();input.catalogue=[row('Q7877470','Village.svg','Arms.svg')];
  assert.equal(planVillageImages(input).candidates[0].filename,'Village.svg');
  input.catalogue.push(row('Q7877470','Other.svg'));
  assert.equal(planVillageImages(input).counts.ambiguous,1);
  input.catalogue=[row('Q111','Village.svg')];
  assert.equal(planVillageImages(input).candidates.length,0,'A similar name must not choose another entity');
  input.identities[0][1]+=1;assert.throws(()=>planVillageImages(input),/Stale/);
});
test('reviewed locality images can fill missing Wikidata artwork without guessing by name',()=>{
  const input=planInput();input.identities=[];
  input.overrides[place.id]={...place,wikidata:'Q7877470',filename:'CHE Uerikon COA.svg',kind:'coat-of-arms',evidence:['https://www.ortsverein-uerikon.ch/']};
  assert.equal(planVillageImages(input).candidates[0].filename,'CHE Uerikon COA.svg');
  input.overrides[place.id].latitude+=1;assert.throws(()=>planVillageImages(input),/stale/);
});
test('discovery reuses existing municipality images and skips unchanged artwork',()=>{
  const input=planInput();input.catalogue=[row('Q7877470','Shared.svg')];
  input.credits=[{bfs:158,sourceSvg:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Shared.svg'}];
  assert.equal(planVillageImages(input).counts.sameAsMunicipality,1);
  input.base.places[0][3]=159;
  assert.equal(planVillageImages(input).candidates[0].baseRegion,158);
  input.credits=[];input.catalogue=[row('Q7877470',undefined,'Arms.svg')];
  assert.equal(planVillageImages(input).candidates[0].kind,'coat-of-arms');
});
test('locality discovery checks exact identities missing a country entry and caches negative results',async()=>{
  const catalogue={results:{bindings:[row('Q1','One.svg')]}};
  const identities=[[1,8,47,'Q1'],[2,8,47,'Q2'],[3,8,47,'Q3']];let calls=0,saves=0;
  const request=async url=>{
    calls++;assert.match(url.searchParams.get('query'),/wd:Q2 wd:Q3/);
    return new Response(JSON.stringify({results:{bindings:[row('Q2','Two.svg')]}}));
  };
  await completeVillageCatalogue(catalogue,identities,request,async()=>{saves++;},()=>{});
  assert.equal(catalogue.results.bindings.length,2);assert.equal(saves,1);
  await completeVillageCatalogue(catalogue,identities,request,async()=>{saves++;},()=>{});
  assert.equal(calls,1,'Missing artwork is cached rather than re-queried every run');
});
test('Wikimedia cooldowns survive restarts and repeated Retry-After responses',async()=>{
  let now=1000,persisted=0;const calls=[];
  const request=createRequester({initialCooldown:11000,now:()=>now,sleep:async ms=>{now+=ms;},log:()=>{},onCooldown:async next=>{persisted=next;},fetchFn:async()=>{
    calls.push(now);return calls.length<3?new Response('',{status:429,headers:{'Retry-After':'600'}}):new Response('ok',{headers:{'Retry-After':'600'}});
  }});
  await request('https://example.org/image.svg');
  assert.deepEqual(calls,[11000,611000,1211000]);assert.equal(persisted,1811000);
  const resumed=createRequester({initialCooldown:persisted,now:()=>now,sleep:async ms=>{now+=ms;},log:()=>{},fetchFn:async()=>{calls.push(now);return new Response('ok');}});
  await resumed('https://example.org/next.svg');assert.equal(calls.at(-1),1811000);
});
test('media pacing is conservative and longer server cooldowns take precedence',async()=>{
  let now=0;const calls=[];
  const request=createRequester({now:()=>now,sleep:async ms=>{now+=ms;},log:()=>{},minimumGap:()=>125000,retryFloor:()=>630000,fetchFn:async()=>{
    calls.push(now);
    return calls.length===1?new Response('',{status:429,headers:{'Retry-After':'120'}}):new Response('ok',{headers:{'Retry-After':'900'}});
  }});
  await request('https://upload.wikimedia.org/one.svg');
  await request('https://upload.wikimedia.org/two.svg');
  assert.deepEqual(calls,[0,630000,1530000]);
});
test('prepared village mappings include Ürikon and Esslingen with individual artwork',async()=>{
  const json=async name=>JSON.parse(await readFile(new URL(`../public/overlays/${name}`,import.meta.url),'utf8'));
  const [places,parent,data,credits]=await Promise.all(['villages.json','flags.json','village-flags.json','village-flag-credits.json'].map(json));
  const fallback=validatePlaceFlags(parent,places.places),village=validateVillageFlags(data,places.places,fallback);
  for(const id of [30757706,3029228685]) {
    assert.equal(resolvePlaceFlag(id,fallback,village).sheet,'village');
    assert.ok(credits.places.some(p=>p.id===id));
  }
  assert.ok(credits.images.every(c=>c.source&&c.license));
});
