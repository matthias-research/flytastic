import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';

const port=process.env.TEST_PORT||'3027',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,page,logs='',phase='original';const errors=[],requests=[],report={};
server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
await mkdir('.local',{recursive:true});
async function ready(){
  await page.waitForFunction(()=>window.flytastic?.ready||window.flytastic?.error,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>window.flytastic.error),'');
}
async function settled(){await page.waitForTimeout(500);await page.waitForFunction(()=>window.flytastic?.ready&&window.flytastic.loading===0,null,{timeout:180000});}
async function checkPitch(pointer=false){
  const slider=page.locator('#flight-pitch-pad'),pitchBox=await slider.boundingBox(),flightBox=await page.locator('#flight-pad').boundingBox();
  assert.ok(pitchBox.x+pitchBox.width<flightBox.x,'Pitch sits to the left of the flight joystick');
  if(pointer) {
    await page.mouse.click(pitchBox.x+pitchBox.width/2,pitchBox.y+pitchBox.height/2-pitchBox.height*44/144/2);
    await page.waitForFunction(()=>Math.abs(window.flytastic.pitch-Math.PI/6)<.03);
    assert.equal(await page.evaluate(()=>window.flytastic.flightActive),false,'Adjusting pitch while paused does not start flight');
  }else {
    await slider.focus();await slider.press('Home');
    await page.waitForFunction(()=>Math.abs(window.flytastic.pitch+Math.PI/3)<1e-9);
    assert.equal(await page.evaluate(()=>window.flytastic.flightActive),false);
    await page.click('#fly');await page.waitForTimeout(250);
    assert.ok(Math.abs(await page.evaluate(()=>window.flytastic.pitch)+Math.PI/3)<1e-9,'Flight retains the selected downward pitch');
    await slider.press('End');await page.waitForFunction(()=>Math.abs(window.flytastic.pitch-Math.PI/3)<1e-9);
    await page.waitForTimeout(250);assert.ok(Math.abs(await page.evaluate(()=>window.flytastic.pitch)-Math.PI/3)<1e-9);
    await page.click('#fly');
  }
  await page.click('#reset');await ready();await settled();
}
try {
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/models`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const models=await fetch(`${base}/api/models`).then(r=>r.json());assert.deepEqual(models.map(m=>m.id),['original','swisstopo']);
  assert.equal((await fetch(`${base}/api/model?model=streaming`)).status,404);
  assert.equal((await fetch(`${base}/vendor/cesium/%2e%2e%5c%2e%2e%5cpackage.json`)).status,403);
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1440,height:960}});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({phase,url:r.url()}));
  if(models[0].available) {
    await page.goto(`${base}/?model=original`);await ready();await settled();
    assert.equal(await page.locator('#model option').count(),2);
    assert.equal(await page.locator('#renderer,#height-mode').count(),0);
    assert.equal(await page.locator('#swisstopo-settings').isVisible(),false);
    report.original=await page.evaluate(()=>window.flytastic);assert.ok(report.original.triangles>0);assert.equal(report.original.rendererId,'flytastic');
    assert.ok(!requests.some(r=>r.url.includes('geo.admin.ch')||r.url.includes('/vendor/cesium/')),'Original runs entirely on local Flytastic assets');
    await checkPitch();report.originalPitchControl=true;
    await page.selectOption('#model','swisstopo');
  }else await page.goto(`${base}/?model=swisstopo`);
  phase='ground';await ready();await settled();
  assert.equal(await page.locator('#flattened').isChecked(),true);
  await checkPitch(true);report.cesiumPitchControl=true;
  report.ground=await page.evaluate(()=>({status:window.flytastic,pose:window.flytasticSession.camera(),height:window.flytasticSession.sampleHeight(632,173)}));
  assert.equal(report.ground.status.rendererId,'cesium');assert.equal(report.ground.status.model,'swisstopo');
  phase='surface';await page.uncheck('#flattened');await ready();
  await page.waitForFunction(()=>window.flytastic?.flattened===false&&window.flytastic.surface?.raised>0,null,{timeout:180000});
  await settled();
  report.surface=await page.evaluate(()=>({status:window.flytastic,pose:window.flytasticSession.camera(),height:window.flytasticSession.sampleHeight(632,173)}));
  assert.equal(report.surface.status.rendererId,'cesium');assert.deepEqual(report.surface.pose,report.ground.pose);
  assert.ok(report.surface.status.surface.raised>0);assert.ok(report.surface.height>report.ground.height+1,'The non-flattened heightfield raises canopy heights');
  assert.equal(report.surface.status.glError,0);assert.equal(report.surface.status.error,'');
  await page.evaluate(()=>{window.surfaceCanvas=document.querySelector('#cesium-scene canvas');});
  const rasterRequests=()=>requests.filter(r=>r.url.includes('.tif')||r.url.includes('/api/stac/')).length;
  const beforeSwitch=rasterRequests(),switched=Date.now();
  await page.check('#flattened');await settled();
  await page.uncheck('#flattened');await settled();
  assert.equal(await page.evaluate(()=>window.surfaceCanvas===document.querySelector('#cesium-scene canvas')),true,'Checkbox reuses the viewer');
  assert.equal(rasterRequests(),beforeSwitch,'Returning to the same surface uses cached heights');
  assert.deepEqual(await page.evaluate(()=>window.flytasticSession.camera()),report.surface.pose);
  report.warmSwitchMs=Date.now()-switched;
  await page.screenshot({path:'.local/swisstopo-surface.png'});
  await page.evaluate(()=>window.flytasticMetrics.reset());await page.click('#fly');await page.waitForTimeout(5000);await page.click('#fly');
  report.flight=await page.evaluate(()=>({status:window.flytastic,performance:window.flytasticMetrics.snapshot()}));assert.equal(report.flight.status.glError,0);
  await page.selectOption('#destination','lucerne');
  await page.waitForFunction(()=>window.flytastic?.ready&&window.flytastic.eye[0]===668&&window.flytastic.eye[2]===-213,null,{timeout:180000});
  report.lucerne=await page.evaluate(()=>window.flytastic);
  phase='restored';const pose=await page.evaluate(()=>window.flytasticSession.camera());await page.check('#flattened');await ready();await settled();
  assert.deepEqual(await page.evaluate(()=>window.flytasticSession.camera()),pose);assert.equal(await page.evaluate(()=>window.flytastic.flattened),true);
  assert.ok(!requests.some(r=>r.phase==='surface'&&r.url.includes('/api/tile/')),'Cesium uses no local imagery');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  const panel=await page.locator('.flight-controls').boundingBox();assert.ok(panel.x>=0&&panel.x+panel.width<=390,'All three controls fit on mobile');
  await page.screenshot({path:'.local/swisstopo-mobile.png'});
  assert.deepEqual(errors,[]);report.errors=errors;await writeFile('.local/viewer-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){
  console.error(JSON.stringify({error:error.message,errors,logs,status:page?await page.evaluate(()=>({state:window.flytastic,message:document.getElementById('message')?.textContent})).catch(()=>null):null},null,2));
  if(page)await page.screenshot({path:'.local/viewer-failure.png'}).catch(()=>{});process.exitCode=1;
}finally{await browser?.close();server.kill();}
