# DXF Print

[![CI](https://github.com/vsi5004/dxf-print/actions/workflows/ci.yml/badge.svg)](https://github.com/vsi5004/dxf-print/actions/workflows/ci.yml)

Tile DXF files for printing at their original dimensions. Runs entirely in the browser; drawings are not uploaded. Built independently of the portfolio that hosts it.

## Features

- Full-scale vector PDF output for Letter, A4, A3, Legal, Tabloid, and custom paper.
- Grid designators (`A1`, `B1`, `A2`) or consecutive sheet numbers.
- Matching seam IDs on both sides of every join, neighboring-sheet labels, trim lines, and registration crosses.
- Assembly map, per-sheet preview, and a physical 50 mm calibration bar on every template sheet.
- Configurable printer margins, overlap, line width, and layer selection.
- Up to 20 DXFs per job, independent units per file, conservative rectangle nesting, adjustable clearance, and optional 90° part rotation.
- Optional omission of sheets with no drawing strokes. Grid coordinates remain stable; skipped positions appear on the map.
- One paper orientation per job. Explicit row and per-sheet geometry provides an extension point for future mixed-orientation rows.
- Keyboard controls, responsive interface, and automated WCAG AA checks.

## Development

Requires Node 22.13+ and npm. The lockfile is committed.

```sh
npm ci
npm run dev
```

```sh
npm run format:check
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Local Windows browser tests use installed Edge; CI uses Playwright Chromium. Production files are in `dist/` and work under a subdirectory because asset URLs are relative. No server runtime is required.

## Printing and assembly

1. Select one or more ASCII DXF files. A new selection replaces the current job.
2. Verify units for **each file** and check the resulting dimensions. Unitless DXFs require an explicit unit choice.
3. Choose paper, orientation, printer margin, and overlap. An additional 8 mm annotation gutter keeps labels and calibration marks inside the printable area.
4. For multiple DXFs, check the nested preview, clearance, and rotation setting. Each DXF is treated as one rigid component, even if it contains disconnected outlines.
5. Choose guides and optional empty-sheet skipping; review import warnings and confirm dimensions.
6. Download the PDF and print at **Actual size / 100%**. Disable Fit, Shrink, and driver scaling. Measure the 50 mm bar before printing the whole job.
7. Keep sheets upright. Trim the top and left shared edges at the dashed line; keep the opposite tabs. Match seam IDs and alignment crosses, overlap, and tape.

The assembly map is reduced and explicitly **not full scale**. Skipped sheets remain indicated so gaps do not shift the assembly coordinates. `A1:B1` remains the seam identity even when consecutive page numbers are selected.

## DXF scope and limits

Supports flat XY lines, circles, arcs, ellipses, ordinary polylines (including bulges), and nested block inserts. Drawing colors/linetypes are normalized to solid black template outlines. Hidden/frozen layers and paper-space entities are excluded.

Text, dimensions, hatches, splines, 3D geometry, binary DXF, array inserts, and unsupported entities are not interpreted as printable outlines. Import warnings identify omissions; export requires acknowledgement. Export these items as ordinary outlines first if they are part of the template. This is not a general CAD renderer.

Limits: 10 MB per file, 20 MB per job, 20 files, 50,000 processed entities per file, 250,000 combined path commands, and 400 sheet positions. Parsing runs in a worker with a timeout. Nothing is persisted to local storage.

Nesting searches page-sized canvases with MaxRects, comparing four part orders and three placement rules. Each part can independently rotate 90° when enabled. Results are ranked by actual printed sheet count, then occupied area; the previous shelf packer remains a candidate so the selected layout cannot use more sheets than that baseline. A synthetic 12-part regression fixture improves from four Letter sheets to three.

Rectangle separation preserves the requested clearance. This heuristic does not promise a globally optimal nest and does not interlock irregular outlines or place parts inside another part's holes. The search runs in a cancellable worker with a 30-second timeout; changing settings discards obsolete results.

## Architecture and deployment

See [architecture](docs/architecture.md), [SiteGround deployment](docs/deployment.md), and [contributing](CONTRIBUTING.md).

MIT licensed. Public tests and the example use synthetic drawings; personal input files are excluded from the repository.
