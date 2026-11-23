// Average complete 8 m footprints from an available COG overview. Keeping a
// small field releases the much larger compressed and decoded source arrays.
export function averageSurface(values,width,height,bounds,noData=-9999) {
  const columns=Math.round((bounds[2]-bounds[0])/8),rows=Math.round((bounds[3]-bounds[1])/8),out=new Float32Array(columns*rows);out.fill(NaN);
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++) {
    const x0=Math.floor(x*width/columns),x1=Math.floor((x+1)*width/columns),y0=Math.floor(y*height/rows),y1=Math.floor((y+1)*height/rows);
    let sum=0,count=0;
    for(let sy=y0;sy<y1;sy++)for(let sx=x0;sx<x1;sx++){const v=values[sy*width+sx];if(Number.isFinite(v)&&v!==noData&&v>=0&&v<6553.5){sum+=v;count++;}}
    if(count)out[y*columns+x]=sum/count;
  }
  return {values:out,width:columns,height:rows,bounds};
}
export function sampleSurface(fields,east,north) {
  // LV95 differs from LV03 primarily by these offsets. Residual horizontal
  // datum differences are about a metre, below the 8 m sampled footprints.
  east+=2000000;north+=1000000;
  const gx=(east-4)/8,gy=(north-4)/8,ix=Math.floor(gx),iy=Math.floor(gy),u=gx-ix,v=gy-iy;
  let value=0;
  for(const [dx,dy,weight] of [[0,0,(1-u)*(1-v)],[1,0,u*(1-v)],[0,1,(1-u)*v],[1,1,u*v]]) {
    if(weight<1e-10)continue;
    const x=(ix+dx)*8+4,y=(iy+dy)*8+4,field=fields.get(`${Math.floor(x/1000)}-${Math.floor(y/1000)}`);
    if(!field)return undefined;
    const col=Math.floor((x-field.bounds[0])/8),row=field.height-1-Math.floor((y-field.bounds[1])/8),height=field.values[row*field.width+col];
    if(!Number.isFinite(height))return undefined;value+=height*weight;
  }
  return value;
}
