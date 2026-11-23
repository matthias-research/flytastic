import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController, maximumFlightSpeed, MIN_PITCH, MAX_PITCH } from '../public/flight.js';
import { view } from '../public/math.js';

const make=(sample=()=>0,position={})=>new FlightController({east:632000,north:173000,height:650,heading:0,pitch:-.4,roll:0,...position},sample);
const run=(c,seconds,fps=60)=>{for(let i=0;i<seconds*fps;i++)c.step(1/fps);};

test('speed follows clearance, obeys the speed limit, and throttle cannot reverse',()=>{
  for(const [height,speed] of [[0,1000],[100,1000],[550,3000],[1000,5000],[2000,5000]])assert.equal(maximumFlightSpeed(height),speed);
  const c=make(()=>1000,{height:1550});c.step(0);assert.equal(c.speed,3000);
  c.speedLimit=270;assert.equal(c.speed,270);
  c.y=.5;run(c,2);assert.equal(c.state.velocity,.5);
  c.y=-1;run(c,2);assert.equal(c.state.velocity,0);
  const north=c.state.north;run(c,1);assert.equal(c.state.north,north);
});

test('turns bank smoothly and release levels out while cruise keeps heading',()=>{
  const c=make();c.cruise=true;c.x=1;run(c,3);
  assert.ok(c.state.roll>.17&&c.state.roll<=10*Math.PI/180);
  const heading=c.state.heading;run(c,1);assert.ok(Math.abs(c.state.heading-heading-10*Math.PI/180)<1e-8);
  c.x=0;run(c,4);assert.ok(Math.abs(c.state.roll)<1e-6);
  const after=c.state.heading,north=c.state.north;run(c,1);
  assert.equal(c.state.heading,after);assert.ok(c.state.north>north);
});

test('target clearance follows changing ground smoothly and tolerates missing samples',()=>{
  let ground;
  const c=make(()=>ground,{height:1234});c.cruise=true;run(c,1);
  assert.equal(c.clearance,null);assert.equal(c.state.north,173000);
  ground=1000;run(c,1);assert.equal(c.clearance,234);
  ground=1100;run(c,20);assert.ok(Math.abs(c.state.height-1334)<.01);
  ground=undefined;run(c,1);assert.ok(Number.isFinite(c.state.height));
  ground=900;run(c,20);assert.ok(Math.abs(c.state.height-1134)<.01);
  c.clearance=800;c.step(1/60);assert.ok(c.state.height<1700);
  run(c,20);assert.ok(Math.abs(c.state.height-1700)<.02);
});

test('terrain lookahead climbs before reaching a slope and protects ground clearance',()=>{
  const terrain=(_east,north)=>north>173020?500:0;
  const c=make(terrain,{height:50});c.y=.2;
  run(c,.3);assert.ok(c.state.north<173020);assert.ok(c.state.height>50);
  for(let i=0;i<600;i++){c.step(1/60);assert.ok(c.state.height>=terrain(c.state.east,c.state.north)+50);}
});

test('manual pitch stays selected through terrain climbs, descents, stops and flight entry',()=>{
  let ground=0;
  const c=make(()=>ground,{pitch:MIN_PITCH,height:200});c.y=.1;run(c,2);
  assert.equal(c.state.pitch,MIN_PITCH,'Flight entry retains a pitch below the old automatic baseline');
  ground=100;run(c,2);assert.equal(c.state.pitch,MIN_PITCH);assert.ok(c.state.height>200);
  c.viewPitch=.4;run(c,1);assert.equal(c.state.pitch,.4);
  ground=0;c.y=0;run(c,10);assert.equal(c.state.pitch,.4);
  c.viewPitch=10;c.step(1/60);assert.equal(c.state.pitch,MAX_PITCH);
  c.viewPitch=-10;c.step(1/60);assert.equal(c.state.pitch,MIN_PITCH);
});

test('higher clearances smooth terrain more and respond more slowly',()=>{
  let ground=0;
  const low=make(()=>ground,{height:100}),high=make(()=>ground,{height:1200});
  low.step(0);high.step(0);ground=40;run(low,.5);run(high,.5);
  assert.ok(low.state.height-100>high.state.height-1200);
  const hill=(x,y)=>200*Math.exp(-((x-632000)**2+(y-173000)**2)/10000);
  const a=make(hill,{height:300}),b=make(hill,{height:1400});run(a,20);run(b,20);
  assert.ok(b.state.height-b.clearance<a.state.height-a.clearance);
});

test('flight is stable across frame rates, suspension gaps, and model boundaries',()=>{
  const a=make(),b=make();for(const c of [a,b]){c.cruise=true;c.x=.5;}
  run(a,4,30);run(b,4,120);assert.ok(Math.abs(a.state.heading-b.state.heading)<.005);
  assert.ok(Math.hypot(a.state.east-b.state.east,a.state.north-b.state.north)<5);
  const before=a.state.north;a.step(60);assert.ok(Math.abs(a.state.north-before)<300);
  const edge=new FlightController({east:0,north:0,height:650,heading:0,pitch:0,roll:0},()=>0,[-20,-20,20,20]);
  edge.cruise=true;run(edge,1);assert.equal(edge.state.north,20);assert.equal(edge.cruise,false);assert.equal(edge.state.velocity,0);assert.equal(edge.boundaryReached,true);
});

test('camera banking rotates right/up axes while preserving an orthonormal view',()=>{
  const matrix=view([632,2,-173],1.2,-.3,.15);
  const rows=[0,1,2].map(i=>[matrix[i],matrix[i+4],matrix[i+8]]);
  const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
  for(const row of rows)assert.ok(Math.abs(dot(row,row)-1)<1e-6);
  assert.ok(Math.abs(dot(rows[0],rows[1]))<1e-6);
  assert.ok(Math.abs(dot(rows[0],rows[2]))<1e-6);
  const straight=view([0,0,0],0,0),banked=view([0,0,0],0,0,.15);
  assert.equal(straight[4],0);assert.ok(banked[4]<0);
});
