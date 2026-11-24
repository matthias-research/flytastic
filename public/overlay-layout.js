import { view } from './math.js';

export function projectLabel(state, point, width, height) {
  const m=view([0,0,0],state.yaw,state.pitch,state.roll),d=point.map((v,i)=>v-state.eye[i]);
  const x=m[0]*d[0]+m[4]*d[1]+m[8]*d[2],y=m[1]*d[0]+m[5]*d[1]+m[9]*d[2],z=m[2]*d[0]+m[6]*d[1]+m[10]*d[2];
  if(z>=-.03||z< -100)return;
  return {x:width/2+x/(-z*Math.tan(Math.PI/6))*height/2,y:height/2-y/(-z*Math.tan(Math.PI/6))*height/2};
}
export const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
export function labelBox(pixel,width,flag=false) {
  return {left:pixel.x-width/2-5,right:pixel.x+width/2+5,top:pixel.y-(flag?49:23),bottom:pixel.y+5};
}
export function parseElevation(value) {
  const text=String(value??'').trim().replace(/\s*m$/i,'');
  if(!/^\d+(?:[.,]\d+)?$/.test(text))return;
  const n=Number(text.replace(',','.'));
  return Number.isFinite(n)&&n>0&&n<5000?n:undefined;
}
