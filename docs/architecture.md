# Architecture

## Boundaries

| Module                           | Responsibility                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dxf.ts`                         | Typed adapter around dxf-parser; supported entities, visibility, units, import warnings, and limits      |
| `geometry.ts`                    | DOM-free affine transforms, cubic curves, bulge conversion, and derivative-based bounds                  |
| `occupancy.ts`                   | Adaptive curve flattening and segment/rectangle intersection for blank-sheet detection                   |
| `nesting.ts`                     | `NestingStrategy` contract and deterministic `RectangleNester`; no DOM or PDF dependencies               |
| `maxrects-nester.ts`             | MaxRects canvas search, independent rotation, measured sheet scoring, and shelf fallback                 |
| `layout.ts`                      | Millimeter page geometry, rows, stable sheet IDs, reciprocal seam relations, and skipped-sheet selection |
| `pdf.ts`                         | Vector PDF rendering from an already computed layout                                                     |
| `services/dxf-import-service.ts` | Owns worker lifecycle, timeouts, cancellation, and disposal                                              |
| `services/nesting-service.ts`    | Cancellable nesting-worker lifecycle; typed request and response boundary                                |
| `ui/application.ts`              | Owns application state and event subscriptions; composes services and renderer                           |
| `ui/preview.ts`                  | SVG preview and sheet inspection using the same layout model as PDF                                      |

Pure calculations remain functions. Classes represent owned state/lifecycle or interchangeable strategies; there is no inheritance hierarchy or shared global application state. The application accepts a nesting service through its constructor. The worker composes `MaxRectsNester`, which accepts an interchangeable fallback strategy. `dispose()` releases workers and UI subscriptions. A revision counter prevents obsolete asynchronous results from replacing the latest layout.

Coordinates remain in millimeters after each file's explicit unit conversion. CAD geometry uses a positive-up Y axis; preview and PDF apply the final Y inversion at their rendering boundaries. Nesting applies rigid 0°/90° transforms without rescaling parts.

## Invariants

- A sheet's world rectangle and its PDF clipping rectangle have identical physical dimensions.
- Every retained seam points to a retained neighbor with the same seam ID in the opposite direction.
- Shared seam midlines and crosses coincide in drawing space.
- Nesting rectangles have at least the selected clearance and cannot overlap.
- The selected nest uses no more actual printed sheets than the shelf baseline under the same settings, including empty-sheet skipping.
- Empty-sheet skipping tests drawing strokes, not the bounds of an enclosed empty area; curve approximation includes a conservative tolerance.
- Changing units, layers, spacing, or layout settings invalidates the user's dimension confirmation.
- A failed import batch never replaces the last successfully imported job.
- User-provided filenames and layers are escaped before HTML insertion. SVG path numbers come from validated geometry.

## Future row orientations

The first version has a global orientation selector. `Layout.pageRows` records row orientation and dimensions, while each `Tile` carries its own paper and usable dimensions. PDF template pages and individual-sheet preview read dimensions from the tile.

To add mixed rows, extend the layout planner with row overrides and compute each row's pitch independently. The adjacency planner must support multiple top/bottom neighbors when differently oriented rows have different column boundaries. Use explicit seam spans and place corresponding registration crosses within the shared span. This is a layout-model extension; unit conversion, nesting strategy, parsing, and PDF drawing primitives do not change. Add mixed-row reciprocity and physical-coordinate tests before exposing the controls.

## Verification

Unit/integration tests check geometry, units, block bases, non-overlap, rotation, sheet-count regression, blank-sheet intersection, label reciprocity, physical PDF page sizes, and vector content. Browser tests run the production build and cover actual worker import, download, nesting, rapid setting changes, unit controls, responsive layout, and axe WCAG AA checks. Build before running browser tests. Synthetic fixtures are intentionally independent of private drawings.

PDF rendering and a physical printer calibration remain useful release checks. An automated accessibility scan does not replace keyboard and visual review.

The minimatch override selects a patched release for lint-tool dependencies. Reassess it when upgrading ESLint or typescript-eslint; run lint and the full suite after changing it.
