# Contributing

Use Node 22.13+ and `npm ci`. Keep changes focused and run the checks in the README before opening a pull request.

- Keep parsing, geometry, nesting, and layout calculations independent of DOM and PDF libraries.
- Prefer typed discriminated unions and small functions; avoid `any`, deep inheritance, or framework dependencies without a concrete need.
- Use a lifecycle-owning class when a component holds resources or state. Clean up listeners and workers through disposal.
- Add tests for physical geometry and user behavior rather than mirroring implementation internals.
- Include synthetic DXF regressions for new entity support; never publish a user's drawing without their permission.
- Preserve all parts at their actual scale. No packing heuristic may resize them.
- Test changes to layout with shared seam coordinates, row/column identity, skipped pages, and PDF dimensions.
- Preserve accessible labels, keyboard behavior, visible focus, contrast, and a usable narrow-screen layout.
- No analytics, uploads, CDN dependencies, or persistent drawing storage by default.

If a renderer omits an unsupported entity, surface a warning. Do not silently claim complete DXF compatibility.
