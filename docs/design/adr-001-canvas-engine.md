# ADR-001 — Canvas engine: custom SVG-DOM editor

**Status:** accepted · 2026-08-13

## Decision

Build the figure canvas as a custom SVG-DOM editor inside our React renderer
(`@suna/canvas`). Do not adopt or fork OpenPencil, tldraw, Excalidraw, or
Penpot. Adopt OpenPencil's *architecture pattern* — document = queryable tree,
GUI editor and AI agent are equal clients of one structured command interface —
without its code.

## Why not the alternatives (evaluated 2026-08)

- **OpenPencil** (MIT, ~7.7k stars, very active): Vue 3 + Skia/CanvasKit +
  Tauri; documents are a Figma-style Kiwi binary node tree (`.pen`/`.fig`).
  SVG import (v0.14) is a normalizing conversion — lossless round-trip and
  stable matplotlib `gid` ids are impossible by construction. Vue-only headless
  SDK. Its MCP/CLI/XPath agent interface is best-in-class and is the pattern we
  copy.
- **tldraw**: license no longer permissive (watermark or paid commercial
  license since v4, 2025). Proprietary JSON store anyway.
- **Excalidraw**: MIT, React, but proprietary scene JSON; SVG import lands as
  an image; hand-drawn aesthetic.
- **Penpot**: closest in spirit (mm-aware, "SVG under the hood") but it's a
  full platform (ClojureScript + backend), not an embeddable component, and is
  moving to a Rust/WASM WebGL renderer with its own internal model.

Every existing editor keeps a proprietary scene graph with SVG as an exchange
format. Our product inverts that: journals consume the SVG, matplotlib produces
it, git diffs it — so the editor's model must **be** the SVG DOM (parse with
DOMParser, mutate in place, serialize with XMLSerializer, preserve unknown
nodes/attributes verbatim).

## Consequences / implementation notes

- Scale is tractable: one artboard per figure, no multiplayer, Chromium SVG
  rendering gives hit-testing, text, filters, and print fidelity for free.
- Helper libraries: `svg-pathdata` (path AST), `transformation-matrix` +
  native `DOMMatrix`/`getScreenCTM` (transforms), `bezier-js` (geometry),
  headless paper.js scope only if boolean ops become needed, `opentype.js`
  for outlined-font *export copies* only. Never run svgo on source files.
- Physical units: `width="183mm" viewBox="0 0 W H"`; matplotlib exports pt
  (1 pt = 0.3528 mm); journal presets come from the active publisher profile.
- Risk areas, in order: (1) text editing — use a positioned HTML
  contenteditable overlay during edit, write back to tspans on commit;
  (2) import normalization — normalize the *view*, never the *file*; treat
  `<use>`-referenced structures as opaque units; (3) nested-transform math —
  interact in one world space via CTM inverses; (4) dense-plot performance —
  encourage rasterized data layers, bbox-cached hit testing, outline proxies
  during drag; (5) undo integrity — inverse-op command log shared with the
  agent interface.
- CI guardrail from day one: parse → serialize → byte-diff round-trip test on
  untouched files.
