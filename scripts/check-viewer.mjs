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
async function checkMapNavigation(label) {
  const snapshot=()=>page.evaluate(()=>({pose:window.flytasticSession.camera(),mode:window.flytastic.navigationMode,active:window.flytastic.flightActive}));
  assert.equal((await snapshot()).mode,'map');
  await page.click('#fly');await page.waitForFunction(()=>window.flytastic.flightActive);
  await page.mouse.move(720,560);const flying=await snapshot();
  await page.mouse.wheel(0,160);
  await page.waitForFunction(()=>!window.flytastic.flightActive&&window.flytastic.navigationMode==='map');
  const zoomed=await snapshot();assert.ok(zoomed.pose.eye[1]>flying.pose.eye[1],'First wheel gesture stops flight and zooms out');
  await page.waitForTimeout(250);assert.deepEqual((await snapshot()).pose,zoomed.pose,'Flight cannot overwrite the map camera');
  await page.mouse.click(720,560);assert.deepEqual((await snapshot()).pose,zoomed.pose,'Clicking to use the map does not jump');
  await page.keyboard.down('w');await page.waitForFunction(()=>window.flytastic.navigationMode==='flight'&&window.flytastic.flightActive);await page.keyboard.up('w');
  const resumed=await snapshot();
  assert.ok(Math.hypot(...resumed.pose.eye.map((v,i)=>v-zoomed.pose.eye[i]))<.05,'Flight resumes from the map camera');
  await page.mouse.move(720,560);await page.mouse.down();
  await page.waitForFunction(()=>window.flytastic.navigationMode==='map'&&!window.flytastic.flightActive);
  const start=await snapshot();await page.mouse.move(770,585,{steps:5});await page.mouse.up();await page.waitForTimeout(50);
  const panned=await snapshot();assert.notDeepEqual(panned.pose.eye,start.pose.eye,'First drag pans immediately');
  assert.equal(panned.pose.yaw,start.pose.yaw);assert.equal(panned.pose.pitch,start.pose.pitch);
  await page.mouse.move(720,560);await page.mouse.down({button:'right'});await page.mouse.move(770,535,{steps:5});await page.mouse.up({button:'right'});await page.waitForTimeout(50);
  const orbited=await snapshot();assert.notEqual(orbited.pose.yaw,panned.pose.yaw);assert.notEqual(orbited.pose.pitch,panned.pose.pitch);assert.notDeepEqual(orbited.pose.eye,panned.pose.eye);
  await page.keyboard.down('Control');await page.mouse.move(720,560);await page.mouse.down();await page.mouse.move(695,545,{steps:3});await page.mouse.up();await page.keyboard.up('Control');await page.waitForTimeout(50);
  assert.notEqual((await snapshot()).pose.yaw,orbited.pose.yaw,'Control drag also orbits');
  await page.waitForTimeout(200);const linked=await snapshot();
  const saved=JSON.parse(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('camera'));
  assert.deepEqual(saved,linked.pose,'Map camera is saved in the URL');
  await page.locator('#flight-pitch-pad').focus();await page.locator('#flight-pitch-pad').press('ArrowDown');
  await page.waitForFunction(()=>window.flytastic.navigationMode==='flight');
  assert.deepEqual((await snapshot()).pose.eye,linked.pose.eye,'Pitch control switches modes without moving position');
  await page.check('#winter');await page.waitForTimeout(50);assert.equal((await snapshot()).mode,'flight','Settings preserve mode');
  await page.locator('#place-search').fill('Be');await page.locator('#place-search').press('Escape');await page.locator('#search-clear').click();
  assert.equal((await snapshot()).mode,'flight','Search typing and dismissal preserve mode');
  await page.uncheck('#winter');
  await page.mouse.click(720,560);await page.waitForFunction(()=>window.flytastic.navigationMode==='map');
  const client=await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  const beforePinch=await snapshot();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:680,y:560,id:1},{x:760,y:560,id:2}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:650,y:560,id:1},{x:790,y:560,id:2}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(100);assert.notDeepEqual((await snapshot()).pose.eye,beforePinch.pose.eye,'Two-finger pinch zooms');
  await client.send('Emulation.setTouchEmulationEnabled',{enabled:false});await client.detach();
  await page.screenshot({path:`.local/map-navigation-${label}.png`});
  await page.click('#reset');await ready();await settled();
  report[`mapNavigation-${label}`]=true;
}
async function checkSnowPhotoDetail() {
  const result=await page.evaluate(async()=>{
    const {snowGLSL}=await import('/snow.js');
    const canvas=document.createElement('canvas');canvas.width=6;canvas.height=1;
    const gl=canvas.getContext('webgl2',{premultipliedAlpha:false,antialias:false});
    try {
      const shader=(type,source)=>{
        const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
        if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;
      };
      const p=gl.createProgram();
      gl.attachShader(p,shader(gl.VERTEX_SHADER,`#version 300 es
        void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`));
      gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`#version 300 es
        precision highp float;uniform sampler2D photo;out vec4 color;
        ${snowGLSL}
        void main(){
          vec3 c=texture(photo,gl_FragCoord.xy/vec2(6,1)).rgb;
          vec4 snow=snowAppearance(c,snowCoverage(2000.,1.,vec3(0),1000.,c));
          color=vec4(mix(c,snow.rgb,snow.a),snow.a);
        }`));
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
      gl.useProgram(p);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,6,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([
        20,20,20, 80,80,80, 170,170,170, 25,85,25, 68,68,68, 255,255,255,
      ]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.drawArrays(gl.TRIANGLES,0,3);
      const pixels=new Uint8Array(24);gl.readPixels(0,0,6,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return {pixels:[...pixels],error:gl.getError()};
    }finally{gl.getExtension('WEBGL_lose_context')?.loseContext();}
  });
  const p=result.pixels;
  assert.equal(result.error,0);
  assert.ok(p[0]<p[4]&&p[4]<p[8],'Photo texture varies snow brightness on one flat triangle');
  assert.ok(p[15]<p[19],'Green image texture reduces coverage relative to equally bright gray');
  assert.ok(p[0]>140&&p[20]>230,'Snow stays bright while retaining photo contrast');
  report.snowPhotoDetail=true;
}
async function checkWinter(label) {
  const pose=await page.evaluate(()=>window.flytasticSession.camera());
  const canvas=page.locator(label==='original'?'#scene':'#cesium-scene canvas');
  const before=await canvas.screenshot();
  await page.check('#winter');
  await page.locator('#snow-line').fill('0');await page.locator('#snow-line').dispatchEvent('input');
  await page.waitForFunction(()=>window.flytastic.winter&&window.flytastic.snowLine===0);
  await page.waitForTimeout(1200);
  const snowy=await canvas.screenshot();
  assert.notDeepEqual(snowy,before,'Winter changes rendered terrain pixels');
  assert.deepEqual(await page.evaluate(()=>window.flytasticSession.camera()),pose,'Winter preserves the camera');
  assert.equal(await page.evaluate(()=>window.flytastic.glError),0);
  assert.equal(await page.evaluate(()=>window.flytastic.error),'');
  assert.equal(new URL(page.url()).searchParams.get('winter'),'1');
  await page.screenshot({path:`.local/winter-${label}.png`});
  await page.locator('#snow-line').fill('3500');await page.locator('#snow-line').dispatchEvent('input');
  await page.waitForTimeout(300);
  assert.notDeepEqual(await canvas.screenshot(),snowy,'Snow line changes rendered snow coverage');
  await page.uncheck('#winter');
  await page.locator('#snow-line').evaluate(el=>{el.value='1600';el.dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>!window.flytastic.winter&&window.flytastic.snowLine===1600);
  assert.equal(await page.locator('#snow-settings').isVisible(),false);
  report[`winter-${label}`]=true;
}
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
    await checkWinter('original');
    await checkPitch();report.originalPitchControl=true;
    await checkMapNavigation('original');
    await page.selectOption('#model','swisstopo');
  }else await page.goto(`${base}/?model=swisstopo`);
  phase='ground';await ready();await settled();
  await checkSnowPhotoDetail();
  assert.equal(await page.locator('#flattened').isChecked(),true);
  await checkWinter('ground');
  await checkPitch(true);report.cesiumPitchControl=true;
  await checkMapNavigation('ground');
  report.ground=await page.evaluate(()=>({status:window.flytastic,pose:window.flytasticSession.camera(),height:window.flytasticSession.sampleHeight(632,173)}));
  assert.equal(report.ground.status.rendererId,'cesium');assert.equal(report.ground.status.model,'swisstopo');
  phase='surface';await page.uncheck('#flattened');await ready();
  await page.waitForFunction(()=>window.flytastic?.flattened===false&&window.flytastic.surface?.raised>0,null,{timeout:180000});
  await settled();
  report.surface=await page.evaluate(()=>({status:window.flytastic,pose:window.flytasticSession.camera(),height:window.flytasticSession.sampleHeight(632,173)}));
  assert.equal(report.surface.status.rendererId,'cesium');assert.deepEqual(report.surface.pose,report.ground.pose);
  assert.ok(report.surface.status.surface.raised>0);assert.ok(report.surface.height>report.ground.height+1,'The non-flattened heightfield raises canopy heights');
  assert.equal(report.surface.status.glError,0);assert.equal(report.surface.status.error,'');
  await checkWinter('surface');
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
  await checkMapNavigation('surface');
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
