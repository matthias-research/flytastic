import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { wgsToSwiss } from '../public/swiss-coordinates.js';

const port=process.env.TEST_PORT||'3028',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,page,logs='';const errors=[];
server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
await mkdir('.local',{recursive:true});
async function ready(){
  await page.waitForFunction(()=>window.flytastic?.ready||window.flytastic?.error,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>window.flytastic.error),'');
}
try {
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/models`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const models=await fetch(`${base}/api/models`).then(r=>r.json());
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1440,height:960}});
  page.on('pageerror',e=>errors.push(e.message));
  const input=page.locator('#place-search');
  for(const model of models.filter(m=>m.available)) {
    await page.goto(`${base}/?model=${model.id}&winter=1&snowLine=1600`);await ready();
    const pose=await page.evaluate(()=>window.flytasticSession.camera());
    await input.fill('Bern');
    await page.locator('#place-results li').first().waitFor({timeout:30000});
    assert.match(await page.locator('#place-results').innerText(),/Bern/i);
    await input.press('Home');await input.press('ArrowDown');
    assert.ok(await input.getAttribute('aria-activedescendant'));
    assert.deepEqual(await page.evaluate(()=>window.flytasticSession.camera()),pose,'Typing search shortcuts does not move the aircraft');
    await page.screenshot({path:`.local/search-${model.id}.png`});
    await input.press('Enter');
    await page.waitForFunction(()=>document.getElementById('search-announcement').textContent.startsWith('At '),null,{timeout:90000});
    const state=await page.evaluate(()=>window.flytastic);
    assert.ok(Math.abs(state.eye[0]-600)<3&&Math.abs(-state.eye[2]-201)<4,'Search navigates to Bern in Swiss coordinates');
    assert.equal(state.flightActive,false);assert.equal(state.winter,true);assert.equal(state.snowLine,1600);
    assert.ok(state.clearance>=.64,'Search places the camera above terrain');
    assert.ok(new URL(page.url()).hash.includes('camera='));
    const searched=await page.evaluate(()=>window.flytasticSession.camera());
    await page.reload();await ready();
    assert.deepEqual(await page.evaluate(()=>window.flytasticSession.camera()),searched,'Search view survives reload');
    console.log(`Real Bern search, keyboard selection, terrain clearance and reload passed: ${model.id}`);
  }
  await page.route('**/SearchServer?**',async route=>{
    const q=new URL(route.request().url()).searchParams.get('searchText');
    if(q==='failure')return route.fulfill({status:503,body:'unavailable'});
    if(q==='slow')await new Promise(r=>setTimeout(r,1000));
    const coordinates=q==='outside'?[10.55,47.85]:[7.4474,46.948];
    const features=q==='empty'?[]:[{geometry:{type:'Point',coordinates},properties:{
      label:q==='safe'?'<b>Bern</b><img src=x onerror="window.__unsafe=true">':q,origin:'address',
    }}];
    await route.fulfill({json:{features}}).catch(()=>{});
  });
  await input.fill('failure');await page.getByText('Search is unavailable.',{exact:false}).waitFor();
  await input.fill('empty');await page.getByText('No places found.',{exact:false}).waitFor();
  await input.fill('slow');await page.waitForTimeout(350);await page.locator('#search-clear').click();await page.waitForTimeout(1200);
  assert.equal(await page.locator('#search-panel').isVisible(),false);
  await input.fill('safe');await page.locator('#place-results li').first().waitFor();
  assert.equal(await page.locator('#place-results img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.__unsafe)),false);
  await input.press('Escape');assert.equal(await page.locator('#search-panel').isVisible(),false);
  const prior=await page.evaluate(()=>window.flytasticSession.camera());
  await input.fill('outside');await page.locator('#place-results li').first().waitFor();await input.press('Enter');
  await page.locator('#search-message').filter({hasText:'This place is outside the selected map.'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.flytasticSession.camera()),prior);
  await input.fill('safe');await page.locator('#place-results li').first().waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.local/search-mobile.png'});
  const boxes=await page.evaluate(()=>{
    const search=document.querySelector('.place-search').getBoundingClientRect(),aside=document.querySelector('aside').getBoundingClientRect();
    return {left:search.left,right:search.right,bottom:search.bottom,asideTop:aside.top,width:innerWidth,scroll:document.documentElement.scrollWidth};
  });
  assert.ok(boxes.left>=0&&boxes.right<=boxes.width&&boxes.scroll<=boxes.width);
  assert.ok(boxes.bottom<=boxes.asideTop);
  await page.locator('#place-results li').first().click();
  await page.waitForFunction(()=>document.getElementById('search-announcement').textContent==='At Bern',null,{timeout:90000});
  const [east,north]=wgsToSwiss(7.4474,46.948),state=await page.evaluate(()=>window.flytastic);
  assert.ok(Math.abs(state.eye[0]-east/1000)<.001&&Math.abs(-state.eye[2]-(north/1000+.5))<.001);
  assert.deepEqual(errors,[]);
  console.log('Service failure, empty results, stale responses, safe labels, bounds, mobile layout and pointer selection passed.');
}catch(error){
  console.error(error,logs);
  if(page){console.error(await page.evaluate(()=>({state:window.flytastic,message:document.getElementById('search-message').textContent,announcement:document.getElementById('search-announcement').textContent})).catch(()=>null));await page.screenshot({path:'.local/search-failure.png'}).catch(()=>{});}
  process.exitCode=1;
}finally{await browser?.close();server.kill();}
