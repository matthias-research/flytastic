"""Compare prepared heights and imagery with independently sampled source tiles."""
import gzip
import json
from pathlib import Path
import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import Window
from pyproj.enums import TransformDirection
from prepare_swisstopo import MODEL, grid_transform

manifest=json.loads((MODEL/'manifest.json').read_text(encoding='utf8'))
transform,_,_=grid_transform()
by_collection={}
for record in manifest['sourceFiles']:
    by_collection.setdefault(record['collection'],{})[record['cell']]=record
heights=np.frombuffer(gzip.decompress((MODEL/'terrain/10/heights.bin.gz').read_bytes()),dtype='<u2').reshape(manifest['terrain']['width'],manifest['terrain']['height'])
west,south,east,north=np.array(manifest['bounds'])*1000
pack=manifest['packs'][0]
image_errors=[]
height_checks=0
for x in range(int(west)+270,int(east)-250,1250):
    for y in range(int(south)+270,int(north)-250,1250):
        # 10 m output node: source footprint extrema bound the averaged height.
        ex,ny=transform.transform(x,y,direction=TransformDirection.INVERSE)
        cell=f'{int(ex//1000)}-{int(ny//1000)}'
        record=by_collection['ch.swisstopo.swissalti3d'][cell]
        with rasterio.open(MODEL/'source'/record['collection']/record['filename']) as source:
            row,col=source.index(ex,ny)
            window=source.read(1,window=Window(col-4,row-4,9,9),boundless=True,masked=True)
        height=float(heights[round((x-west)/10),round((y-south)/10)])/10
        assert float(window.min())-.2<=height<=float(window.max())+.2,(x,y,height,window.min(),window.max())
        height_checks+=1
        # Compare actual prepared JPEG/PNG pixels at their world-space centers.
        gx=int((x-west)//2);gy=int((y-south)//2)
        px,py=west+gx*2+1,south+gy*2+1
        ex,ny=transform.transform(px,py,direction=TransformDirection.INVERSE)
        cell=f'{int(ex//1000)}-{int(ny//1000)}'
        record=by_collection['ch.swisstopo.swissimage-dop10'][cell]
        with rasterio.open(MODEL/'source'/record['collection']/record['filename']) as source:
            col,row=~source.transform*(ex,ny)
            col-=.5;row-=.5
            ix,iy=int(np.floor(col)),int(np.floor(row));u,v=col-ix,row-iy
            pixels=source.read(window=Window(ix,iy,2,2)).astype(float)
            expected=(pixels[:,0,0]*(1-u)+pixels[:,0,1]*u)*(1-v)+(pixels[:,1,0]*(1-u)+pixels[:,1,1]*u)*v
        tile_file=pack['tileFiles'][f'{gx//512}/{gy//512}']
        with Image.open(MODEL/'imagery'/tile_file) as tile:
            actual=np.array(tile.convert('RGB').getpixel((gx%512,511-gy%512)),dtype=float)
        image_errors.append(float(np.max(np.abs(actual-expected))))
assert np.percentile(image_errors,95)<30, image_errors
assert max(image_errors)<60, image_errors
print(json.dumps({'heightChecks':height_checks,'imageChecks':len(image_errors),'imageChannelError95Percentile':float(np.percentile(image_errors,95)),'imageChannelErrorMaximum':max(image_errors),'coordinateGrid':manifest['transform']['grid'],'status':'passed'},indent=2))
