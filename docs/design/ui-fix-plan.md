# UI fix plan — layout, settings parity, live citation rendering

> **Historical design note.** The contract is [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the
> decisions are in [`docs/DECISIONS.md`](../DECISIONS.md). This file is kept for the detail and the
> sourcing it carries, but where it disagrees with the contract the contract wins — and
> `ARCHITECTURE.md` §20 lists the places it is known to. Do not treat anything here as current.

Derived from eight screenshots of the running app (2026-08-14). Each defect
below was observed, not inferred. Screens are referenced by time.

## Observed defects

### A. Content width / alignment (2.29.37, 2.29.44, 2.29.53, 2.30.01, 2.30.20)

1. **Prose source mode floats far right.** At 50ch the markdown source block
   sits at x≈950px while its line-number gutter stays at x≈270px — a huge
   dead gap. Cause: `.cm-content { margin-inline: auto }` centers the content
   inside the full-width scroller while the gutter is pinned left.
2. **Code and data files are width-constrained.** `.py`, `.json` (and by the
   same rule `.bib`, `.ts`, `.js`) obey `--ed-content-width`: at 50ch the
   Python file *soft-wraps mid-statement* and the JSON file wraps a sha256
   string, both floated right. Code must never be wrapped or centered by a
   prose setting.
3. **Body font applies to code.** The Font setting (Serif) is exposed for all
   files; code/data must always render monospace regardless.

### B. Manuscript tab (2.31.09)

4. **No settings control.** The gear popover exists only in `EditorTab`; the
   combined manuscript tab has none, so width/font/size/line-height/theme
   cannot be changed there.
5. **Inconsistent widths inside one document.** The title page block renders
   ≈1020px wide while the section editors below render ≈430px. They must
   share one measure.
6. **The manuscript tab never applies the editor settings vars**, so it falls
   back to the 68ch default and ignores the user's choice entirely.

### C. Live citation / cross-reference rendering (2.31.09, 2.31.25, 2.31.32)

7. **"Rendered as" does not drive the manuscript.** With ApJ (AAS) selected
   the sidebar preview correctly shows author–year `(Gunn & Gott 1972)`, but
   the manuscript body still shows superscript `¹ ²,³`. Same with MNRAS. The
   preview profile must drive in-text chips in the combined tab.
8. **Cross-references never resolve.** `@eq:stripping`, `@fig:fig-spectrum`
   and `@fig:fig-velocity-map` render as raw ids instead of `equation (1)`,
   `Fig. 1`, `Fig. 2`.
9. **Suffix cross-refs are not even parsed.** `(@fig:fig-spectrum{a})` in the
   Results section renders literally, including the braces.
10. **Reference list ignores sort order.** Under an author–year profile the
    sidebar list is still numbered `1.`; author–year lists are alphabetical
    and unnumbered.
11. **References list panel is cramped**: a short fixed-height scroll box with
    a horizontal scrollbar and rows whose title text overlaps the next row.
12. **Sidebar manuscript title shows raw `$z = 1.7$`** (the title page itself
    renders it correctly).

## Fixes

### Work item 1 — layout classes by content kind (owner: editor)

Introduce an explicit content-kind concept instead of treating every file the
same:

- `prose` — `.md`/`.markdown`. Width applies. Reading mode **centers** the
  measure; source mode **left-aligns** it against the gutter (Obsidian-like),
  never floating away from the line numbers.
- `code` — everything else (`.py`, `.json`, `.js`, `.ts`, `.bib`, plain
  text, the CSV Text view). Width never applies, line wrapping off (horizontal
  scroll instead), always left-aligned at the gutter, always monospace, and
  the Font control is hidden/disabled for these tabs.

Implementation: `contentKindFor(fileName)` in the editor package; the tab root
gets `editor-tab--prose` / `editor-tab--code`; the width rule is scoped to
`.editor-tab--prose`; `EditorView.lineWrapping` is only added for prose.
`margin-inline: auto` is replaced by a modifier applied only in reading mode.

Acceptance: at 50ch and 150ch — Python/JSON/bib keep full width, no wrap, text
starts immediately after the gutter; markdown source wraps at the set measure
with the block starting at the gutter; markdown reading is centered.

### Work item 2 — settings parity in the manuscript tab (owner: manuscript)

- Extract the gear button + popover from `EditorTab` into a shared component
  (`editor/SettingsPopover.tsx` already exists; export a `<EditorSettingsButton />`
  wrapper) and mount it in the manuscript tab's header.
- The manuscript tab root must set the same CSS variables `EditorTab` sets
  (`--ed-content-width`, `--ed-font-size`, `--ed-body-font`, `--ed-line-height`)
  and apply the theme class.
- **One measure for the whole document**: the title page, every section editor,
  and the references block all inherit the same `--ed-content-width` and are
  centered together. Verify the title-page block and a section paragraph have
  equal client widths.

Acceptance: changing width/font/size in the manuscript tab visibly reflows the
title page and all sections together; a smoke assertion compares the measured
width of a title-page paragraph against a section line at two settings.

### Work item 3 — profile-driven in-text citations (owner: citations)

`state/renderProfile.ts` already holds `previewProfileId`, and
`manuscript/citeChips.ts` already rewrites chips; the wiring is incomplete.

- The combined tab must publish, per the **preview** profile: the number map,
  the citation `mode`, and the entry map.
- `citeChipText` must branch on mode: `numeric-superscript` → collated
  superscript (existing), `author-year` → `(Gunn & Gott 1972)` / narrative
  `Gunn & Gott (1972)`, `parenthetical-numeric` → `(1, 2)`.
- Re-run the DOM pass whenever `previewProfileId` changes, not only on save.
- The references block below must re-sort per the profile's `sortOrder`
  (alphabetical, unnumbered for author–year; appearance-numbered otherwise).

Acceptance: with the example project, switching Rendered as → ApJ turns body
chips into author–year *and* renumbers/re-sorts the reference list; switching
back to Nature Astronomy restores superscripts. Smoke asserts both directions.

### Work item 4 — cross-reference resolution (owner: citations)

- Build a **label map** for the document: figures in `manuscript.json` order
  → `Fig. 1`, `Fig. 2` (label word from the active profile's
  `captionStyle`/figure label where available, else `Fig.`); tables → `Table N`;
  display equations, in document order across sections → `(1)`, `(2)`; sections
  → their heading.
- Cross-ref chips render the resolved label, with the panel suffix appended
  (`@fig:fig-spectrum{a}` → `Fig. 1a`). Unresolvable ids keep the raw text and
  a warning style — never silently blank.
- Fix the parse gap so `{a}` suffixes are recognised in every position,
  including inside parentheses; add parser tests in `@suna/markdown` for
  `(@fig:x{a})`, `@eq:y`, `@tbl:z`.

Acceptance: the intro's `@eq:stripping` renders `equation (1)`, the Results
`(@fig:fig-spectrum{a})` renders `(Fig. 1a)`; a bogus `@fig:nope` stays raw and
is styled as unresolved.

### Work item 5 — references panel polish (owner: citations)

- Remove the fixed-height/overflow trap: the list grows with the panel, rows
  clamp their title to two lines, no horizontal scrollbar.
- Author–year profiles render the list unnumbered and alphabetical.
- Render inline math in the manuscript sidebar summary title (KaTeX), matching
  the title page.

## Constraints for all work

- No behavioural change to file formats or the engine; this is presentation.
- Every fix needs a test at the level it lives (vitest for pure logic, a smoke
  step for anything only observable in the running app).
- Gates: `pnpm typecheck && pnpm test` plus `pnpm smoke` all green.
