import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';

const port='3031',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port},windowsHide:true,stdio:'pipe'});
let browser,logs='';const errors=[],report={};
server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
await mkdir('.local',{recursive:true});
try {
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/models`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const models=await fetch(`${base}/api/models`).then(r=>r.json());
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  for(const model of models.filter(m=>m.available)) {
    await page.goto(`${base}/?model=${model.id}`);
    await page.waitForFunction(()=>window.flytastic?.ready||window.flytastic?.error,null,{timeout:120000});
    assert.equal(await page.evaluate(()=>window.flytastic.error),'');
    await page.waitForFunction(()=>window.flytastic?.labels?.flags==='ready'&&window.flytastic?.labels?.peaks==='ready',null,{timeout:30000});
    await page.waitForFunction(()=>window.flytastic.labels.shown>0,null,{timeout:60000});
    report[model.id]=await page.evaluate(()=>window.flytastic.labels);
    await page.screenshot({path:`.local/labels-${model.id}.png`});
    const pose=await page.evaluate(()=>window.flytasticSession.camera());
    await page.locator('#village-names').uncheck();await page.locator('#mountain-peaks').uncheck();
    await page.waitForFunction(()=>window.flytastic.labels.shown===0);
    assert.deepEqual(await page.evaluate(()=>window.flytasticSession.camera()),pose,'Layer toggles preserve camera');
    assert.equal(await page.locator('#overlay-credits').isVisible(),false);
    await page.reload();
    await page.waitForFunction(()=>window.flytastic?.ready,null,{timeout:120000});
    assert.equal(await page.locator('#village-names').isChecked(),false);assert.equal(await page.locator('#mountain-peaks').isChecked(),false);
    await page.locator('#mountain-peaks').check();
    await page.waitForFunction(()=>window.flytastic.labels.shown>0,null,{timeout:60000});
    await page.screenshot({path:`.local/peaks-${model.id}.png`});
    await page.locator('#village-names').check();await page.locator('#mountain-peaks').uncheck();
    await page.waitForFunction(()=>window.flytastic.labels.shown>0,null,{timeout:60000});
    await page.screenshot({path:`.local/villages-${model.id}.png`});
    // Missing optional data must leave flight and the other layer available.
    await page.route('**/overlays/peaks.json',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.reload();
    await page.waitForFunction(()=>window.flytastic?.ready&&window.flytastic?.labels?.peaks==='error',null,{timeout:120000});
    assert.equal(await page.evaluate(()=>window.flytastic.error),'');
    assert.equal(await page.locator('#mountain-peaks').isDisabled(),true);
    await page.unroute('**/overlays/peaks.json');
  }
  assert.deepEqual(errors,[]);
  await writeFile('.local/labels-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch(error){console.error(logs);throw error;}
finally{await browser?.close();server.kill();}
