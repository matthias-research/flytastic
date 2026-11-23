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
preserves the camera and speed limit, pauses flight, and saves the selection in
the URL. Direct links are `/?model=original`, `/?model=swisstopo&flattened=1`, and
`/?model=swisstopo&flattened=0`.

The surface is a heightfield: small features are softened, and bridges have no
space modeled underneath. Published source coverage and acquisition dates can
differ from the aerial photographs. Missing surface coverage retains ground.
Surface loading is heavier than bare-ground loading, particularly at high speeds.
The checkbox switches terrain in place, retaining imagery and bounded surface
caches. Returning to an already viewed surface avoids rebuilding its heightmaps.

## Controls

Drag the landscape to look. Use **Start cruise**, Space, or the flight joystick
to fly; Escape pauses. W/A/S/D and arrow keys control movement, Q/E adjust target
clearance. The left vertical control sets camera pitch (−60° to +60°), and the
right vertical control sets height above the terrain. Pitch stays where you set
it while terrain-following adjusts altitude. The automatic pitch calculation is
commented out in `public/flight.js` for reference. Choose a
departure or Reset view to return. Flight pauses when the window loses focus.

## Implementation

`public/app.js` owns the camera, flight controls and version selection.
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
