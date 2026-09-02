# SUNA

An academic writing platform: a desktop workspace for human–AI co-writing of
research papers — live Markdown rendering, an SVG figure canvas, reference
management, journal-compliance checks, publisher-ready export, and git built
in.

**Format doctrine:** JSON, Markdown, BibTeX, SVG and LaTeX are the only sources
of truth. PDF and DOCX are produced at export time only.

## Two audiences, two documents

|  | Start here |
| --- | --- |
| **Using SUNA** | [the documentation site](https://idossha.github.io/SUNA/) — install, quickstart, and every feature |
| **Working on SUNA** | [`AGENTS.md`](AGENTS.md) — commands, the rules that are not negotiable, and where each document lives |

Nothing is written twice. The site is for people who use SUNA; `docs/` is for
people who change it, and the site's Developers section is generated from those
same files by `website/scripts/sync-docs.mjs`.

## Download

macOS and Linux; Windows is not supported. Installers are attached to every
[release](https://github.com/idossha/SUNA/releases), and an installed copy
updates itself. The
[install page](https://idossha.github.io/SUNA/guide/install) says which file to
take and what to do with it.

## Run from source

```bash
pnpm install
pnpm dev
```

## Layout

| Path | What |
| --- | --- |
| `apps/desktop` | Electron shell (main / preload / renderer) |
| `packages/core` | Schemas: project, manuscript, figure, publisher profile, IPC contracts |
| `packages/markdown` | SciMark — the manuscript Markdown dialect (math, citations, cross-refs) |
| `packages/formatter` | Publisher profile loader + compliance checkers |
| `packages/canvas` | SVG-DOM-native figure editor |
| `packages/bib` | BibTeX parsing, citation numbering, reference formatting |
| `packages/agent` | Provider-agnostic AI layer and the MCP server |
| `packages/provenance` | Figure ↔ generating-code sync (designed, not built) |
| `python/suna_mpl` | Matplotlib companion: stable SVG ids, journal mm presets |
| `docs` | The contract, the decision log, and the operational references |
| `website` | The documentation site (VitePress) |

## Licence

See [LICENSE](LICENSE).
