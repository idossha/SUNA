# SUNA — Architecture

SUNA is an Electron-based academic writing platform: a VS Code-like workspace for
human–AI co-writing of research papers, with live Markdown/LaTeX rendering, a
Figma-like SVG figure canvas with code provenance, publisher-aware output
formatting, reference management, and git version control.

**Format doctrine:** JSON, Markdown, BibTeX, SVG, and LaTeX are the only sources
of truth. PDF/DOCX are export-only, produced at final stages.

---

## 1. Repository layout (pnpm monorepo)

```
SUNA/
  apps/
    desktop/            # Electron app (electron-vite): main / preload / renderer
  packages/
    core/               # @suna/core       — schemas, types, project model, IPC contracts
    markdown/           # @suna/markdown   — SciMark pipeline (remark + citations/crossrefs/math)
    formatter/          # @suna/formatter  — publisher profiles → LaTeX/HTML → PDF (Tectonic)
    canvas/             # @suna/canvas     — SVG-native figure editor engine + React UI
    bib/                # @suna/bib        — BibTeX parse/render, citation processors, DOI fetch
    agent/              # @suna/agent      — provider-agnostic AI layer + tool registry
    provenance/         # @suna/provenance — figure ↔ generating-code sync (overlay model)
  python/
    suna_mpl/           # pip package: matplotlib gid tagging + journal presets + SVG export
  resources/
    profiles/           # publisher profiles (nature-astronomy.json, nature-physics.json, …)
    templates/          # LaTeX templates per profile
  docs/design/          # this document, reference-analysis.md, decisions
  references/           # user-supplied exemplar PDFs
```

## 2. The research project SUNA manages

`File → New Project` scaffolds the researcher's working directory:

```
my-paper/
  suna.json                  # project manifest: name, active publisher profile, tool config
  manuscript/
    manuscript.json          # journal-agnostic metadata + ordered section tree (see reference-analysis §3)
    sections/*.md            # SciMark sections (Markdown + LaTeX math + citations + crossrefs)
    references.bib           # bibliography source of truth
  figures/
    <figure-id>/
      figure.json            # caption, namespace, width preset, panels, provenance block
      figure.svg             # canvas source of truth (always valid SVG on disk)
      source/                # generating script(s), e.g. plot.py
  code/                      # analysis codebase
  data/                      # raw + processed data
  analysis/                  # notebooks, pipelines
  results/                   # intermediate outputs
  output/                    # compiled exports (PDF/DOCX) — final stage only
  .git/                      # initialized on project creation
```

Everything in `manuscript/` and `figures/` is plain text (JSON/MD/BIB/SVG) —
diffable, mergeable, agent-editable.

## 3. SciMark — the manuscript dialect

Markdown (CommonMark + GFM tables) extended with, using Pandoc-compatible syntax
where it exists:

- **Math**: `$…$` inline, `$$…$$`/`\begin{equation}` display. Rendered with
  KaTeX in preview; passed through to LaTeX on export. Display equations get
  auto-numbers and `{#eq:label}` ids.
- **Citations**: `[@wang2025; @smith2024]` and narrative `@wang2025`. Resolved
  against `references.bib`; rendering (superscript numeric, author-year,
  parenthetical) is decided by the active publisher profile, never stored.
- **Cross-references**: `@fig:cluster`, `@tbl:params`, `@eq:tf`, `@sec:methods`
  (pandoc-crossref style). Compound panel refs: `@fig:cluster{b}` → "Fig. 2b".
- **Raw LaTeX escape hatch**: fenced block ```` ```{=latex} ```` passes through
  verbatim to LaTeX output (dropped or approximated in HTML preview).
- **Figure/table placement**: `![[fig:cluster]]` embeds a managed figure by id;
  caption and numbering come from `figure.json` + profile, not from the inline
  syntax.

Pipeline: remark parses to mdast + custom node types → **SUNA AST** →
two emitters: HTML (live preview) and LaTeX (export). One parser, two targets —
preview and print can never structurally diverge.

## 4. Editor UX (renderer)

- **Shell**: dockview-based VS Code-like layout — activity bar, collapsible side
  panels, tabbed editor groups with split, bottom panel, status bar, command
  palette (⌘⇧P).
- **Views**: Explorer (file tree) · Manuscript (section outline, drag-reorder) ·
  Figures (gallery of figure.svg thumbnails) · References (bib manager) ·
  Source Control (git) · Agent (chat + tool activity).
- **Editor**: CodeMirror 6. Two modes per manuscript tab, toggle in the tab
  toolbar (⌘E):
  - **Source** — Markdown/LaTeX with syntax highlighting.
  - **Rendered** — the same content through the SciMark HTML emitter (KaTeX
    math, resolved citations "¹²", numbered figures with live SVG), scroll-synced.
- **Figure tabs** open the canvas; profile-aware artboard presets (89 mm /
  183 mm widths from the active profile).

## 5. Canvas — SVG-native figure editor

Decision (pending open-pencil evaluation): the document model **is** the SVG
DOM. No proprietary scene graph that SVG converts in/out of.

- Engine layer (`packages/canvas/src/engine`): selection model, transform math
  (matrix ops on SVG user units), hit testing, snapping/alignment guides,
  z-order/grouping, text editing, path editing. Renders by mounting the SVG
  document into the workspace with an overlay layer for handles/guides.
- Physical units: artboard defined in mm (journal presets); SVG `viewBox` maps
  user units → mm; export writes `width`/`height` in mm for print-exact output.
- **Command interface (AI-facing)**: every mutation goes through a serializable
  command bus — `select(target)`, `setStyle(target, props)`, `translate`,
  `resize`, `setText`, `alignRow`, `group`, … Human gestures compile to the same
  commands the agent emits. This gives: undo/redo for free, agent drivability,
  and the provenance record (§6).
- Targets are stable element ids (SVG `id`/`gid` from matplotlib) with
  structural fallbacks (nth-of-type paths) for untagged elements.
- Capability roadmap follows reference-analysis §2 ranking (math-capable text,
  multi-panel grids, axes, legends, colorbars, shaded bands … ).

## 6. Provenance loop — figure ↔ code sync

The novel piece: figures generated by code stay editable by hand *and*
reproducible.

1. **Generate**: `source/plot.py` uses matplotlib (ideally with `suna_mpl`,
   which auto-assigns semantic `gid`s: `ax0`, `ax0.title`, `ax0.line.halpha`,
   `legend`, …) and exports `base.svg`.
2. **Edit**: canvas edits are recorded as an ordered **overlay** of structured
   ops in `figure.json`:
   `{ "target": "ax0.title", "op": "set-style", "props": { "font-size": "8pt" } }`.
   `figure.svg` on disk is always *base ⊕ overlay* (baked, valid SVG).
3. **Regenerate**: when the script re-runs (new data), the overlay replays onto
   the fresh base — manual polish survives data changes. Ops whose targets
   vanished are flagged, not silently dropped.
4. **Absorb**: the agent tool `absorb_overlay(figure)` translates overlay ops
   into edits to `plot.py` (e.g. set-style on `ax0.title` → `ax.set_title(...,
   fontsize=8)`), presented as a reviewable diff; absorbed ops are removed from
   the overlay. The figure is now reproducible from code alone.
5. Figures drawn from scratch have no provenance block; they're plain SVG.

## 7. Formatter — publisher-aware output

- **Publisher profile** = declarative JSON (schema per reference-analysis §1):
  page geometry, typography tokens, page templates, section-ordering rules,
  caption/table/equation/citation styling, brand tokens, numbering namespaces.
- **Export path**: manuscript.json + sections + bib + figures → SUNA AST →
  LaTeX emitter renders through the profile's template → **Tectonic**
  (self-contained XeTeX engine, auto-downloaded per platform) → PDF into
  `output/`.
- **Journal preview**: the same profile drives a paged HTML preview
  (CSS @page emulation) for fast in-app "how it will look" rendering; the PDF
  is the ground truth.
- **DOCX**: final-stage export via Pandoc from the SUNA AST (submission
  convenience only).
- Citation engine: cite-key → cluster → profile processor (numeric-superscript
  with range collapsing / author-year / parenthetical) → inline node + ordered
  bibliography with journal abbreviation table. Numbering is always derived at
  format time, never stored.

## 8. AI layer — provider-agnostic co-writing

- `Provider` interface: `stream(request: {messages, tools, system}) →
  AsyncIterable<AgentEvent>` (text deltas, tool calls, usage). Adapters:
  **Anthropic**, **OpenAI**, **Ollama/local**; keys in OS keychain via
  `safeStorage`, model picker per conversation.
- **Tool registry** (executed app-side, permission-gated per tool class):
  - manuscript: read/edit sections, restructure, search
  - bibliography: search bib, fetch by DOI/arXiv, insert citation
  - figures: list, read structure, emit canvas commands (§5), `absorb_overlay`
  - project: run Python in project env (uv), read data/results listings
  - output: compile preview, report LaTeX errors back to the agent
- Co-writing UX: agent panel chat; inline "ghost" suggestions in the editor;
  every agent file edit lands as a reviewable diff, never a silent write.

## 9. Main/renderer split & IPC

Main process owns: filesystem, git (system binary), Python execution, Tectonic,
AI network calls, keychain. Renderer owns: UI, editor, canvas, preview.
Typed IPC via contextBridge with zod-validated channel contracts defined in
`@suna/core` (single source for both sides). No Node integration in renderer.

## 10. Stack

| Concern | Choice |
|---|---|
| Shell | Electron + electron-vite, TypeScript strict |
| UI | React 19, dockview (docking/tabs), zustand (state) |
| Editor | CodeMirror 6 |
| Math preview | KaTeX |
| Markdown | remark/unified + custom SciMark extensions |
| Canvas | SVG DOM native (evaluating open-pencil as a base) |
| PDF | Tectonic (bundled/auto-downloaded), profile LaTeX templates |
| Bib | BibTeX parser + custom citation processors |
| Git | system git via main-process service |
| Python | user env via uv; `suna_mpl` helper package |
| Tests | vitest per package; golden-file tests for formatter; Playwright e2e later |

## 11. Build order

1. **M0 — Skeleton**: monorepo, Electron boots, dockview shell, project
   scaffold/open, typed IPC. ← *current*
2. **M1 — Writing core**: CodeMirror + SciMark pipeline + rendered mode toggle,
   manuscript outline, bib panel + citation insert, git panel.
3. **M2 — Canvas core**: SVG import/render, selection/transform/text, command
   bus, mm artboards, export.
4. **M3 — Formatter**: Nature Astronomy profile end-to-end → Tectonic PDF;
   journal HTML preview.
5. **M4 — Agent**: provider layer, tool registry, co-writing UX.
6. **M5 — Provenance**: suna_mpl, overlay model, regenerate/absorb loop.
7. Then: deepen each pillar per reference-analysis rankings (V2/V3 canvas
   capabilities, more profiles, DOCX export, Science/ApJ/MNRAS profiles).
