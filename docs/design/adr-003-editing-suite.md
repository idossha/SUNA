# ADR-003 — Full editing suite: OpenPencil as quarry, not foundation

**Status:** accepted · 2026-08-14 (user direction: "full editing and creation
capabilities of Figma-like software")

## Decision

Build the complete Figma-grade editing experience **on our engine** —
creation tools, transform handles, properties/layers panels, snapping,
text editing — and treat OpenPencil (MIT) as a source-code quarry: port or
reimplement its framework-agnostic interaction algorithms (handle math,
snapping engine, marquee logic, keyboard model) with attribution where code
is taken verbatim.

## Why not "under the hood"

Re-affirming ADR-001 with the M2 evidence now in hand: OpenPencil documents
live in a Kiwi binary node tree; SVG is a lossy import conversion. Our
figures ARE .svg files — the engine ships a proven byte-identical
round-trip and byte-exact inverse guarantee (editing a 450-line matplotlib
export changes exactly one attribute). Embedding OpenPencil would forfeit
exactly the property the provenance loop (figure ↔ generating code) stands
on. Its Vue 3 + Skia/CanvasKit stack is also unembeddable in our React +
SVG-DOM renderer without shipping a second rendering engine.

## What "full editing" means here (spec: canvas-editing-suite.md)

The engine command bus already covers the mutation vocabulary (insert,
remove, transform, set-attrs/style/text, group/ungroup, reorder, align,
distribute, batch — all with computed inverses). The suite is therefore an
interaction/UI build: tool rail, drag-to-create shapes, 8-handle resize +
rotate, marquee selection, smart-guide snapping, properties panel, layers
panel, in-place text editing, arrow/line tools, keyboard map. Every gesture
compiles to the same commands the AI agent dispatches.
