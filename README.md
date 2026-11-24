# Flytastic

Two versions of the same flight viewer:

| Version | Renderer | Geographic data |
| --- | --- | --- |
| Original Flytastic | Original Flytastic WebGL 2 port | Our local copy of the original GEODAT files |
| Swisstopo | CesiumJS | Terrain, surface heights and aerial imagery streamed from swisstopo |

## Run

Install Node.js 22 or newer:

```powershell
npm ci
npm start
```

Open <http://localhost:3000>. Choose the version using **Version**.
The server listens only on the local machine. Use `PORT` to change the port.

The original version reads `models/original/GEODAT`, or the directory named by
`FLYTASTIC_DATA`. Its data files are excluded from Git; retain a separate backup.
See [the original dataset notes](models/original/README.md). If they are missing,
the original option is disabled and the viewer defaults to Swisstopo.

Swisstopo requires internet access, with no geographic data preparation, API key,
Cesium ion account, or locally hosted swisstopo dataset.

## Flattened

The **Flattened** checkbox appears only in the Swisstopo version:

- **Checked:** swissALTI3D ground terrain. Trees and houses remain visible in the
  aerial photograph, but have no raised geometry.
- **Unchecked:** swissSURFACE3D Raster heights include roofs and tree canopies.

Mountains retain their shape in both cases. Switching versions or the checkbox
preserves the camera and speed limit and saves the selection in the URL.
Switching versions pauses flight; the checkbox keeps the navigation mode.
Direct links are `/?model=original`, `/?model=swisstopo&flattened=1`, and
`/?model=swisstopo&flattened=0`.

The surface is a heightfield: small features are softened, and bridges have no
space modeled underneath. Published source coverage and acquisition dates can
differ from the aerial photographs. Missing surface coverage retains ground.
Surface loading is heavier than bare-ground loading, particularly at high speeds.
The checkbox switches terrain in place, retaining imagery and bounded surface
caches. Returning to an already viewed surface avoids rebuilding its heightmaps.

## Controls

Use **Where in Switzerland?** to search for towns, summits and street addresses
through geo.admin.ch, using the search interface from Swiss Explorer. Select a
result with the mouse or arrow keys and Enter. Flight pauses and the camera
opens a terrain-aware view of the place in either version; the view is saved in
the URL. Search requires internet access, including in the original version.
Escape dismisses results, and the clear button resets the search.

Enable **Winter** for shader-based snow cover in either version. **Snow line**
sets its elevation in metres above sea level, with a gradual, irregular edge
and less accumulation on steep faces. Interpolated vertex normals keep snow
coverage smooth across triangles. Photo brightness and green tones vary snow
coverage and tint, retaining fine texture and the photograph's existing shadows.
These are visual cues, not reliable tree/rock classification.
Lighting and terrain geometry stay unchanged; there are no
falling particles. Swisstopo uses supplied terrain normals when available;
meshes without normals get them once when built. Aerial imagery has no semantic
mask, so low snow lines can also whiten water, roads and vegetation.
Winter and snow-line settings persist in the URL (`winter=1&snowLine=1600`).
The Cesium integration passes its already sampled imagery color into the snow
material through a guarded globe-shader source hook for pinned Cesium 1.146;
check this hook when upgrading Cesium. No extra imagery samples are needed.

Drag the landscape to pan, scroll to zoom toward/away from the cursor, and use
right drag, middle drag or Ctrl + left drag to orbit and tilt around the terrain.
On touch screens, drag to pan or pinch to zoom. A landscape click, drag or wheel
gesture stops flight and controls the map immediately, without a separate pause
or activation click. Map gestures work in both renderers and save the camera in
the URL. Zoom stays above terrain and within the map bounds (up to 20 km altitude).
Search input and settings leave the navigation mode alone; choosing a result
opens its map view. Native Cesium camera inputs stay disabled so a shared
terrain-anchored controller can preserve the same camera through every handoff.

Use **Start cruise**, Space, or the flight joystick
to fly; Escape pauses. W/A/S/D and arrow keys control movement, Q/E adjust target
clearance. The left vertical control sets camera pitch (−60° to +60°), and the
right vertical control sets height above the terrain. Pitch stays where you set
it while terrain-following adjusts altitude. The automatic pitch calculation is
commented out in `public/flight.js` for reference. Choose a
departure or Reset view to return. Flight pauses when the window loses focus.

## Implementation

`public/app.js` owns the camera, flight controls and version selection.
`public/map-navigation.js` handles shared map gestures; Cesium picks its loaded
terrain directly, while the original version ray-marches its local height grid.
`public/renderers/flytastic.js` handles only original local data;
`public/renderers/cesium.js` handles only swisstopo. There is no independent
renderer selection or prepared pilot.

Cesium uses native quantized-mesh ground terrain from the `20250101` publication
and current SWISSIMAGE imagery. With Flattened unchecked, nearby terrain tiles
are built by `surface-worker.js`: it fetches ground meshes and the required
Cloud Optimized GeoTIFF ranges, then returns heightmaps to Cesium. Coarse tiles
stay native; detailed heightmaps use a shared geographic grid and 8 m averaged
surface footprints. Cesium handles tile selection, mesh creation and stitching.

Surface work is limited to four terrain jobs; each reads up to two raster files
concurrently. The worker caches at most 96 sampled raster fields, about 6 MB,
and releases full decoded rasters. Catalog queries are shared across 4 km regions,
and up to 256 finished surface heightmaps (about 4 MB) are retained across checkbox
changes. The first view starts from native ground while surface detail loads.
HTTP whole-file fallbacks are disabled. Data
stays at swisstopo; only browser caching and bounded runtime caches are used.
The Swiss coordinate conversion is approximate, with metre-level horizontal
accuracy; this viewer is not intended for survey measurements.

The original renderer retains its adaptive diamond triangulation and original
height hierarchy. Terrain geometry is built in a worker; GPU uploads are spread
across frames. Local geographic assets are never modified by the viewer.

## Verify

```powershell
npm test
npm run test:browser
npm run test:search
```

The browser check uses an installed Microsoft Edge through Playwright and live
swisstopo services. It verifies the two versions, both checkbox states, camera
preservation, actual raised surface heights, flight, and local-data isolation.
Reports and screenshots go to the ignored `.local` directory.

For manual frame-stall comparisons, run `window.flytasticMetrics.reset()` in the
browser console before flying and `window.flytasticMetrics.snapshot()` afterward.
This reports frame percentiles, maximum intervals, counts above 25/33.3/50/100 ms,
and browser long tasks. It measures browser frame intervals, not isolated GPU
cost. The two versions have different data resolutions and rendering workloads.

Sources: [SWISSIMAGE](https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10),
[swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d),
[swissSURFACE3D Raster](https://www.swisstopo.admin.ch/en/height-model-swisssurface3d-raster),
[terrain service](https://docs.geo.admin.ch/visualize-data/terrain-service.html).
