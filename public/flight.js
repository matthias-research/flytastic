// Adapted from Swiss Explorer's FlightController. Coordinates and heights are
// local Swiss-grid meters; heading/pitch/roll are radians, speed is km/h.
const radians=degrees=>degrees*Math.PI/180;
export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const approach=(value,target,amount)=>value+clamp(target-value,-amount,amount);
const ease=(value,target,dt,tau)=>value+(target-value)*-Math.expm1(-dt/tau);
const signedAngle=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
export const maximumFlightSpeed=clearance=>1000+clamp((clearance-100)/900,0,1)*4000;

export class FlightController {
  constructor(position,sampleGround=()=>0,bounds=null) {
    this.state={...position,pitch:Math.max(position.pitch,radians(-20)),roll:signedAngle(position.roll??0),velocity:0,turn:0};
    this.sampleGround=sampleGround;this.bounds=bounds;
    this.clearance=null;this.lastGround=undefined;this.cruise=false;
    this.x=0;this.y=0;this.speedLimit=5000;this.viewPitch=radians(-20);
    this.pitchHistorySeconds=0;this.boundaryReached=false;
  }
  get speed(){return Math.min(this.speedLimit,maximumFlightSpeed(this.state.height-(this.lastGround??this.state.height)));}
  followTerrain(dt) {
    const s=this.state, sample=(east,north)=>this.sampleGround(s.east+east,s.north+north);
    const measured=sample(0,0);
    if(Number.isFinite(measured))this.lastGround=measured;
    const ground=this.lastGround;if(!Number.isFinite(ground))return;
    const height=(east,north)=>{const value=sample(east,north);return Number.isFinite(value)?value:ground;};
    const h=this.clearance;
    const average=(ground+height(h,0)+height(-h,0)+height(0,h)+height(0,-h))/5;
    const buffer=Math.min(h,100);
    let target=Math.max(average+h,ground+buffer);
    const speed=s.velocity*this.speed/3.6;
    if(Math.abs(speed)>.1)for(const seconds of [1,2,4,6]) {
      const distance=speed*seconds;
      const ahead=height(Math.sin(s.heading)*distance,Math.cos(s.heading)*distance);
      target=Math.max(target,ahead+buffer-Math.abs(distance)*.18);
    }
    s.height=Math.min(20000,Math.max(ground+Math.min(h,80),ease(s.height,target,dt,.7+h/1800)));
  }
  step(elapsed) {
    if(this.clearance===null) {
      const ground=this.sampleGround(this.state.east,this.state.north);
      if(!Number.isFinite(ground))return;
      this.lastGround=ground;this.clearance=Math.max(1,this.state.height-ground);
    }
    let remaining=clamp(elapsed,0,.2);
    while(remaining>1e-8) {
      const dt=Math.min(remaining,1/60),s=this.state;
      const previousEast=s.east,previousNorth=s.north,previousHeight=s.height;
      const throttle=clamp(this.y,0,1),motion=throttle>.02?throttle:Number(this.cruise);
      s.velocity=approach(s.velocity,motion,dt/.35);
      s.turn=approach(s.turn,clamp(this.x,-1,1),dt);
      s.heading=(s.heading+s.turn*radians(10)*dt+Math.PI*2)%(Math.PI*2);
      const distance=s.velocity*this.speed/3.6*dt;
      s.east+=Math.sin(s.heading)*distance;s.north+=Math.cos(s.heading)*distance;
      if(this.bounds) {
        const [west,south,east,north]=this.bounds;
        const x=clamp(s.east,west,east),y=clamp(s.north,south,north);
        if(x!==s.east||y!==s.north) {
          s.east=x;s.north=y;s.velocity=0;s.turn=0;
          this.cruise=false;this.x=this.y=0;this.boundaryReached=true;
        }
      }
      const targetRoll=s.turn*radians(10)*Math.sign(s.velocity);
      s.roll=signedAngle(s.roll+signedAngle(targetRoll-s.roll)*-Math.expm1(-dt/.2));
      this.followTerrain(dt);
      const horizontalDistance=Math.hypot(s.east-previousEast,s.north-previousNorth);
      const pathAngle=Math.atan2(s.height-previousHeight,Math.max(horizontalDistance,dt));
      const warmup=clamp(this.pitchHistorySeconds,0,1);
      const pitchOffset=s.velocity===0?0:clamp(pathAngle,0,radians(65))*warmup*warmup*(3-2*warmup);
      this.pitchHistorySeconds+=dt;
      s.pitch=Math.max(this.viewPitch,ease(s.pitch,this.viewPitch+pitchOffset,dt,.6));
      remaining-=dt;
      if(this.boundaryReached)break;
    }
  }
}
