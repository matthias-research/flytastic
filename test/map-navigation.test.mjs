import test from 'node:test';
import assert from 'node:assert/strict';
import { MapCamera } from '../public/map-navigation.js';
import { view } from '../public/math.js';

function fixture(roll=0) {
  const state={eye:[632,3,-173],yaw:.4,pitch:-.65,roll};
  const camera=new MapCamera(state,{ground:()=>1,bounds:()=>[480,70,840,300],size:()=>({width:1200,height:800})});
  return {state,camera};
}
// Project with the renderer's actual view transform to catch axis/sign errors.
function project(state,p) {
  const m=view([0,0,0],state.yaw,state.pitch,state.roll),d=p.map((v,i)=>v-state.eye[i]);
  const x=m[0]*d[0]+m[4]*d[1]+m[8]*d[2],y=m[1]*d[0]+m[5]*d[1]+m[9]*d[2],z=m[2]*d[0]+m[6]*d[1]+m[10]*d[2];
  return {x:(x/(-z*Math.tan(Math.PI/6)*1.5)+1)*600,y:(1-y/(-z*Math.tan(Math.PI/6)))*400};
}
const close=(a,b)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.001,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test('terrain-anchored zoom and pan preserve the point under the cursor, including banked views',()=>{
  for(const roll of [0,.3]) {
    const {state,camera}=fixture(roll),from={x:780,y:550},to={x:830,y:580};
    const anchor=camera.anchor(from);assert.ok(Math.abs(anchor[1]-1)<.0001);close(project(state,anchor),from);
    const start=[...state.eye];camera.zoom(.7,anchor);close(project(state,anchor),from);
    assert.ok(state.eye[1]<start[1]);camera.zoom(1/.7,anchor);
    assert.ok(Math.hypot(...state.eye.map((v,i)=>v-start[i]))<1.e-10);
    const orientation=[state.yaw,state.pitch,state.roll];
    camera.pan(from,to,anchor);close(project(state,anchor),to);
    assert.deepEqual([state.yaw,state.pitch,state.roll],orientation);
  }
});

test('orbit preserves the terrain pivot and range without changing the view on activation',()=>{
  const {state,camera}=fixture(),point={x:600,y:400},before=structuredClone(state);
  const anchor=camera.anchor(point);assert.deepEqual(state,before);
  const range=Math.hypot(...anchor.map((v,i)=>v-state.eye[i]));
  camera.orbit(50,-20,anchor);close(project(state,anchor),point);
  assert.ok(Math.abs(Math.hypot(...anchor.map((v,i)=>v-state.eye[i]))-range)<1.e-10);
  assert.notEqual(state.yaw,before.yaw);assert.notEqual(state.pitch,before.pitch);
});

test('zoom limits, missing terrain and sky gestures remain finite and inside the map',()=>{
  const {state,camera}=fixture();state.pitch=.5;
  camera.ground=()=>undefined;
  const anchor=camera.anchor({x:600,y:100});assert.ok(anchor.every(Number.isFinite));
  for(const factor of [.001,100000]) {
    camera.zoom(factor,anchor);
    assert.ok(state.eye.every(Number.isFinite));assert.ok(state.eye[1]>=.035&&state.eye[1]<=20);
    assert.ok(state.eye[0]>=480.05&&state.eye[0]<=839.95);assert.ok(-state.eye[2]>=70.05&&-state.eye[2]<=299.95);
  }
  camera.ground=()=>2;state.eye=[632,2.05,-173];camera.zoom(.0001,[632,2,-173]);
  assert.ok(state.eye[1]>=2.035);
});
