"""Resumable, bounded-area swisstopo downloader and local pyramid builder."""
import argparse
import concurrent.futures
import hashlib
import json
import math
import os
from pathlib import Path
import time
import urllib.request
import gzip

import numpy as np
from PIL import Image, __version__ as pillow_version
import pyproj
from pyproj.transformer import TransformerGroup
import rasterio
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'models' / 'swisstopo'
NODATA = 65535

def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.partial')
    temp.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def request(url):
    for attempt in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Flytastic-local-pilot/1.0'}), timeout=90)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)

def grid_transform():
    folder = MODEL / 'cache' / 'proj'
    folder.mkdir(parents=True, exist_ok=True)
    grid = folder / 'ch_swisstopo_CHENyx06a.tif'
    if not grid.exists():
        with request('https://cdn.proj.org/ch_swisstopo_CHENyx06a.tif') as response:
            grid.write_bytes(response.read())
    pyproj.datadir.append_data_dir(str(folder))
    group = TransformerGroup(2056, 21781, always_xy=True, allow_ballpark=False)
    if not group.transformers:
        raise RuntimeError('Accurate LV95/LV03 transformation unavailable')
    operation = group.transformers[0]
    # GDAL and pyproj have separate PROJ search paths; use an explicit grid path.
    pipeline = operation.to_proj4().replace('ch_swisstopo_CHENyx06a.tif', str(grid).replace('\\', '/'))
    return operation, pipeline, grid

def discover(collection, bbox):
    url = f'https://data.geo.admin.ch/api/stac/v1/collections/{collection}/items?bbox={",".join(map(str,bbox))}&limit=100'
    selected = {}
    while url:
        with request(url) as response:
            page = json.load(response)
        for item in page['features']:
            for asset in item['assets'].values():
                if asset.get('gsd') != 2 or asset.get('proj:epsg') != 2056 or not asset['href'].endswith('.tif'):
                    continue
                cell = item['id'].rsplit('_', 1)[-1]
                date = item['properties']['datetime']
                record = {'collection': collection, 'item': item['id'], 'cell': cell, 'date': date, 'url': asset['href'], 'checksum': asset.get('file:checksum'), 'filename': asset['href'].rsplit('/', 1)[-1]}
                if cell not in selected or date > selected[cell]['date']:
                    selected[cell] = record
        url = next((link['href'] for link in page.get('links', []) if link['rel'] == 'next'), None)
        print(f'{collection}: {len(selected)} latest 2 m tiles discovered', flush=True)
    if not selected:
        raise RuntimeError(f'No source tiles for {collection}')
    return list(selected.values())

def download(record):
    path = MODEL / 'source' / record['collection'] / record['filename']
    path.parent.mkdir(parents=True, exist_ok=True)
    expected = record.get('checksum', '')
    expected = expected[4:].lower() if expected and expected.lower().startswith('1220') else None
    if path.exists() and expected and sha(path) == expected:
        return {**record, 'bytes': path.stat().st_size, 'sha256': expected}
    temp = path.with_suffix('.partial')
    with request(record['url']) as response, temp.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    digest = sha(temp)
    if expected and digest != expected:
        raise RuntimeError(f'Checksum mismatch: {record["filename"]}')
    temp.replace(path)
    return {**record, 'bytes': path.stat().st_size, 'sha256': digest}

def mosaic(records, collection):
    sources = [rasterio.open(MODEL / 'source' / r['collection'] / r['filename']) for r in records if r['collection'] == collection]
    try:
        values, transform = merge(sources, nodata=-9999 if sources[0].count == 1 else 0)
        return values, transform
    finally:
        for source in sources:
            source.close()

def error_tree(heights):
    """Propagate midpoint interpolation error through the original binary tree."""
    size = heights.shape[0] - 1
    tree = np.zeros_like(heights, dtype=np.uint8)
    # Build breadth-first coordinates, then propagate child errors bottom-up.
    levels = []
    triangles = np.array([[size,0,0,0,0,size], [0,size,size,size,size,0]], dtype=np.int32)
    thresholds = np.array([1,5,10,15,20,30,40,50,75,100,125,150,175,200,250])
    for _ in range(2 * int(math.log2(size))):
        lx,ly,tx,ty,rx,ry = triangles.T
        mx,my = (lx+rx)//2, (ly+ry)//2
        a,b,c = heights[lx,ly], heights[rx,ry], heights[mx,my]
        valid = (a != NODATA) & (b != NODATA) & (c != NODATA)
        delta = np.abs(c.astype(float) - (a.astype(float)+b.astype(float))/2) / 10
        errors = np.searchsorted(thresholds, delta, side='right').astype(np.uint8)
        errors[~valid] = 15
        levels.append((mx, my, errors))
        left = np.column_stack((tx,ty,mx,my,lx,ly))
        right = np.column_stack((rx,ry,mx,my,tx,ty))
        triangles = np.stack((left,right),axis=1).reshape(-1,6)
    children = None
    for mx,my,errors in reversed(levels):
        if children is not None:
            errors = np.maximum(errors, children.reshape(-1,2).max(axis=1))
        np.maximum.at(tree, (mx,my), errors)
        children = errors
    return tree

def write_gzip(path, values):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as output, gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as compressed:
        compressed.write(values.tobytes(order='C'))

def build(records, bounds, pipeline, grid):
    west,south,east,north = bounds
    print('Preparing aligned 2 m imagery in LV03', flush=True)
    rgb, transform = mosaic(records, 'ch.swisstopo.swissimage-dop10')
    height,width = round((north-south)/2), round((east-west)/2)
    image = np.zeros((4,height,width), dtype=np.uint8)
    rgba = np.concatenate((rgb, np.where(np.any(rgb != 0,axis=0),255,0)[None].astype(np.uint8)))
    reproject(rgba, image, src_transform=transform, src_crs='EPSG:2056', dst_transform=from_origin(west,north,2,2), dst_crs='EPSG:21781', src_alpha=4, dst_alpha=4, resampling=Resampling.bilinear, COORDINATE_OPERATION=pipeline)
    del rgb, rgba
    finest = Image.fromarray(image.transpose(1,2,0), 'RGBA')
    image_coverage = float(np.count_nonzero(image[3])) / (width*height)
    del image
    packs = []
    for level,resolution in enumerate([2,4,8,16,32,64,128]):
        resized = finest if level == 0 else finest.resize((math.ceil(width/2**level),math.ceil(height/2**level)),Image.Resampling.BOX)
        # Pad instead of stretching the last row/column: georeferencing stays exact.
        # Derive every overview directly from the finest image.
        if width % 2**level or height % 2**level:
            padded=Image.new('RGBA',(math.ceil(width/2**level)*2**level,math.ceil(height/2**level)*2**level))
            padded.paste(finest,(0,padded.height-finest.height))
            resized=padded.resize((padded.width//2**level,padded.height//2**level),Image.Resampling.BOX)
        files, tiles = {}, []
        nx,ny = math.ceil(resized.width/512),math.ceil(resized.height/512)
        for x in range(nx):
            for row in range(ny):
                # Browser tile y increases northward. Pixel rows increase southward.
                # Align the tile grid at the pilot's southwest corner for all levels.
                y=row
                top=resized.height-(y+1)*512
                tile=resized.crop((x*512,top,(x+1)*512,top+512))
                if not tile.getchannel('A').getbbox():
                    continue
                full=tile.getchannel('A').getextrema()==(255,255)
                extension='jpg' if full else 'png'
                relative=f'{resolution}/{x}/{y}.{extension}'
                output=MODEL/'imagery'/relative
                output.parent.mkdir(parents=True,exist_ok=True)
                if full:
                    tile.convert('RGB').save(output,quality=88,subsampling=0,optimize=True)
                else:
                    tile.save(output,optimize=True)
                files[f'{x}/{y}']=relative
                tiles.append([x,y])
        packs.append({'id':chr(ord('C')+level),'name':f'SWISSIMAGE {resolution} m','factor':1000/resolution,'divisor':1000,'xstart':west,'ystart':south,'width':512,'height':512,'minX':0,'maxX':nx-1,'minY':0,'maxY':ny-1,'tiles':tiles,'tileFiles':files})
        print(f'Imagery {resolution} m: {len(tiles)} tiles',flush=True)
    finest.close()
    print('Preparing 10 m ground elevations and derived hierarchy',flush=True)
    elevation,transform=mosaic(records,'ch.swisstopo.swissalti3d')
    cells=round((east-west)/10)
    if cells != round((north-south)/10):
        raise ValueError('Pilot builder currently requires a square area')
    size=2**math.ceil(math.log2(cells))
    nodes=np.full((cells+1,cells+1),-9999,dtype=np.float32)
    reproject(elevation[0],nodes,src_transform=transform,src_crs='EPSG:2056',src_nodata=-9999,dst_transform=from_origin(west-5,north+5,10,10),dst_crs='EPSG:21781',dst_nodata=-9999,resampling=Resampling.average,COORDINATE_OPERATION=pipeline)
    valid=np.isfinite(nodes)&(nodes>=0)&(nodes<6553.5)
    quantized=np.where(valid,np.rint(nodes*10),NODATA).astype('<u2')
    heights=np.full((size+1,size+1),NODATA,dtype='<u2')
    heights[:cells+1,:cells+1]=quantized[::-1].T
    overview=[]
    for level in range(7):
        step=2**level
        values=heights[::step,::step].copy()
        filename=f'{10*step}/heights.bin.gz'
        write_gzip(MODEL/'terrain'/filename,values)
        overview.append({'spacingMeters':10*step,'width':values.shape[0],'height':values.shape[1],'file':filename,'bytes':(MODEL/'terrain'/filename).stat().st_size})
    print('Building binary subdivision error tree',flush=True)
    tree=error_tree(heights)
    write_gzip(MODEL/'terrain'/'errors.bin.gz',tree)
    sample_points=[]
    for x,y in [(632000,173000),(630000,170000),(635000,175000)]:
        ix,iy=round((x-west)/10),round((y-south)/10)
        if 0<=ix<=cells and 0<=iy<=cells:
            sample_points.append({'east':x,'north':y,'meters':None if heights[ix,iy]==NODATA else float(heights[ix,iy])/10})
    metadata={'width':size+1,'height':size+1,'origin':[west/1000,south/1000],'spacingMeters':10,'treeSize':size,'treeDepth':2*int(math.log2(size)),'heightEncoding':'uint16','heightUnitMeters':0.1,'noData':NODATA,'bounds':[west/1000,south/1000,east/1000,north/1000]}
    software={'rasterio':rasterio.__version__,'gdal':rasterio.__gdal_version__,'pyproj':pyproj.__version__,'numpy':np.__version__,'pillow':pillow_version}
    build_id=hashlib.sha256((sha(Path(__file__))+json.dumps(software,sort_keys=True)+str(bounds)+''.join(r['sha256'] for r in records)).encode()).hexdigest()[:16]
    manifest={'id':'swisstopo','name':'Swisstopo · Interlaken pilot','status':'ready','buildId':build_id,'coordinateSystem':'EPSG:21781','sourceCoordinateSystem':'EPSG:2056','bounds':metadata['bounds'],'terrain':metadata,'terrainLevels':overview,'imageryLevelsMeters':[2,4,8,16,32,64,128],'packs':packs,'attribution':'© swisstopo · Includes material © (2016–2018) Planet. All rights reserved','sourceFiles':records,'transform':{'grid':grid.name,'sha256':sha(grid),'pipeline':pipeline.replace(str(ROOT).replace('\\','/'),'<project>')},'coverage':{'imageryFraction':image_coverage,'terrainFraction':float(np.count_nonzero(valid))/valid.size},'heightChecks':sample_points,'storage':{name:sum(p.stat().st_size for p in (MODEL/name).rglob('*') if p.is_file()) for name in ['source','imagery','terrain']}}
    manifest['software']=software
    if image_coverage<.999 or manifest['coverage']['terrainFraction']<.999:
        raise RuntimeError(f'Pilot coverage incomplete: {manifest["coverage"]}')
    save_json(MODEL/'manifest.json',manifest)
    config=json.loads((MODEL/'model.json').read_text(encoding='utf-8'))
    config.update(status='ready',coordinateSystem='EPSG:21781',viewerIntegration='ready',manifest='manifest.json')
    config['hierarchy']['status']='built'
    config['hierarchy']['sharedGridOrigin']=[west,south]
    save_json(MODEL/'model.json',config)
    print(json.dumps({'status':'ready','coverage':manifest['coverage'],'storage':manifest['storage'],'heightChecks':sample_points},indent=2),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bounds',nargs=4,type=int,default=[627000,168000,637000,178000],metavar=('WEST','SOUTH','EAST','NORTH'))
    parser.add_argument('--build-only',action='store_true')
    args=parser.parse_args()
    west,south,east,north=args.bounds
    if east<=west or north<=south or (east-west)>20000 or (north-south)>20000 or any(v%10 for v in args.bounds):
        parser.error('Use a positive area up to 20 × 20 km, aligned to 10 m; this is a bounded-area builder.')
    operation,pipeline,grid=grid_transform()
    lock=MODEL/'source'/'catalog.json'
    if lock.exists():
        catalog=json.loads(lock.read_text(encoding='utf-8'))
        if catalog['bounds']!=args.bounds:
            parser.error('Existing source/catalog.json belongs to another area; use a separate model directory for another build.')
        records=catalog['files']
        print('Using pinned source catalog',flush=True)
    elif (MODEL/'manifest.json').exists() and [round(v*1000) for v in json.loads((MODEL/'manifest.json').read_text(encoding='utf-8'))['bounds']]==args.bounds:
        previous=json.loads((MODEL/'manifest.json').read_text(encoding='utf-8'))
        records=previous['sourceFiles']
        save_json(lock,{'bounds':args.bounds,'files':records})
        print('Restored pinned sources from the versioned manifest',flush=True)
    else:
        geographic=pyproj.Transformer.from_crs(21781,4326,always_xy=True)
        bbox=geographic.transform_bounds(west-20,south-20,east+20,north+20,densify_pts=21)
        records=[]
        for collection in ['ch.swisstopo.swissimage-dop10','ch.swisstopo.swissalti3d']:
            records.extend(discover(collection,bbox))
        save_json(lock,{'bounds':args.bounds,'queryBbox':bbox,'files':records})
    if not args.build_only:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            verified=[]
            for i,record in enumerate(executor.map(download,records),1):
                verified.append(record)
                if i%20==0 or i==len(records):
                    print(f'Downloaded and verified {i}/{len(records)} files',flush=True)
        records=verified
        save_json(lock,{'bounds':args.bounds,'files':records})
    else:
        for record in records:
            path=MODEL/'source'/record['collection']/record['filename']
            if not path.exists() or sha(path)!=record.get('sha256'):
                raise RuntimeError(f'Missing or changed input: {path}')
    build(records,args.bounds,pipeline,grid)

if __name__=='__main__':
    main()
