// swisstopo's approximate WGS84/CH1903 formulas: metres and decimal degrees.
// Used for the shared Swiss-grid camera and surface-raster lookup.
export function wgsToSwiss(longitude, latitude, height = 0) {
  const a=(latitude*3600-169028.66)/10000, b=(longitude*3600-26782.5)/10000;
  return [600072.37+211455.93*b-10938.51*b*a-.36*b*a*a-44.54*b*b*b,
    200147.07+308807.95*a+3745.25*b*b+76.63*a*a-194.56*b*b*a+119.79*a*a*a,
    height]; // Keep the terrain service's published heights; no datum offset.
}

export function swissToWgs(east, north) {
  const a=(east-600000)/1000000, b=(north-200000)/1000000;
  let lon=(2.6779094+4.728982*a+.791484*a*b+.1306*a*b*b-.0436*a*a*a)*100/36;
  let lat=(16.9023892+3.238272*b-.270978*a*a-.002528*b*b-.0447*a*a*b-.014*b*b*b)*100/36;
  // Numerically invert the forward formula so adjacent patches use the same
  // coordinate transform in both directions, including at tile boundaries.
  for(let i=0;i<3;i++) {
    const p=wgsToSwiss(lon,lat), dx=wgsToSwiss(lon+.00001,lat), dy=wgsToSwiss(lon,lat+.00001);
    const ex=east-p[0], ny=north-p[1], a=dx[0]-p[0], b=dy[0]-p[0], c=dx[1]-p[1], d=dy[1]-p[1], det=a*d-b*c;
    lon+=(ex*d-ny*b)/det*.00001; lat+=(ny*a-ex*c)/det*.00001;
  }
  return [lon,lat];
}
