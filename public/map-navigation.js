import { clamp,MIN_PITCH,MAX_PITCH } from './flight.js';

const add=(a,b)=>a.map((v,i)=>v+b[i]);
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const scale=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const normalize=a=>scale(a,1/Math.hypot(...a));
const rotate=(v,axis,angle)=>{
  const c=Math.cos(angle),s=Math.sin(angle),d=dot(v,axis)*(1-c);
  const cross=[axis[1]*v[2]-axis[2]*v[1],axis[2]*v[0]-axis[0]*v[2],axis[0]*v[1]-axis[1]*v[0]];
  return v.map((n,i)=>n*c+cross[i]*s+axis[i]*d);
};

// Coordinates match the flight camera: kilometres, east/up/negative-north.
export class MapCamera {
  constructor(state,{ground,bounds,pick=()=>undefined,size}){Object.assign(this,{state,ground,bounds,pick,size});}
  ray(point) {
    const {yaw,pitch,roll}=this.state,{width,height}=this.size();
    const s=Math.sin(yaw),c=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
    const right=[c,0,s],up=[-s*sp,cp,c*sp],forward=[s*cp,sp,-c*cp];
    const x=(2*point.x/width-1)*width/height*Math.tan(Math.PI/6),y=(1-2*point.y/height)*Math.tan(Math.PI/6);
    return normalize(forward.map((v,i)=>v+x*(right[i]*cr-up[i]*sr)+y*(up[i]*cr+right[i]*sr)));
  }
  height(east,north) {
    const [w,s,e,n]=this.bounds();
    return east>=w&&east<=e&&north>=s&&north<=n?this.ground(east,north):undefined;
  }
  plane(point,height) {
    const ray=this.ray(point),distance=(height-this.state.eye[1])/ray[1];
    return Math.abs(ray[1])>1.e-6&&distance>0&&distance<150?add(this.state.eye,scale(ray,distance)):undefined;
  }
  anchor(point) {
    const picked=this.pick(point.x,point.y);
    if(picked?.every(Number.isFinite))return picked;
    const eye=this.state.eye,ray=this.ray(point);
    // Ray march the original height grid, then refine its first intersection.
    let previous=0;
    for(let distance=.03;distance<100;distance=distance*1.12+.015) {
      const p=add(eye,scale(ray,distance)),height=this.height(p[0],-p[2]);
      if(Number.isFinite(height)&&p[1]<=height) {
        let low=previous,high=distance;
        for(let i=0;i<16;i++) {
          const mid=(low+high)/2,q=add(eye,scale(ray,mid)),h=this.height(q[0],-q[2]);
          if(Number.isFinite(h)&&q[1]<=h)high=mid;else low=mid;
        }
        return add(eye,scale(ray,(low+high)/2));
      }
      previous=distance;
    }
    const ground=this.height(eye[0],-eye[2])??Math.max(0,eye[1]-.65);
    const plane=this.plane(point,ground);
    if(plane)return plane;
    // A sky gesture still works; use a nearby ground pivot without rotating
    // the camera to face it or changing the view on pointer-down.
    const distance=clamp((eye[1]-ground)*2,.2,15);
    return [eye[0]+Math.sin(this.state.yaw)*distance,ground,eye[2]-Math.cos(this.state.yaw)*distance];
  }
  constrain() {
    const eye=this.state.eye,[w,s,e,n]=this.bounds();
    eye[0]=clamp(eye[0],w+.05,e-.05);eye[2]=clamp(eye[2],-n+.05,-s-.05);
    const ground=this.height(eye[0],-eye[2]);
    eye[1]=clamp(eye[1],Number.isFinite(ground)?ground+.035:.035,20);
  }
  pan(from,to,anchor) {
    const a=this.plane(from,anchor[1]),b=this.plane(to,anchor[1]);
    if(a&&b)this.state.eye=add(this.state.eye,subtract(a,b));
    else {
      const {height}=this.size(),distance=Math.hypot(...subtract(this.state.eye,anchor));
      const speed=2*distance*Math.tan(Math.PI/6)/height,dx=(to.x-from.x)*speed,dy=(to.y-from.y)*speed;
      const {yaw}=this.state;
      this.state.eye=add(this.state.eye,[-Math.cos(yaw)*dx-Math.sin(yaw)*dy,0,-Math.sin(yaw)*dx+Math.cos(yaw)*dy]);
    }
    this.constrain();
  }
  zoom(factor,anchor) {
    this.state.eye=add(anchor,scale(subtract(this.state.eye,anchor),factor));this.constrain();
  }
  orbit(dx,dy,anchor) {
    const state=this.state,dyaw=-dx*.005,pitch=clamp(state.pitch+dy*.005,MIN_PITCH,MAX_PITCH),dpitch=pitch-state.pitch;
    let offset=rotate(subtract(state.eye,anchor),[0,1,0],-dyaw);
    state.yaw+=dyaw;
    offset=rotate(offset,[Math.cos(state.yaw),0,Math.sin(state.yaw)],dpitch);
    state.eye=add(anchor,offset);state.pitch=pitch;this.constrain();
  }
}

export function configureMapNavigation({element,state,ground,bounds,pick,activate,enabled,onChange}) {
  const camera=new MapCamera(state,{ground,bounds,pick,size:()=>({width:element.clientWidth,height:element.clientHeight})});
  const pointers=new Map();let anchor,orbit=false,pinch;
  const point=e=>{const r=element.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const pair=()=>{
    const [a,b]=[...pointers.values()];
    return {center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
  };
  function rebase() {
    pinch=pointers.size>=2?pair():null;
    if(pointers.size)anchor=camera.anchor(pinch?.center??[...pointers.values()][0]);
  }
  function cancel() {
    const ids=[...pointers.keys()];pointers.clear();pinch=null;
    for(const id of ids)if(element.hasPointerCapture(id))element.releasePointerCapture(id);
  }
  element.addEventListener('pointerdown',e=>{
    if(e.button>2||!activate())return;
    e.preventDefault();element.focus({preventScroll:true});pointers.set(e.pointerId,point(e));element.setPointerCapture(e.pointerId);
    if(pointers.size===1)orbit=e.button!==0||e.ctrlKey;
    rebase();
  },{capture:true});
  element.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId)||!enabled())return;
    const before=pointers.get(e.pointerId),after=point(e);pointers.set(e.pointerId,after);
    if(pointers.size>=2) {
      const next=pair();camera.zoom(pinch.distance/next.distance,anchor);camera.pan(pinch.center,next.center,anchor);pinch=next;
    }else if(orbit)camera.orbit(after.x-before.x,after.y-before.y,anchor);
    else camera.pan(before,after,anchor);
    onChange();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,e=>{
    if(!pointers.delete(e.pointerId))return;
    if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);
    rebase();
  });
  element.addEventListener('wheel',e=>{
    if(!activate())return;
    e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?element.clientHeight:1);
    camera.zoom(Math.exp(clamp(delta*.0015,-.6,.6)),camera.anchor(point(e)));onChange();
  },{passive:false,capture:true});
  element.addEventListener('contextmenu',e=>e.preventDefault());
  return {cancel};
}
