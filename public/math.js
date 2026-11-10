export function perspective(fov, aspect, near, far) {
  const f=1/Math.tan(fov/2), r=1/(near-far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*r,-1, 0,0,2*far*near*r,0]);
}
export function view(eye, yaw, pitch, roll=0) {
  const s=Math.sin(yaw), c=Math.cos(yaw), sp=Math.sin(pitch), cp=Math.cos(pitch);
  const baseRight=[c,0,s], baseUp=[-s*sp,cp,c*sp], back=[-s*cp,-sp,c*cp];
  const cr=Math.cos(roll),sr=Math.sin(roll);
  const right=baseRight.map((v,i)=>v*cr-baseUp[i]*sr),up=baseUp.map((v,i)=>v*cr+baseRight[i]*sr);
  const dot=a=>a[0]*eye[0]+a[1]*eye[1]+a[2]*eye[2];
  return new Float32Array([right[0],up[0],back[0],0,right[1],up[1],back[1],0,right[2],up[2],back[2],0,-dot(right),-dot(up),-dot(back),1]);
}
