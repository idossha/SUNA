# Feature plan 4 — split view, PDF/PNG viewers, reference PDFs, command palette

Requested 2026-08-14. Ground truth probed before writing (§0).

## 0. Probed ground truth (do not re-derive)

- **dockview already supports splitting**: `api.addPanel({ position: {
  referencePanel, direction: 'right' | 'below' | … } })`. Split view is a
  command over the existing dock, not a new layout engine.
- **pdfjs-dist 6.2.108 is installed.** ESM entry `pdfjs-dist/build/pdf.mjs`,
  worker `pdfjs-dist/build/pdf.worker.mjs`. It needs DOM (`DOMMatrix`) — it
  runs in the **renderer**, never in main/Node (Node import fails with
  "DOMMatrix is not defined"; the `legacy` build is the Node path and we do
  not need it).
- The repo ships four real journal PDFs in `references/` — use them as
  fixtures.
- Current CSP has no `frame-src`; rendering PDFs to `<canvas>` via pdf.js
  avoids iframes and custom protocols entirely.

---

## 1. Split view

- **Commands**: "Split right" (⌘\) and "Split down" (⌘⇧\) duplicate the
  active tab into a new group beside/below it; "Open to the side" (⌘↵ from
  the explorer/references/figures lists) opens the *target* file in the
  adjacent group, creating one if needed.
- Implemented in `state/dock.ts` as `openInSplit(path, direction)` using the
  dockview position API above; if a second group already exists, reuse it
  rather than endlessly splitting.
- Dragging tabs to split keeps working (dockview does it natively).
- **Acceptance**: ⌘\ on a section tab yields two groups both showing it;
  `openInSplit` twice reuses the same second group (still exactly 2 groups).

## 2. PDF and PNG viewers

Two new dock components routed by extension in `state/dock.ts`.

**PDF viewer** (`viewer/PdfTab.tsx`), pdf.js in the renderer:
- Bytes come from a new IPC channel **`fs:read-binary`** `{path} →
  {base64}` (root-confined like every other fs call). The renderer decodes
  to `Uint8Array` and calls `getDocument({data})`.
- Worker: `GlobalWorkerOptions.workerSrc` set from
  `new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url)` so Vite
  bundles it. If that proves brittle under electron-vite, fall back to
  `disableWorker` and say so.
- UI: continuous vertical page scroll, canvas per page rendered lazily
  (render only pages intersecting the viewport, ±1), page N/total indicator,
  page jump, zoom (fit-width default, ⌘+/⌘−/⌘0), and a **text layer** so
  selection and ⌘F search work. Dark-app chrome, white pages.
- Performance guard: cancel in-flight `page.render()` on zoom/scroll change
  (`RenderTask.cancel()`); never leak canvases for a 300-page PDF.

**PNG/image viewer** (`viewer/ImageTab.tsx`): `.png/.jpg/.jpeg/.gif/.webp`
open with fit/100%/zoom, pan by drag, and a pixel-dimension readout. Bytes via
the same `fs:read-binary` (data URI), so no `file://` and no CSP change.

**Acceptance**: `references/nphys3816.pdf` opens showing the correct page
count with page 1 rendered and its text selectable; a figure PNG export opens
in the image viewer with correct dimensions; scrolling a long PDF does not
grow memory without bound (render tasks are cancelled).

## 3. Reference PDFs — resolution and right-click from the manuscript

**Where PDFs live** (resolution order, first hit wins):
1. The BibTeX entry's `file` field (Zotero/JabRef style, e.g.
   `file = {:papers/gunn1972.pdf:PDF}` or a plain path) resolved relative to
   the project root.
2. `<project>/references/<citekey>.pdf`.
3. `<project>/references/` fuzzy match on `Author_Year*` (the common
   `Gunn_1972_Infall.pdf` convention).
Implement as a pure `resolvePdfPath(entry, fileListing)` in `@suna/bib` with
tests for all three plus "not found".

**Manuscript right-click**: the editor context menu (built in batch 3) gains
**"Open reference PDF"** when the click lands on a citation chip or inside a
`[@key]` span — enabled only when a PDF resolves, otherwise shown disabled
with "No PDF found for @key". Choosing it calls `openInSplit(pdfPath,
'right')`, so the paper opens beside the manuscript.
The scan runs once per project (and on saveBump), producing a
`citekey → pdfPath | null` map in a small store.

**Acceptance**: right-clicking a citation whose PDF exists opens it in the
side group without disturbing the manuscript group; a citation with no PDF
shows the disabled item with the key named.

## 4. References tab auto-opens the PDF

- Selecting an entry in the References list, when a PDF resolves, opens it in
  the **side group** automatically (reusing the group, replacing its content
  rather than piling up tabs).
- Rows show a small PDF badge when one exists; a "no PDF" row offers
  **"Attach PDF…"** which opens a file picker, copies the file to
  `references/<citekey>.pdf`, and re-scans. (Copy, never move — the user's
  original stays put.)
- A preference `references.autoOpenPdf` (default on) in Settings, because
  auto-opening is opinionated.

**Acceptance**: clicking an entry with a PDF opens it beside the list;
clicking three entries in a row leaves exactly one PDF tab, showing the last;
Attach PDF puts the file at the conventional path and the badge appears.

## 5. Command palette — terminal or AI entry point

One popup (⌘K; ⌘⇧P also opens it in command mode) over everything.

**Modes by prefix**, shown as a hint row under the input:
- *(no prefix)* — fuzzy **file search** in the project; Enter opens, ⌘↵ opens
  to the side.
- `>` — **app commands**: split right/down, new figure, export PNG/PDF,
  toggle terminal, run compliance check, open settings, switch profile… Built
  from a registry so any feature can register a command with an id, title,
  optional shortcut, and handler.
- `$` — **terminal**: the rest of the line runs in the integrated terminal
  (creating/reusing a tab, opening the panel, echoing the command).
- `?` — **AI**: the rest is sent to the agent CLI in the project directory
  (same adapter as literature search), streaming progress into the palette
  and dropping the answer into the Agent view transcript. Long-running, with
  Cancel.
- Recent entries persist per project (last 20) and appear on an empty input.

**Acceptance**: ⌘K opens focused; typing `intro` lists the intro section and
Enter opens it; `>split right` splits; `$echo SUNA_PALETTE` produces that
output in the terminal panel; `?` runs the CLI and shows its answer;
Escape closes without side effects.

---

## Constraints

- `fs:read-binary` is root-confined exactly like the text channels; no
  `file://` loading, no CSP relaxation.
- PDFs are read-only artifacts — SUNA never rewrites them.
- Pure logic (PDF path resolution, command registry filtering, palette
  fuzzy-match) gets unit tests; anything only observable in the app gets a
  smoke step using the shipped `references/*.pdf` fixtures.
- Gates: `pnpm typecheck && pnpm test && pnpm smoke` green.
