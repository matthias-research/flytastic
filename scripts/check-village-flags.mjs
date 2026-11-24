import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {wgsToSwiss} from '../public/swiss-coordinates.js';
import {cameraHash} from '../public/camera-state.js';

const port='3032',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port},windowsHide:true,stdio:'pipe'});
let browser,page,phase='',logs='';const errors=[],report=[];
server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
await mkdir('.local',{recursive:true});
try {
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/models`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const models=await fetch(`${base}/api/models`).then(r=>r.json());
  const village=JSON.parse(await readFile('public/overlays/village-flags.json','utf8'));
  const parent=JSON.parse(await readFile('public/overlays/flags.json','utf8'));
  const places=JSON.parse(await readFile('public/overlays/villages.json','utf8')).places;
  browser=await chromium.launch({channel:'msedge',headless:true});
  async function openPage() {
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const prototype=CanvasRenderingContext2D.prototype,draw=prototype.drawImage,fill=prototype.fillText;
    window.__labelImages=[];
    prototype.fillText=function(text,...args){this.__labelText=text;return fill.call(this,text,...args);};
    prototype.drawImage=function(image,...args){
      if(this.canvas.id==='geographic-labels') {
        window.__labelImages.push({text:this.__labelText,rect:args.slice(0,4),width:image.naturalWidth});
        if(window.__labelImages.length>500)window.__labelImages.shift();
      }
      return draw.call(this,image,...args);
    };
  });
  }
  for(const model of models.filter(m=>m.available))for(const id of [30757706,3029228685]) {
    phase=`${model.id}/${id}: own artwork`;
    await openPage();
    const p=places.find(p=>p.id===id),[east,north]=wgsToSwiss(p.longitude,p.latitude);
    const hash=cameraHash({eye:[east/1000,1.3,-(north/1000-2)],yaw:0,pitch:-.4,roll:0,speed:5000,destination:'interlaken'});
    await page.goto(`${base}/?model=${model.id}&peaks=0${hash}`);
    await page.waitForFunction(()=>window.flytastic?.ready&&window.flytastic?.labels?.villageFlags==='ready',null,{timeout:120000});
    const row=village.places.find(r=>r[0]===id),asset=village.assets[row[3]];
    assert.ok(asset.rect,'Examples should use their own village sheet artwork');
    await page.waitForFunction(({name,rect})=>window.__labelImages.some(d=>d.text===name&&JSON.stringify(d.rect)===JSON.stringify(rect)),{name:p.name,rect:asset.rect},{timeout:45000});
    await page.screenshot({path:`.local/village-${id}-${model.id}.png`});
    report.push({model:model.id,place:p.name,ownImage:true,rect:asset.rect});
    // With an unavailable village sheet the original municipality image survives.
    phase=`${model.id}/${id}: municipality fallback`;
    await page.route('**/overlays/village-flags-*.png',route=>route.fulfill({status:503,headers:{'Cache-Control':'no-store'},body:'unavailable'}));
    await page.reload();
    await page.waitForFunction(()=>window.flytastic?.ready&&window.flytastic?.labels?.villageFlags==='error',null,{timeout:120000});
    const bfs=parent.places.find(r=>r[0]===id)[3],rect=parent.regions[bfs];
    await page.waitForFunction(({name,rect})=>window.__labelImages.some(d=>d.text===name&&JSON.stringify(d.rect)===JSON.stringify(rect)),{name:p.name,rect},{timeout:45000});
    assert.equal(await page.evaluate(()=>window.flytastic.error),'');
    await page.unroute('**/overlays/village-flags-*.png');
    await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile('.local/village-flags-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}catch(e){console.error(logs,phase,page?.url());if(page&&!page.isClosed()){console.error(await page.evaluate(()=>window.flytastic).catch(()=>null));await page.screenshot({path:'.local/village-flags-failure.png'}).catch(()=>{});}throw e;}
finally{await browser?.close();server.kill();}
