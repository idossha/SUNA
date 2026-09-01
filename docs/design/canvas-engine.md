# Canvas Engine Specification

> **Historical design note.** The contract is [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the
> decisions are in [`docs/DECISIONS.md`](../DECISIONS.md). This file is kept for the detail and the
> sourcing it carries, but where it disagrees with the contract the contract wins — and
> `ARCHITECTURE.md` §20 lists the places it is known to. Do not treat anything here as current.

Implementation contract for `@suna/canvas`. Extends ADR-001 (custom SVG-DOM
editor) and reference-analysis §2 (capability ranking). Everything here is
renderer-side; no Node APIs.

## 1. Document model

The document **is** an `SVGSVGElement` parsed from `figure.svg` with
`DOMParser` and serialized with `XMLSerializer`.

- **Never normalize the file.** Unknown elements, attributes, namespaces,
  comments, and processing instructions are preserved verbatim. Editing
  changes only the attributes/nodes a command names.
- **Round-trip invariant** (CI-enforced): `serialize(parse(svg))` is
  byte-identical for untouched files, modulo a single documented
  canonicalization: none in v1 — byte-identical, full stop.
- The engine wraps the DOM in a `CanvasDocument` facade:
  - `root: SVGSVGElement`
  - `getById(id) / index` — live id index (MutationObserver-maintained)
  - `serialize(): string`
  - `artboard: { widthMm, heightMm, viewBox }` — physical size contract
  - `history: CommandHistory`
  - `dispatch(command): CommandResult`
- Elements without ids that must be addressed get a **structural address**
  fallback: `#parentId>nth:3` (nth element child of the nearest id'd
  ancestor). Commands that touch such elements first mint a real id
  (`suna-e1`, `suna-e2`, …) via an implicit `assign-id` step recorded in the
  same transaction, so histories and overlays stay stable.

## 2. Coordinate spaces

Three spaces, converted only through DOMMatrix:

| Space | Units | Owner |
|---|---|---|
| screen | CSS px | pointer events |
| world | SVG user units of the root viewBox | all engine math |
| local | element's own user space | attribute writes |

- `screenToWorld = root.getScreenCTM()!.inverse()`
- `worldToLocal(el) = el.getCTM()!.inverse() × rootCTM` (computed per
  interaction, cached per frame)
- All hit testing, snapping, and gesture math happens in **world** space.
  Attribute writes translate to **local** space at commit.
- Physical mapping: `mmPerUser = artboard.widthMm / viewBox.width`. Rulers,
  the properties panel, and export report mm; matplotlib SVGs use pt user
  units (1 pt = 0.3528 mm) — the artboard adapter reads `width`/`height`
  attributes (`pt`, `mm`, `in`, unitless→px@96dpi) to derive the mapping.

## 3. Command bus

One serializable command vocabulary; the mouse, keyboard, properties panel,
and AI agent all dispatch the same objects. JSON-serializable, validated by
zod schemas in `@suna/core` (shared with the agent tool layer).

```ts
type Target = string            // element id (or structural address, see §1)

type CanvasCommand =
  | { kind: 'set-attrs';   target: Target; attrs: Record<string, string | null> }   // null deletes
  | { kind: 'set-style';   target: Target; props: Record<string, string | null> }   // style props as presentation attrs when possible
  | { kind: 'set-text';    target: Target; text: string }                            // text/tspan content
  | { kind: 'translate';   targets: Target[]; dx: number; dy: number }               // world units
  | { kind: 'transform';   target: Target; matrix: [number,number,number,number,number,number]; mode: 'replace' | 'compose' }
  | { kind: 'reorder';     target: Target; mode: 'front'|'back'|'forward'|'backward' }
  | { kind: 'reparent';    target: Target; parent: Target; index?: number }
  | { kind: 'group';       targets: Target[]; id?: string }
  | { kind: 'ungroup';     target: Target }
  | { kind: 'insert';      parent?: Target; index?: number; svg: string; id?: string }
  | { kind: 'remove';      targets: Target[] }
  | { kind: 'align';       targets: Target[]; axis: 'x'|'y'; mode: 'start'|'center'|'end' }
  | { kind: 'distribute';  targets: Target[]; axis: 'x'|'y' }
  | { kind: 'set-artboard';widthMm?: number; heightMm?: number }
  | { kind: 'batch';       commands: CanvasCommand[]; label?: string }               // one undo step
```

Rules:

- `dispatch` validates, applies, and returns `{ ok, inverse, affected }` or a
  structured error (`target-not-found`, `invalid-svg`, `text-on-non-text`).
- **Undo = inverse commands.** Every apply computes its inverse from the
  pre-state (e.g. `set-attrs` captures prior values, `remove` captures
  serialized subtree + position). History is a bounded stack of
  `{command, inverse, label}` transactions; `batch` nests into one entry.
- Gestures compile to commands only at commit time: during a drag the engine
  moves elements via a **preview transform** (CSS transform on an overlay
  clone or direct attribute with deferred history); on pointer-up it emits
  one `translate`/`transform` command. Escape aborts by restoring pre-state.
- Commands never encode view state (zoom, selection) — those are ephemeral
  UI stores. The agent has separate query APIs (§6) instead.

## 4. Interaction layer

React components render *around* the mounted SVG; the SVG itself is mounted
raw (`ref.appendChild(document.rootElement)`) so React never reconciles
figure content.

- **Viewport**: pan (space-drag / two-finger), zoom to cursor (pinch /
  ⌘-wheel), fit / 100% / fill; zoom is a CSS transform on the world layer so
  the SVG's own coordinate system is untouched.
- **Selection**: click (deepest interactive element), ⌘-click toggles,
  drag-marquee (world-space intersection of bboxes), double-click enters
  group/text. Selection chrome (bbox outline, 8 resize handles, rotate
  handle) renders in a screen-space overlay layer.
- Opaque units: `<use>` instances, and any `<g>` imported from matplotlib
  whose id matches a semantic gid (e.g. `ax0.legend`), select as a unit;
  double-click drills in.
- **Transform handles**: resize maps to a `transform` command composing
  scale about the opposite anchor; shift = uniform, alt = about center.
  Rotation snaps to 15° with shift.
- **Snapping**: candidate lines from artboard edges/center, sibling bbox
  edges/centers within the viewport, and a 4-unit world threshold (scaled by
  zoom). Guide render in overlay. Alignment commands reuse the same
  geometry service.
- **Text editing**: double-click a `<text>` overlays an HTML
  `contenteditable` positioned via the element's CTM, styled to match
  (font-family/size/weight/fill). Commit (blur/⌘-Enter) diffs into a
  `set-text` (+ optional `set-attrs`) command; multi-`tspan` texts edit as
  lines. Math-labeled text (matplotlib usetex-style unicode) edits as plain
  unicode in v1.

## 5. Import & artboards

- `importSvg(text, opts)` → `CanvasDocument`. Validates well-formedness,
  extracts artboard size (§2), builds the id index, and *flags* (not fixes)
  problems: duplicate ids, missing viewBox, script/foreignObject content
  (stripped copies never overwrite the source file without an explicit
  command).
- Journal presets come from the active publisher profile
  (`figureWidthPresetsMm`); `set-artboard` rewrites `width`/`height`
  attributes only, never rescales content (a separate explicit
  `transform` on a wrapping group does that).
- New blank figures scaffold:
  `<svg width="89mm" height="55mm" viewBox="0 0 253 156">` (pt units,
  matplotlib-compatible density).

## 6. Agent interface

The AI agent drives the canvas through three tool surfaces (wired in
`@suna/agent`, executed in the renderer):

1. `canvas_query(figureId, query)` — read-only: `{kind:'tree', depth}` returns
   the element tree (id, tag, bbox-world, text, key attrs);
   `{kind:'element', id}` full detail; `{kind:'selection'}`.
2. `canvas_dispatch(figureId, command)` — the same `CanvasCommand` union,
   same validation, same history (agent edits are undoable by the human).
3. `canvas_screenshot(figureId)` — rasterized PNG of the current document for
   visual verification.

Guardrail: agent dispatches are auto-labeled in history
(`label: 'agent: …'`) so the UI can show and revert AI edits as a group.

## 7. Rendering performance

- Direct DOM SVG up to ~5k elements (covers every reference figure).
- During drags: suspend snapping recompute above 1k selected-candidate pairs,
  use `will-change: transform` on the moved subtree, batch attribute writes
  in `requestAnimationFrame`.
- Dense data layers (10k-point scatters) are matplotlib's problem, not ours:
  suna_mpl will grow a `rasterized=True` guidance so heavy artists export as
  embedded images with vector overlays (already the journal-figure norm).

## 8. Testing

- Engine logic (commands, inverses, geometry, structural addressing) runs in
  vitest + jsdom-with-SVG shims where possible; anything needing real layout
  (`getScreenCTM`, `getBBox`) runs in Playwright-driven Electron e2e.
- Golden invariant suite: round-trip byte-identity on a corpus of real
  matplotlib exports (generated by suna_mpl in CI) + every command's
  apply→invert→apply idempotence.
