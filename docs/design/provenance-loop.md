# Provenance Loop Specification

Implementation contract for `@suna/provenance`: how a figure stays both
hand-editable and reproducible from code. Complements canvas-engine.md §3/§6
and architecture.md §6.

## 1. The three artifacts

```
figures/<id>/
  source/plot.py     # generating script (any language; python first)
  figure.svg         # ALWAYS the current visual truth = base ⊕ overlay
  figure.json        # caption/panels/etc + provenance block
```

`figure.json → provenance`:

```jsonc
{
  "generator": { "script": "source/plot.py", "interpreter": "python" },
  "baseSvgHash": "sha256-…",     // hash of the last raw generator output
  "overlay": [ /* OverlayOp[] — ordered, replayable */ ],
  "orphans": [ /* OverlayOp[] whose targets vanished at last replay */ ]
}
```

Overlay ops are the subset of canvas commands that are **replayable by
target id**: `set-style`, `set-attrs`, `set-text`, `translate`, `scale`,
`reorder`, `delete`, `insert`. Interactive-only notions (selection, batch
labels) never reach the overlay.

## 2. Write path (canvas edit on a generated figure)

1. Canvas dispatches command → engine applies to the DOM → `figure.svg`
   saved (debounced).
2. The provenance recorder folds the command into the overlay:
   - same `(target, kind)` pair coalesces (last `set-style` per prop wins;
     `translate` deltas sum),
   - ops on elements created by `insert` keep their full subtree inline,
   - op order preserved otherwise (a `delete` clears prior ops on that target).
3. `figure.json` saved with the updated overlay.

Figures without a `provenance` block (drawn from scratch) skip step 2/3.

## 3. Regenerate path (`Run script`)

1. Execute `generator.script` in the project env (uv) with
   `SUNA_FIGURE_OUT=<tmp>/base.svg`; suna_mpl's `save_svg` honors it. A
   script that doesn't cooperate is detected (no output file) and reported.
2. Hash the new base; if unchanged, stop (figure already current).
3. **Replay** the overlay onto the fresh base in order:
   - resolve each op's target id in the new DOM;
   - unresolved targets → op moves to `orphans` (never silently dropped;
     the figure panel badges "N edits couldn't re-apply");
   - resolved ops apply exactly like live commands.
4. Bake result to `figure.svg`, update `baseSvgHash`, save `figure.json`.

Determinism contract: replay(base, overlay) is a pure function; regenerating
twice with the same data yields byte-identical `figure.svg`.

## 4. Absorb path (edits → code)

The `absorb_overlay` agent tool turns overlay ops into source edits so the
script alone reproduces the current figure:

1. Agent reads `plot.py` + the overlay + the semantic gid map
   (`ax0.title` → `ax.set_title(...)` site, `ax0.line.halpha` → the plot
   call with `label="halpha"`).
2. Produces a unified diff of `plot.py` translating each op it can
   (`set-style {font-size}` on `ax0.title` → `fontsize=` kwarg;
   `translate` on `ax0.legend` → `loc=/bbox_to_anchor=`; axis-limit
   `set-attrs` → `set_xlim`; unmappable ops stay in the overlay).
3. Human reviews the diff in the editor (never auto-applied).
4. On apply: regenerate (§3) with the new script; ops whose visual effect is
   now produced by the base are **verified absorbed** — the replayed op is a
   no-op diff against the base — and removed from the overlay. Ops that
   still change pixels stay, and the agent reports which and why.

Step 4's verification is mechanical (attribute diff), not trust in the LLM:
an op is deleted only when the fresh base already contains its effect.

## 5. Drift & conflict rules

- Script edited by hand → next regenerate replays as usual; orphans surface
  in UI. No merge prompts — the overlay is always subordinate to code.
- `figure.svg` edited outside SUNA → on open, hash mismatch vs
  base⊕overlay marks provenance **stale**; offered choices: adopt (fold the
  external diff into the overlay via DOM diffing — v2), or detach
  (drop provenance), or discard external changes. v1 ships adopt=manual,
  detach, discard.
- Deleting `source/` detaches provenance with a warning.

## 6. Why an overlay (recorded ops) and not DOM diffing

Recording at command time gives intent (`translate legend by (4,-2)`)
rather than effect (`transform="matrix(…)"` changed), which is exactly what
absorb needs to write sensible code. DOM diffing is kept only as the v2
"adopt external edit" fallback, where intent is unavailable.
