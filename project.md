# Flytastic browser port

## Goal

Reproduce Flytastic as a browser application using JavaScript and the original geographic data. Port the original rendering algorithms, terrain detail selection, texture mapping, and flight behavior. Use WebGL 2 for browser graphics; do not use Cesium or replace the original terrain engine with another geographic engine.

This is a source port, not a wrapper around the Windows executable. The desktop OpenGL calls and Windows UI require browser equivalents.

## Reference locations

| Location | Purpose |
| --- | --- |
| `D:\GIT\flytastic` | New browser project |
| `E:\Source\C++\Flytastic` | Original C++ source, forms, resources, and a source-side executable |
| `C:\Program Files (x86)\Flytastic` | Installed reference application |
| `C:\Program Files (x86)\Flytastic\GEODAT` | Terrain, imagery, place names, and imagery configuration |

Keep the original source and installation unchanged. Prepare any converted assets or copied inputs inside the new project using reproducible scripts.

## Verified inventory

Inspected on November 9, 2026. GEODAT contains 598,985,167 bytes, approximately 571 MiB. None of its files were found inside the supplied Flytastic source tree. This does not establish whether copies exist elsewhere on the machine.

| Input | Findings |
| --- | --- |
| `elev100.dat` | 15,774,080 bytes: exactly 3,521 × 2,240 16-bit elevation values, matching the source's 100 m grid |
| `elevtree.dat` | 7,887,040 bytes: exactly one byte per elevation grid point, matching the source's terrain detail tree |
| `birdinfo.dat` | Imagery scale configuration; references packs C through I, all present |
| `IMGPACKC.dat` through `IMGPACKI.dat` | All seven imagery archives present |
| Matching `.dir` files | All seven indexes present; entry counts match their declared rectangular bounds |
| `poi.lst` | 4,728,080 bytes, containing 42,215 complete 112-byte records |
| `ascii.bmp`, `clouds.bmp` | Present in GEODAT |
| `highClouds.bmp`, `stars.bmp` | Present in the source folder; absent from GEODAT |
| UI resources | Original `.dfm` forms contain embedded imagery; additional bitmap files exist in `Bmps` |
| Languages | `textE.ini`, `textF.ini`, `textG.ini`, and `textJ.ini` exist in the source folder |

### Imagery checks

| Pack | Nonempty indexed tiles |
| --- | ---: |
| C | 11,325 |
| D | 3,817 |
| E | 997 |
| F | 261 |
| G | 83 |
| H | 29 |
| I | 11 |
| Total | 16,523 |

Every index entry was checked for invalid lengths or nonempty ranges extending outside its archive. No invalid ranges were found. Empty entries exist and must be handled by the loader.

The source specifies the archive format: each directory starts with four little-endian 32-bit bounds values, followed by offset/length pairs. Tile bytes are XOR-transformed with `0x59` before JPEG decoding. Three sample tiles from each archive were successfully decoded, all at 512 × 512 pixels.

These checks establish structural consistency and sample decodability. They do not establish that every image is intact or that the imagery covers every terrain grid point.

## Original engine map

| Source | Responsibility to preserve |
| --- | --- |
| `dataTree.cpp`, `dataTree.h` | Elevation access, terrain triangulation, detail selection, feature loading |
| `ImageGrid.cpp`, `ImageGrid.h` | Imagery scales, tile selection, caching, texture loading, mipmaps, terrain drawing |
| `camera.cpp`, `camera.h` | Camera transforms and flight behavior |
| `bounds2d.cpp`, `bounds2d.h` | Spatial bounds calculations |
| `feature.cpp`, `feature.h` | Place and terrain labels |
| `clouds.cpp`, `clouds.h` | Sky, cloud, and celestial rendering |
| `fileManager.cpp`, `fileManager.h` | Queued data loading |
| `nav_gl.cpp`, `nav_gl.h` | Render coordination, input, instruments, and application UI |
| `preferences.cpp`, `language.cpp` | Settings and localization |
| `bitmaps.dfm`, other forms, `Bmps` | Original visual assets and UI references |

Port the coordinate conventions, array layout, scale factors, texture orientation, and triangle winding from the source explicitly. Do not assume a generic latitude/longitude globe or change units silently.

## Browser architecture

- JavaScript modules implement the original algorithms and application behavior.
- WebGL 2 buffers and shaders replace immediate-mode OpenGL, display lists, matrix state, and fixed-function effects.
- Typed arrays and explicit little-endian parsing load the original terrain and index formats.
- A tile loader decodes the original imagery or consumes assets produced by a reproducible conversion step.
- Asynchronous loading and bounded caches replace desktop file access and loading queues. Select a delivery strategy that avoids requiring the entire imagery dataset at startup.
- HTML/CSS and browser input events replace Borland VCL forms and Windows events.
- Browser settings storage replaces the desktop INI persistence mechanism.

Retain the original rendering decisions while adapting their GPU submission and platform integration. An initial implementation should favor traceable correspondence with the C++ over speculative changes to its algorithms.

## Known differences and gaps

1. The installed executable is dated December 6, 2001. The supplied source and source-side executable include changes through January 2003. The source is the implementation baseline; compare with the installed application and record relevant differences before claiming exact parity.
2. The legacy project references `C:\wx2\lib\jpeg.lib` and `C:\wx2\lib\wx32.lib`, neither present at those paths. They are not required for the JavaScript port, but rebuilding the desktop project would need separate dependency work.
3. The desktop application depends on Borland VCL and Windows/OpenGL integration. It cannot be directly compiled as JavaScript without replacing those platform layers.
4. The source contains an original-CD presence check for `imgdb.dat`, absent from the supplied installation and source folder. The inspected code uses it as a presence marker, not as a terrain or imagery input. Do not make browser asset loading depend on it.
5. `dataGrid.cpp` references `elev.dat`, but that unit is not in the inspected project build list. The active terrain implementation uses `dataTree.cpp` and `elev100.dat`; a missing `elev.dat` is not currently evidence of a missing required input.
6. Full image decoding, native runtime behavior, browser performance, and visual parity have not yet been validated.

No missing core input was identified for beginning the port. Completeness remains provisional until the renderer runs against the dataset and is compared with the original.

## Implementation milestones

### 1. Reproducible data inspection

Create scripts for inventory and format validation. Check terrain dimensions, archive bounds, tile ranges, place records, and image decoding. Document byte order and array indexing. Keep generated data separate from authored code.

Acceptance: a repeatable command validates the supplied inputs and reports missing or malformed files clearly.

### 2. First original terrain view

Set up a minimal browser application and local development server. Load the original elevation grid and one original imagery tile. Implement the original coordinate conventions, terrain geometry, camera transform, and texture mapping in WebGL 2.

Acceptance: a recognizable terrain patch renders with correctly aligned imagery and elevation, without Cesium.

### 3. Original adaptive terrain renderer

Port terrain subdivision and error selection from DataTree, then ImageGrid's scale selection, high/low resolution coordination, visibility decisions, and geometry caching. Replace display lists with reusable GPU buffers.

Acceptance: moving the camera changes terrain and imagery detail according to the original rules, with consistent tile boundaries and no unexplained holes.

### 4. Flight and navigation

Port camera movement, speed, orientation, altitude behavior, and navigation controls. Recreate the instruments and place-selection workflow using the original forms and assets as references.

Acceptance: repeatable camera paths and navigation actions behave consistently with the chosen original baseline.

### 5. Presentation and features

Bring over labels, settings, localization, sky/cloud effects, and stereoscopic rendering as supported by the source. Account for source-versus-installed-version differences explicitly.

Acceptance: each reproduced feature has a documented reference and a visible verification case.

### 6. Fidelity and delivery

Compare fixed camera views and flight paths with the original application. Check texture orientation, detail transitions, labels, depth, fog, and sky appearance. Measure loading, memory, and frame performance, then finalize asset delivery and production packaging.

Acceptance: document remaining differences and demonstrate representative views and navigation in the supported browsers.

## Validation principles

- Verify binary parsers against known records and source calculations.
- Use image decoding checks to distinguish data problems from renderer problems.
- Compare deterministic terrain selections and camera transforms where practical.
- Use reference screenshots and matching camera positions for visual checks.
- Treat a successful build as a development check, not proof of visual or behavioral parity.
- Preserve sparse imagery coverage and original fallback behavior instead of inventing replacement terrain or imagery.

## Current status

Navigation now includes Swiss Explorer's steering disk and vertical target-height control, adapted to local coordinates. The controller smooths throttle and turns, banks while turning, averages surrounding ground heights, looks ahead for slopes, and automatically pitches during climbs. Cruise, keyboard controls, focus-loss pause, and map-boundary stopping are implemented. The speed slider caps the controller's clearance-dependent maximum speed. Same-location model comparison preserves heading, pitch, bank, and absolute altitude while paused. Unit tests and real-browser checks cover the controller, controls, model comparison, and desktop/mobile layouts.

Model data is separated into `models/original/` and `models/swisstopo/`. The original model has a byte-for-byte local GEODAT copy with a checksum manifest and is the viewer's default source. The swisstopo model now contains a completed 10 × 10 km Interlaken pilot: 2 m imagery, 10 m terrain, seven overview levels for each, and a generated terrain error tree. Preparation uses pinned STAC assets, verified source checksums, an LV95-to-LV03 correction grid, and reproducible local resampling. Prepared data totals about 29 MB; retained source files add 177 MB. The viewer's Landscape selector switches between the two models using the same renderer. Large data files are excluded from Git.

Source comparison checks passed at 64 elevation points and 64 imagery pixels. A repeat preparation reproduced identical prepared file hashes and reused existing downloads. The viewer loads only local data, and browser checks cover both models, altitude refinement, reset, and desktop/mobile layouts. The pilot ends at its boundary. Nationwide expansion still needs chunked preparation, a national tile catalog, and streamed height tiles; the pilot builder is deliberately bounded to avoid loading a national raster into memory.

The browser implementation is available via `npm start`. It reads the original data without conversion, ports DataTree's recursive subdivision and error cutoff, and clips geometry to original imagery bounds. Pack E supplies the wider landscape, D refines nearby terrain, and C supplies the highest available imagery resolution close to the camera. Selection includes altitude and uses bounded tile windows. GPU coverage masks let coarser imagery remain visible until finer imagery is ready, or where finer imagery is absent.

Three departure viewpoints begin 650 m above the local terrain. Camera movement and altitude protection are implemented. Geometry depth and error thresholds now adapt to camera distance and altitude, reaching the original 100 m grid near the camera. A shared subdivision pattern and diamond parent dependencies based on `forceVertexLOD` keep neighboring triangles connected across imagery boundaries. A worker builds replacements, then all resident imagery layers switch to the new surface together.

Tests verify near-camera refinement, 100 m source-grid edges, shared-edge continuity, and matching heights at imagery boundaries. Browser checks cover altitude transitions, horizontal movement, all departures, and stale worker results during rapid resets. ImageGrid's exact selection policy, original flight physics, labels, clouds, stereo, gradual geometry morphing, and desktop visual parity remain future work. See `README.md` for startup, controls, and limitations.
