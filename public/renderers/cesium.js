import { swissToWgs } from '../swiss-coordinates.js';
import { TERRAIN_URL } from '../models.js';
import { createSurfaceProvider } from '../surface-provider.js';
import { createFlightTerrain } from '../flight-terrain.js';

let cesiumReady;
function loadCesium() {
  if(!cesiumReady)cesiumReady=new Promise((resolve,reject)=>{
    window.CESIUM_BASE_URL='/vendor/cesium/';
    const css=document.createElement('link');css.rel='stylesheet';css.href='/vendor/cesium/Widgets/widgets.css';document.head.append(css);
    const script=document.createElement('script');script.src='/vendor/cesium/Cesium.js';
    script.onload=()=>resolve(window.Cesium);script.onerror=()=>reject(Error('Cesium is unavailable. Run npm install, then restart the server.'));
    document.head.append(script);
  });
  return cesiumReady;
}

export function createRenderer({canvas,host,credits}) {
  let C,viewer,loading=0,lastGlCheck=0,glError=0,renderError='',providerErrors=0;
  let groundSampler,surfaceProvider,base,flattened;
  const errors=new Map();
  function report(layer,error) {
    providerErrors++;
    if(error.timesRetried<2)error.retry=true;
    errors.set(layer,`${layer}: ${error.message}`);console.warn(errors.get(layer));
  }
  return {
    id:'cesium',
    async init({flattened:flat}) {
      flattened=flat;
      C=await loadCesium();C.Ion.defaultAccessToken='';
      canvas.hidden=true;host.hidden=false;
      viewer=new C.Viewer(host,{
        baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,
        navigationHelpButton:false,animation:false,timeline:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,
        creditContainer:credits,useDefaultRenderLoop:false,shouldAnimate:false,
        useBrowserRecommendedResolution:false,msaaSamples:4,
        contextOptions:{webgl:{alpha:false,antialias:true}},showRenderLoopErrors:false,
        skyBox:false,skyAtmosphere:false,
      });
      viewer.scene.screenSpaceCameraController.enableInputs=false;
      viewer.scene.backgroundColor=new C.Color(.56,.68,.73,1);
      viewer.scene.globe.baseColor=new C.Color(.56,.68,.73,1);
      viewer.scene.globe.depthTestAgainstTerrain=true;
      viewer.scene.globe.maximumScreenSpaceError=2;
      viewer.scene.globe.tileCacheSize=256;
      viewer.scene.globe.cartographicLimitRectangle=C.Rectangle.fromDegrees(5.5,45.4,11.1,48.1);
      viewer.scene.globe.tileLoadProgressEvent.addEventListener(count=>{loading=count;if(count===0)errors.clear();});
      viewer.scene.renderError.addEventListener((scene,error)=>{renderError=error.message;});
      const imagery=new C.UrlTemplateImageryProvider({
        url:'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
        tilingScheme:new C.WebMercatorTilingScheme(),maximumLevel:16,
        rectangle:C.Rectangle.fromDegrees(5.140242,45.398181,11.47757,48.230651),credit:'© swisstopo',
      });
      imagery.errorEvent.addEventListener(error=>report('Imagery',error));
      viewer.imageryLayers.addImageryProvider(imagery);
      base=await C.CesiumTerrainProvider.fromUrl(TERRAIN_URL,{credit:'© swisstopo'});
      surfaceProvider=flattened?null:createSurfaceProvider(C,base);
      viewer.terrainProvider=surfaceProvider??base;
      viewer.terrainProvider.errorEvent.addEventListener(error=>report('Terrain',error));
      groundSampler=createFlightTerrain(C,viewer,base);
    },
    setFlattened(flat) {
      if(flat===flattened)return;
      flattened=flat;
      if(!flat&&!surfaceProvider)surfaceProvider=createSurfaceProvider(C,base);
      groundSampler.clear();viewer.terrainProvider=flat?base:surfaceProvider;
    },
    prepare:(east,north)=>groundSampler.prepare(east,north),
    ground:(east,north)=>groundSampler.ground(east,north),
    reset(){},
    frame(state,now) {
      viewer.resolutionScale=Math.min(devicePixelRatio,2)/devicePixelRatio;
      viewer.resize();
      const [east,height,negativeNorth]=state.eye,north=-negativeNorth;
      const [lon,lat]=swissToWgs(east*1000,north*1000);
      const ahead=swissToWgs(east*1000+Math.sin(state.yaw)*100,north*1000+Math.cos(state.yaw)*100);
      const heading=Math.atan2((ahead[0]-lon)*Math.cos(lat*Math.PI/180),ahead[1]-lat);
      viewer.camera.setView({destination:C.Cartesian3.fromDegrees(lon,lat,height*1000),orientation:{heading,pitch:state.pitch,roll:state.roll}});
      const aspect=viewer.canvas.clientWidth/Math.max(1,viewer.canvas.clientHeight);
      viewer.camera.frustum.fov=aspect>1?2*Math.atan(Math.tan(Math.PI/6)*aspect):Math.PI/3;
      viewer.camera.frustum.near=30;viewer.camera.frustum.far=100000;
      groundSampler.update(now);viewer.render();
      const gl=viewer.canvas.getContext('webgl2');
      if(gl&&now-lastGlCheck>1000){glError=gl.getError();lastGlCheck=now;}
      return {renderer:'cesium',tiles:undefined,triangles:undefined,loading,error:renderError||[...errors.values()].join('; '),glError,
        description:`Cesium · ${flattened?'ground only':'roofs and canopies'} · ${loading?'loading':'ready'}`,providerErrors,surface:surfaceProvider?{...surfaceProvider.stats}:undefined};
    },
    diagnostics() {
      const gl=viewer.canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
      return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),width:viewer.canvas.width,height:viewer.canvas.height,
        version:C.VERSION,terrain:flattened?'swissALTI3D ground':'swissSURFACE3D roofs and canopies',imagery:'SWISSIMAGE',fovDegrees:60};
    },
    dispose(){groundSampler?.dispose();surfaceProvider?.dispose();viewer?.destroy();canvas.hidden=false;host.hidden=true;},
  };
}
