# SUNA

An academic writing platform: a VS Code-like desktop workspace for human–AI
co-writing of research papers, with live Markdown/LaTeX rendering, a
Figma-like SVG figure canvas whose edits sync back to the generating code,
publisher-aware output formatting, reference management, and git built in.

**Format doctrine:** JSON, Markdown, BibTeX, SVG, and LaTeX are the only
sources of truth. PDF/DOCX are produced at export time only.

## Run

```bash
pnpm install
pnpm dev          # launches the Electron app
```

## Layout

| Path | What |
|---|---|
| `apps/desktop` | Electron shell (main / preload / renderer) |
| `packages/core` | Schemas: project, manuscript, figure, publisher profile, IPC contracts |
| `packages/markdown` | SciMark — the manuscript Markdown dialect (math, citations, cross-refs) |
| `packages/formatter` | Publisher profiles → LaTeX/HTML → PDF (Tectonic) |
| `packages/canvas` | SVG-DOM-native figure editor |
| `packages/bib` | BibTeX parsing, citation numbering, reference formatting |
| `packages/agent` | Provider-agnostic AI layer (Anthropic, OpenAI, Ollama) |
| `packages/provenance` | Figure ↔ generating-code sync (overlay model) |
| `python/suna_mpl` | Matplotlib companion: stable SVG ids, journal mm presets |
| `docs/design` | Architecture, reference analysis, ADRs |

## Develop

```bash
pnpm typecheck    # strict TS across the workspace
pnpm test         # vitest across the workspace
cd python/suna_mpl && uv run pytest   # python companion tests
```

Design decisions live in `docs/design/architecture.md`; the formatter and
canvas requirements are derived from published Nature-family papers in
`docs/design/reference-analysis.md`.
