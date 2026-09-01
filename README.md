# SUNA

An academic writing platform: a VS Code-like desktop workspace for human–AI
co-writing of research papers, with live Markdown/LaTeX rendering, a
Figma-like SVG figure canvas whose edits sync back to the generating code,
publisher-aware output formatting, reference management, and git built in.

**Format doctrine:** JSON, Markdown, BibTeX, SVG, and LaTeX are the only
sources of truth. PDF/DOCX are produced at export time only.

## Download

SUNA supports macOS and Linux. Windows is not supported.

Installers for macOS and Linux are attached to every
[release](https://github.com/idossha/SUNA/releases). Take the file for your
machine:

| Your machine | The file |
|---|---|
| Mac, Apple silicon | `SUNA-<version>-mac-arm64.dmg` |
| Mac, Intel | `SUNA-<version>-mac-x64.dmg` |
| Debian / Ubuntu | `SUNA-<version>-linux-amd64.deb` |
| Other Linux | `SUNA-<version>-linux-x86_64.AppImage` |

**macOS** — open the `.dmg`, drag SUNA to Applications, double-click it. The
macOS builds are signed with an Apple Developer ID and notarized by Apple, so
there is no `xattr` step and no right-click → Open.

**Linux** — `sudo apt install ./SUNA-<version>-linux-amd64.deb`, or `chmod +x`
the AppImage and run it.

Full instructions, including what to do if something goes wrong, are in
[the guide](https://idossha.github.io/SUNA/guide/install).

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
| `packages/formatter` | Publisher profile loader + compliance checkers |
| `packages/canvas` | SVG-DOM-native figure editor |
| `packages/bib` | BibTeX parsing, citation numbering, reference formatting |
| `packages/agent` | Provider-agnostic AI layer (Anthropic, OpenAI, Ollama) |
| `packages/provenance` | Figure ↔ generating-code sync (overlay model) |
| `python/suna_mpl` | Matplotlib companion: stable SVG ids, journal mm presets |
| `docs` | The contract (`ARCHITECTURE.md`), the decision log, and the operational references |
| `website` | The user-facing documentation site (VitePress) |

## Develop

```bash
pnpm typecheck    # strict TS across the workspace
pnpm test         # vitest across the workspace
pnpm smoke        # end-to-end app smoke test (drives the UI over CDP)
cd python/suna_mpl && uv run pytest   # python companion tests
pnpm package:mac  # build downloadable DMGs into release/
```

CI runs the typecheck and tests on Linux and macOS for every pull
request, and additionally packages the app on macOS and launches the real
bundle — the packaged layout is the one thing `pnpm dev` can never exercise.

`pnpm smoke` walkthrough details and the human testing script live in
[docs/TESTING.md](docs/TESTING.md). What goes inside the bundle is
[docs/PACKAGING.md](docs/PACKAGING.md); cutting a release, and the macOS
signing and notarization rules, are [docs/RELEASING.md](docs/RELEASING.md).

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

The contract is `docs/ARCHITECTURE.md` and the decisions behind it are in
`docs/DECISIONS.md`. The figure-capability measurements taken from published
Nature-family papers are summarised in `docs/ARCHITECTURE.md` §20.9, and the
research behind the publisher profiles lives in `resources/profiles/sources/`.
