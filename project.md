# Flytastic architecture

The app supports exactly two versions:

1. Original Flytastic: our WebGL 2 source port with locally stored original data.
2. Swisstopo: CesiumJS with streamed SWISSIMAGE and heights. The Flattened checkbox
   selects bare-ground terrain or a surface including roofs and canopies.

Both share Swiss-grid camera coordinates in kilometres, flight controls, terrain
following, departure choices, and camera links. A version fixes its renderer;
there is no renderer menu, prepared pilot, or Flytastic/swisstopo combination.

## Modules

- `public/app.js`: shared application and controls.
- `public/models.js`: the two model descriptions and fixed terrain publication.
- `public/renderers/flytastic.js`: original data loading and WebGL rendering.
- `public/terrain.js`, `geometry-worker.js`, `lod.js`: original adaptive geometry.
- `public/renderers/cesium.js`: Cesium scene and swisstopo imagery/terrain.
- `public/surface-provider.js`, `surface-worker.js`: Cesium surface height tiles.
- `public/surface-stream.js`, `surface-heights.js`, `surface-tile.js`: bounded
  raster streaming, sampling, and heightmap construction.
- `public/flight-terrain.js`: non-blocking Cesium terrain sampling for flight.
- `lib/data.mjs`, `server.mjs`: original GEODAT and application/vendor assets.

## Original reference

The C++ source is at `E:\Source\C++\Flytastic`; the installed reference is at
`C:\Program Files (x86)\Flytastic`. Leave those unchanged. Our copy of GEODAT is
under `models/original`; its manifest and README describe the preserved assets.
The port follows `dataTree.cpp` for terrain subdivision and diamond dependencies,
`ImageGrid.cpp` for image-grid coordinates, and the original array layout and
Swiss-grid coordinate convention. Browser APIs replace OpenGL/VCL submission.

See README.md for setup, source limitations and verification.
