# Canvas Editing Suite Specification

The Figma-grade interaction layer over the `@suna/canvas` engine
(canvas-engine.md). Everything here compiles to existing engine commands —
no new mutation primitives. Two layers:

- `@suna/canvas` `src/interact/` — framework-free interaction core
  (testable pure TS: state machines + geometry).
- `apps/desktop` canvas UI — React components that render the core's state
  and forward pointer/keyboard input.

## 1. Tools & keyboard map

| Key | Tool | Behavior |
|---|---|---|
| V | Select | click/shift-click/marquee; drag moves; handles resize/rotate |
| R | Rectangle | drag to create (`insert` rect; shift = square) |
| O | Ellipse | drag to create (shift = circle) |
| L | Line | drag to create (shift = 45° snap) |
| A | Arrow | line + marker-end (def added once per document, `suna-arrow`) |
| T | Text | click to place; enters text editing immediately |
| Esc | — | cancel gesture / exit text edit / back to Select |
| ⌘Z / ⇧⌘Z | — | undo / redo (exists) |
| ⌘G / ⇧⌘G | — | group / ungroup selection |
| ⌘D | — | duplicate selection (`insert` of serialized copy, +8,+8 offset) |
| Delete | — | remove selection (exists) |
| Arrows / ⇧Arrows | — | nudge 1 / 10 user units (`translate`) |
| ⌘] ⌘[ ⌥⌘] ⌥⌘[ | — | forward / backward / front / back (`reorder`) |

Tool state lives in a `ToolController` FSM: `idle → armed(tool) →
gesture(tool, data) → idle`. Pointer events arrive already converted to
world coordinates; the controller emits either ephemeral state (previews,
guides, marquee rect) or final commands.

## 2. Selection & transform

- Marquee: drag on empty canvas in Select → world-space rect; selects
  elements whose bbox intersects (semantic-unit rule from CanvasTab
  applies: matplotlib internals resolve to their gid ancestor).
- Handles: selection bbox (union, world space) renders 8 resize handles +
  1 rotate handle (above top-center). Resize maps to `transform` compose
  about the opposite anchor; shift = uniform scale, alt = about center.
  Rotate about bbox center; shift snaps to 15°. Multi-select transforms
  compose the same matrix onto each member (one `batch`).
- Text elements resize = font-size scale, not matrix (guideline-friendly);
  the properties panel is the primary font-size control.

## 3. Snapping & smart guides

During move/resize/create: candidate lines from artboard edges + centers
and sibling bbox edges + centers (visible, ≤ 200 candidates); snap when
within `6 / zoomScale` user units; emit guide segments for the overlay.
Equal-spacing hints are P2.

## 4. Creation semantics

New elements insert into the artboard root (or the deepest *common
selected* group), with `suna-e<n>` ids, current style defaults, and land
selected in Select tool. Style defaults follow the active publisher
profile's figure rules (stroke width within min/max, Wong palette order
for new strokes/fills, text at profile-compliant pt).

## 5. Properties panel (right rail of the canvas tab)

Sections appear per selection type:
- **Geometry**: x, y, w, h (world units + mm readout), rotation.
- **Fill**: color swatch + hex field; `none` toggle. Palette row = active
  profile's suggested colors (Wong for Nature).
- **Stroke**: color, width (pt), dash presets (solid/dashed/dotted), caps.
- **Text**: font family (profile-preferred list), size (pt, flags
  violations live), weight, anchor.
- **Opacity** slider.
All edits dispatch `set-attrs`/`set-style` (debounced per gesture into one
history entry via `batch`).

## 6. Layers panel (left rail of the canvas tab)

Tree view of the artboard's element tree (ids as names, tag icons):
select (syncs canvas), reorder via drag = `reorder`/`reparent`, double
click renames id (= `set-attrs id`, engine keeps addressing stable),
eye toggle = `set-style display` (still a recorded command), lock is
UI-only state. Virtualize above 500 nodes.

## 7. Text editing

Double-click a `<text>` (or place with T): HTML contenteditable positioned
via the element's screen CTM, styled to match (family/size/weight/fill,
scaled by zoom). Commit on blur/⌘Enter → `set-text` (+ `set-attrs` for new
elements); Esc cancels. Multi-`tspan` texts edit as plain lines in v1.

## 8. Mirror discipline

The engine document stays pristine off-DOM (M2 rule). Gesture previews
mutate ONLY the mirror clone; commit dispatches engine commands and
re-syncs the mirror. The properties panel reads from the engine document,
never the mirror.

## 9. OpenPencil usage

Port framework-agnostic algorithm shapes (handle anchor math, snap
candidate collection, marquee hit rules, keyboard map) — reimplemented
against our world-space model; verbatim code carries a source comment with
repo path + MIT attribution in NOTICE.

## 10. Acceptance (smoke additions)

Agent-drivable proof: create rect via R+drag → properties set fill from
palette → resize with a handle → align two shapes → add text via T +
type → save → reload → all persisted in the .svg; undo chain back to
pre-edit state = byte-identical file.
