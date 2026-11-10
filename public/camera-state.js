export function readCamera(hash) {
  try {
    const value=JSON.parse(new URLSearchParams(hash.replace(/^#/, '')).get('camera'));
    if(!value || !Array.isArray(value.eye) || value.eye.length!==3 || !value.eye.every(Number.isFinite))return null;
    if(!Number.isFinite(value.yaw)||!Number.isFinite(value.pitch)||Math.abs(value.pitch)>1.3)return null;
    if(value.eye[1]<0||value.eye[1]>20)return null;
    if(!Number.isFinite(value.speed)||value.speed<60||value.speed>5000)return null;
    if(value.roll!==undefined&&(!Number.isFinite(value.roll)||Math.abs(value.roll)>Math.PI))return null;
    return value;
  } catch {return null;}
}
export function cameraHash(camera) {
  return '#'+new URLSearchParams({camera:JSON.stringify(camera)});
}
export function cameraInBounds(camera,bounds) {
  const [west,south,east,north]=bounds;
  return camera.eye[0]>=west+.05 && camera.eye[0]<=east-.05 && -camera.eye[2]>=south+.05 && -camera.eye[2]<=north-.05;
}
