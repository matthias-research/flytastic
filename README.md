# Flytastic Web

A first JavaScript/WebGL 2 port of Flytastic's original terrain renderer, using its original elevation and aerial imagery. No rendering libraries or npm dependencies.

## Run

Install Node.js 22 or newer, then run:

```powershell
npm start
```

Open <http://localhost:3000>. By default the server reads the local copy in `models/original/GEODAT`. To use another location (including the original installation) or port:

```powershell
$env:FLYTASTIC_DATA = 'D:\Data\GEODAT'
$env:PORT = '3001'
npm start
```

The server binds to the local machine only. The original data is required on the server; the Git repository does not contain it. This version cannot be deployed as a static site alone.

## Models

- `models/original/`: the current Flytastic dataset, copied locally with a checksum manifest. This is the viewer's default model.
- `models/swisstopo/`: the downloaded and prepared Interlaken pilot, with 2 m imagery, 10 m terrain, and our own consistent overview hierarchy. Select it under Landscape or open <http://localhost:3000/?model=swisstopo>.

The new pilot covers 10 × 10 km. It uses about 29 MB of prepared data, plus 177 MB of retained source data. Its terrain ends at the pilot boundary. See [the swisstopo model instructions](models/swisstopo/README.md) for reproducible setup, preparation, checks, and limitations.

The renderer remains shared. Both models' large data files are excluded from Git. On a fresh checkout, restore `models/original/GEODAT` or set `FLYTASTIC_DATA` to an existing GEODAT folder.

Git contains the application, tests, documentation, model manifests/checksums, and preparation scripts. Photos, elevation binaries, downloaded GeoTIFFs, caches, and local environments stay on disk and are not pushed. Keep a separate backup of the original GEODAT files; the swisstopo pilot can be downloaded and rebuilt from its pinned manifest using the preparation instructions. No Git LFS setup is required for this arrangement.

## Controls

- Drag the disk in the bottom-right rectangle upward for forward throttle and sideways to turn. Release it to ease off movement and level the bank. Flight never reverses.
- Use the adjacent vertical control to select a target height of 100–2,000 m above ground. Arrow keys adjust this control by 50 m, Page Up/Down by 200 m, and Home/End select the limits.
- W or Up applies forward throttle; A/D or Left/Right steers; S or Down brakes and cancels cruise. Q/E lowers/raises the target height.
- Start cruise or Space enables continuous flight. Space toggles cruise; Escape or Pause flight freezes the current view.
- Dragging the landscape pauses flight and lets you look around. Flight also pauses on window focus loss or a hidden tab.
- The speed limit slider caps flight speed. Below that cap, maximum speed increases with actual ground clearance, from 1,000 km/h at 100 m to 5,000 km/h at 1,000 m. The pad controls the fraction of this speed; lower the cap for slower exploration.
- Choose a departure or Reset view to return to a starting viewpoint.
- Switch Landscape to compare models at the same position, absolute altitude, viewing direction, and bank angle. The speed limit is retained and flight pauses. Views outside the target model's coverage stay on the current map.

Comparison views preserve absolute altitude even when the datasets disagree about ground height; resuming flight restores terrain following. The camera is carried in the URL, so comparison links can also be bookmarked. Existing links without a bank angle remain supported.

Departures begin 650 m above the local terrain, with a nearly level view.

The flight controller is adapted from Swiss Explorer to local Swiss-grid coordinates, without Cesium. It smooths acceleration and turns, banks up to 10°, averages nearby ground heights, and samples terrain 1/2/4/6 seconds ahead to anticipate climbs. The view pitches upward smoothly on climbs and returns toward a −20° baseline instead of diving during descents. Terrain following targets a smoothed clearance rather than an exact height over each bump. Flight stops at model boundaries.

## Implemented

- Original 100 m elevation grid and precomputed terrain error tree.
- Original binary triangle subdivision and error cutoff, translated from `DataTree::renderQuadrant` and `renderMesh`.
- Camera-dependent terrain geometry: up to 100 m source-grid detail within approximately 4 km, with 200, 400, and 800 m depth limits farther away. The original error tree also simplifies terrain where finer triangles add little height detail.
- Shared subdivision across all imagery grids, with diamond parent dependencies based on `DataTree::forceVertexLOD` to keep adjacent triangles connected. A worker builds geometry; all resident imagery layers switch to the new surface together.
- Triangle clipping to imagery bounds, source coordinate conventions and texture mapping.
- Original imagery indexes and XOR/JPEG decoding, with empty-tile handling.
- Distance-based imagery streaming: pack E provides the wider landscape, D refines terrain within approximately 14 km, and the highest-resolution pack C refines terrain within approximately 6 km. Selection accounts for altitude as well as horizontal distance.
- Bounded tile windows and four concurrent loads. Coarser imagery remains visible until finer tiles are ready, including where finer archives have sparse coverage.
- WebGL buffers, textures and mipmaps; simple fog and Swiss Explorer-style flight controls with automatic terrain following, banking, climb pitch, and target-height adjustment.

Both imagery and terrain geometry now refine with camera proximity and coarsen with distance/altitude. The selected elevation grid remains resident in memory; refinement adds triangles rather than downloading a finer height dataset. Original geometry rebuilds after roughly 1 km horizontal or 500 m vertical movement; the finer pilot rebuilds after 250 m horizontal or 100 m vertical movement. Geometry also updates whenever selected imagery tiles change. Existing geometry remains visible while the worker builds its replacement.

This version implements a browser distance policy using the original grids and subdivision algorithms; it does not yet reproduce ImageGrid's exact selection policy, the original Flytastic camera physics, labels, clouds, stereo, or full UI. Navigation uses the adapted Swiss Explorer controller. Viewpoints are new defaults. Detail changes swap without a gradual morph, so some terrain movement can be visible during transitions. Visual parity with the desktop application is not established.

## Check

```powershell
npm test
```

Tests cover coordinate layout, interpolation, clipping, UV bounds, no-data handling, archive validation, JPEG signatures, and a terrain mesh made from installed data. Geometry tests verify increased triangle counts near the camera, 100 m source-grid edges, matching imagery-boundary heights, and no unmatched interior edges in the adaptive mesh. Integration checks require the original GEODAT folder.

The initial version was also checked in headless Microsoft Edge: all three departures rendered, flight and keyboard climbing moved the camera, and desktop (1440 × 1000) and mobile (390 × 844) layouts were inspected. The initial view loaded 49 tiles and 126,325 triangles with no browser exceptions or WebGL errors. These checks do not establish visual parity with the desktop original.

The multi-resolution update was checked in Edge with C requests deliberately held to verify coarse fallback, then released to verify refinement. All three departures loaded C imagery at 650 m above local terrain. Climbing to 20 km evicted C and D while retaining E; resetting restored fine imagery. The new default view loaded 49 E, 52 D, and 36 C tiles with no browser exceptions or WebGL errors.

The adaptive geometry update was checked in Edge while climbing, moving horizontally, resetting, and rapidly switching departures during worker activity. The starting view used 94,132 triangles with a 100 m near-camera depth limit. At 20 km altitude it used 18,860 triangles; reset restored the original count. All three departure views rendered with no browser exceptions or WebGL errors.

See [project.md](project.md) for the inventory and longer-term plan.
