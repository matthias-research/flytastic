# Local swisstopo pilot

A prepared 10 × 10 km model around Interlaken, independent of the original Flytastic data. Open <http://localhost:3000/?model=swisstopo> or select it under Landscape.

The pilot covers LV03 easting 627000–637000 and northing 168000–178000. Terrain ends at that boundary; it is not yet a national model. Other departures are available in the Original model.

## Prepared data

| Component | Levels | Size |
| --- | --- | ---: |
| Imagery | 2, 4, 8, 16, 32, 64, 128 m/pixel | 26,829,077 bytes |
| Terrain, overviews, and error tree | 10, 20, 40, 80, 160, 320, 640 m spacing | 2,173,471 bytes |
| Retained source files and catalog | 288 GeoTIFFs with download metadata | 176,773,868 bytes |

Prepared imagery and terrain total about **29 MB (27.7 MiB)**. Original source files are retained for reproducible builds. A geographic query includes surrounding tiles for reprojection, so source downloads cover a larger rectangle than the final pilot.

`manifest.json` records source editions, URLs, source checksums, prepared coverage, coordinate correction grid, processing software, build version, height checks, and storage totals. It can be versioned in Git; all imagery, elevation binaries, downloaded inputs, and processing caches are excluded.

## Reproduce

From the repository root, set up an isolated Python environment once:

```powershell
python -m venv --system-site-packages .local/venv
.local/venv/Scripts/python.exe -m pip install -r scripts/requirements.txt
```

Then run:

```powershell
npm run prepare:swisstopo
npm run check:swisstopo
npm test
```

Preparation first reuses `source/catalog.json`. If that local catalog is absent, it restores the pinned asset list from the committed manifest for the matching pilot bounds. Only when neither exists does it discover the latest 2 m assets per geographic source tile. Downloads are verified by checksum before reuse. Interrupted file downloads are retried on the next run; completed, checksum-valid files are not rewritten. Four downloads run concurrently, with bounded retries.

To rebuild from the downloaded sources without downloading them again:

```powershell
npm run build:swisstopo
```

The Python builder's `--bounds WEST SOUTH EAST NORTH` arguments use LV03 meters and require a square area aligned to 10 m, no larger than 20 × 20 km. A pinned catalog cannot silently be reused for a different area. This is a bounded-area builder; nationwide preparation still needs chunked processing and a national tile catalog.

## Processing

1. Discover assets through the STAC v1 API; use 2 m raster downloads, not the Cesium terrain service.
2. Verify source SHA-256 checksums against STAC metadata.
3. Transform LV95 to the original viewer's LV03 coordinate system using the CHENyx06a correction grid. This is not a simple coordinate-offset approximation. Heights remain in the source LN02 height datum.
4. Prepare 2 m imagery on an aligned grid. Build every overview directly from that finest level with area averaging. Pad coverage with transparency instead of stretching the last pixels. Full tiles are JPEG; partial tiles are PNG with alpha.
5. Average source elevation to 10 m node footprints. Store heights as little-endian uint16 decimeters with 65535 for NoData; the 0.1 m encoding increment is not a claim about survey accuracy.
6. Derive coarser terrain levels by selecting shared finest-grid nodes, preserving identical heights at corresponding vertices. Compress arrays with gzip.
7. Generate a binary subdivision error tree from midpoint interpolation errors, propagating child errors toward their parents. The shared Flytastic-style renderer uses it for adaptive refinement.

All levels share the pilot's southwest origin. Terrain and imagery resolutions are independent.

## Validation and viewer behavior

The source comparison command checks 64 elevation locations against their source footprints and 64 imagery pixels against independently transformed and interpolated source pixels, allowing for JPEG compression. Node tests verify dimensions, NoData, source provenance, terrain overview identity, adaptive refinement, file-path containment, and imagery grid origins.

A repeat preparation reproduced identical hashes for all 149 prepared imagery/terrain files and reused all 288 source files unchanged. Browser checks covered both model selections, 10 m near-camera terrain, altitude coarsening, reset, three viewport sizes, and local-only requests without browser or WebGL errors.

The viewer currently loads the small pilot's full 10 m elevation grid and error tree, then refines geometry dynamically. It streams nearby 2/4/8 m imagery tiles. All seven imagery and terrain levels are stored locally, but streaming height tiles and using all distant imagery levels are future national-scale work. The viewer uses the same WebGL renderer for both models; no Cesium dependency was added.

## Layout

- `source/`: downloaded GeoTIFF files and pinned acquisition metadata.
- `imagery/<meters-per-pixel>/<x>/<y>.jpg` or `.png`: prepared textures.
- `terrain/<spacing>/heights.bin.gz`: column-major elevation nodes.
- `terrain/errors.bin.gz`: subdivision error codes.
- `cache/proj/`: coordinate correction grid.
- `model.json`: target configuration and current preparation status.
- `manifest.json`: runtime catalog and build provenance.

## Sources and attribution

- [SWISSIMAGE](https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10)
- [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d)
- [STAC download API](https://docs.geo.admin.ch/download-data/stac-api/overview.html)
- [Terms of use](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)

The viewer retains © swisstopo attribution and the Planet credit specified for imagery of major lake centers.
