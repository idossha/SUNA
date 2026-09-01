# Review: fluxsci/flux (2026-08-14)

> **Historical design note.** The contract is [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the
> decisions are in [`docs/DECISIONS.md`](../DECISIONS.md). This file is kept for the detail and the
> sourcing it carries, but where it disagrees with the contract the contract wins — and
> `ARCHITECTURE.md` §20 lists the places it is known to. Do not treat anything here as current.

`github.com/fluxsci/flux` — "local-first desktop app for assembling
scientific figures, papers, and slides… entirely offline." A **direct
sibling project** to SUNA: Electron + Svelte 5 + CodeMirror 6 + KaTeX,
plots via a companion Python library (`fluxplot`), journal styles with an
advisory-only checker, agent integration via MCP. ~6.5 weeks old, 2
contributors (UW-Madison sleep-neuroscience community), 480+ commits,
0 stars, no published releases. App repo is **MIT** (portable with
attribution); **`fluxsci/fluxplot` has NO license — ideas only, never code.**

## Adopt (ranked)

1. **fluxplot's semantic-plot contract → reimplement in suna_mpl** (ideas
   only; that repo is unlicensed):
   - **Byte-deterministic SVG regeneration** (pin `svg.hashsalt`,
     `fonttype: none`, strip dates, canonical ordering). Prerequisite for
     our provenance loop — "reviewable diffs" require byte-stable regen.
   - **Per-axis (data,svg) anchor pairs** in a sidecar manifest: exact
     data↔pixel mapping incl. log axes, without reconstructing matplotlib
     transforms. Enables data-space positioning of canvas annotations.
   - **Auto-rasterize heavy layers** (>~800 primitives, per-artist): their
     measured 76k-node SVG → 67 nodes. Our SVG-DOM canvas hits the same
     wall on astro scatter/density plots (~2.5 fps at 260k nodes).
   - `svgSha256` staleness check between SVG and sidecar.
2. **Agent-layer patterns for M4** (MIT, portable): one zod verb registry
   generating CLI verbs + MCP tools + GUI ops from the same
   schema/handler; `get_figure_image` returning PNG so a vision-capable
   agent can *see* its edits; token-gated live bridge whose dispatched
   commands are ordinary undoable edits, with file-verb fallback when the
   app is closed; append-only `journal.ndjson` write log + advisory locks
   so agent writes defer to in-flight human edits; context-stamped
   feedback notes (capture what the user is looking at with the note).
3. **Publisher-profile upgrades** (small): per-value provenance tags —
   counted-empirically vs documented vs inferred (their killer finding:
   Nature's *printed* panel style diverged from its own author guidelines
   in 2022, and nature.com self-contradicts on legend caps — record both);
   `extends` inheritance between profiles; the "author-adjacent figure
   reference" false-positive fix ("Gao Figure 2D" is someone else's
   figure — track foreign figure numbers); severity scaling by submission
   stage.
4. **Export lessons** for the Tectonic milestone: once figure families
   exist (Fig / Supplementary / Extended Data numbering independently),
   figure numbers, captions, and refs must be baked to literal text
   before the downstream renderer — never delegate numbering. And their
   counter-lesson: flux requires user-installed Quarto+TinyTeX, so a
   fresh install cannot export; our bundled-Tectonic plan is the better
   call — keep it.
5. **Smaller**: DOI-paste → instant citation chip; comments as sidecar
   JSON with detached-anchor preservation; their MIT reference-library
   subsystem (OpenAlex/CrossRef enrichment, OA PDF waterfall) as a
   reference design for our references panel; per-feature `verify-*`
   harness granularity as the growth path for our smoke test.

## Validated (no change)

- **Provenance**: flux's regen-surviving override layer keyed to semantic
  ids is exactly our provenance-loop.md design (overlay replayed on
  regenerate; absorb-to-script an explicit, mechanically-verified action).
  Independent convergence — keep.
- **Compliance philosophy**: advisory-only, never rewrite. Same.

## Do NOT take

- Their canvas model: figures are app-managed JSON referencing *copies*
  of plots; renders are derived. Our .svg-is-the-document with
  byte-identical round-trip is stronger and interoperable — keep ours.
- Two hardcoded TS journal presets — our sourced JSON profiles scale.
- The local-corrections subsystem (bundled 2.3 GB local model) — scope
  sink.
- flux as a dependency in any form: bus factor ≈ 1, zero community.

Local mirrors of inspected files (session scratchpad): flux-core recipe/
registry, compliance.ts, journalPresets.ts — reimplement with attribution
if any code ports verbatim (then add a NOTICE file).
