# SUNA

An academic writing platform: a VS Code-like desktop workspace for human–AI
co-writing of research papers, with live Markdown/LaTeX rendering, a
Figma-like SVG figure canvas whose edits sync back to the generating code,
publisher-aware output formatting, reference management, and git built in.

**Format doctrine:** JSON, Markdown, BibTeX, SVG, and LaTeX are the only
sources of truth. PDF/DOCX are produced at export time only.

## Download

Installers for macOS, Windows and Linux are attached to every
[release](https://github.com/idossha/SUNA/releases). Grab the DMG matching
your Mac (`arm64` for Apple silicon, `x64` for Intel), the `.exe` on Windows,
or the AppImage/deb on Linux.

Builds are not signed with an Apple Developer certificate yet, so macOS blocks
the first launch. Right-click the app → **Open**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/SUNA.app
```

## Run from source

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
| `website` | The user-facing documentation site (VitePress) |

## Develop

```bash
pnpm typecheck    # strict TS across the workspace
pnpm test         # vitest across the workspace
pnpm smoke        # end-to-end app smoke test (drives the UI over CDP)
cd python/suna_mpl && uv run pytest   # python companion tests
pnpm package:mac  # build downloadable DMGs into release/ (see docs/packaging.md)
```

`pnpm smoke` walkthrough details and the human testing script live in
[TESTING.md](TESTING.md).

## Documentation site

User-facing documentation lives in [`website/`](website/README.md) and is built
with VitePress.

```bash
pnpm docs:dev       # http://localhost:5173
pnpm docs:build     # static build; fails on a dead internal link
pnpm docs:shots     # regenerate every screenshot from the running app
```

Every screenshot on the site is captured from a hidden SUNA driving
`examples/hello-suna`, so the docs can be re-rendered whenever the UI moves.

Design decisions live in `docs/design/architecture.md`; the formatter and
canvas requirements are derived from published Nature-family papers in
`docs/design/reference-analysis.md`.
