# Original Flytastic model

`GEODAT/` contains a byte-for-byte local copy of the original installed dataset:

- 100 m elevation grid and original terrain error tree.
- All original imagery archives C–I and their indexes.
- Original imagery configuration, points of interest, and bitmap resources from GEODAT.

This is the default data source for the existing viewer. The installation remains unchanged. `manifest.json` records source paths, sizes, and SHA-256 checksums. Large data files are excluded from Git; the manifest and documentation can be versioned.

This folder contains the geographic model. The JavaScript renderer remains shared at the repository root.
