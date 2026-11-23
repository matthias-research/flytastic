// Shared by the original terrain shader and Cesium's globe material.
// Metres throughout; world-space variation stays fixed while flying.
export const snowGLSL=`
float snowHash(vec3 p) {
  p=fract(p*.1031);
  p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
float snowNoise(vec3 p) {
  vec3 cell=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(snowHash(cell),snowHash(cell+vec3(1,0,0)),f.x),
                 mix(snowHash(cell+vec3(0,1,0)),snowHash(cell+vec3(1,1,0)),f.x),f.y),
             mix(mix(snowHash(cell+vec3(0,0,1)),snowHash(cell+vec3(1,0,1)),f.x),
                 mix(snowHash(cell+vec3(0,1,1)),snowHash(cell+vec3(1,1,1)),f.x),f.y),f.z);
}
float snowLuminance(vec3 photo) {
  return dot(photo,vec3(.2126,.7152,.0722));
}
float snowCoverage(float heightMeters,float upFacing,vec3 worldMeters,float snowLine,vec3 photo) {
  float variation=(snowNoise(worldMeters/350.0)-.5)*180.0;
  // Small photographic features break up the broad elevation/slope mask.
  float detail=snowLuminance(photo)-.35;
  variation+=detail*90.0;
  float elevation=smoothstep(snowLine-120.0,snowLine+180.0,heightMeters+variation);
  float accumulation=smoothstep(.35,.8,clamp(upFacing+detail*.14,0.0,1.0));
  return elevation*accumulation*.9;
}
const vec3 snowColor=vec3(.94,.955,.96);
vec4 snowAppearance(vec3 photo,float coverage) {
  float luminance=snowLuminance(photo);
  float green=smoothstep(.015,.13,photo.g-(photo.r+photo.b)*.5);
  float dark=1.0-smoothstep(.07,.42,luminance);
  float shelter=clamp(dark*.65+green*.35,0.0,1.0);
  // Carry the photo's fine contrast and existing shadows into neutral snow.
  // Dark/green texture shows through more, suggesting vegetation and crevices.
  vec3 tint=snowColor*mix(.82,1.0,smoothstep(.025,.7,luminance));
  return vec4(tint,coverage*mix(1.0,.72,shelter));
}
`;
