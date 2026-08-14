# SUNA — status & roadmap

Living status of what is built, verified, and outstanding. Verified means
tested by unit suites AND driven in the real app by `pnpm smoke` (CDP) or a
recorded manual check.

## Built & verified

| Area | State |
|---|---|
| Shell | VS Code-like: activity bar, resizable sidebar (persisted), dockview tabs, status bar, terminal panel |
| Project | Scaffold + git init; "Open example" copies the demo to userData and git-inits it |
| Manuscript editing | SciMark (math, citations, cross-refs, figure embeds, raw LaTeX); Source ↔ Reading modes, Reading = editable live preview with cursor-reveal |
| Manuscript document | Combined tab: title page (authors/affiliations/abstract/significance/highlights), per-section editors, references page numbered by first appearance per profile; scroll-spy outline with word counts |
| Figure canvas | SVG-DOM engine (byte-identical round-trip, inverse-op undo), full editing suite (tools, handles, snapping, layers, properties), compliance chip |
| Journal profiles | 4 profiles from official author guidelines with source URLs + provenance tags; figure & manuscript compliance checkers |
| References | Bib list, live per-journal rendering ("Rendered as"), Cited/Uncited filter, missing-entry warnings |
| Source control | Status, diffs, commit, history, init |
| Terminal | node-pty + xterm panel, multiple tabs, env activation |
| Environments | uv/.venv/conda detection, per-project selection |
| Settings | App-wide settings tab persisted to userData |
| AI | Provider adapters (Anthropic/OpenAI/Ollama) + API-key chat; MCP server exposing manuscript verbs; "Open Claude Code here" launches a subscription-billed CLI wired to it |
| Python | suna_mpl: semantic gids, journal presets, deterministic SVG, anchor manifests, auto-rasterization |

## In progress

- Editor batch: reading-default, content-width fix, table rendering, vim
  motions, .bib language support, CSV/TSV data grid.

## Outstanding (next milestones)

1. **Submission export** — manuscript → LaTeX → PDF via bundled Tectonic,
   plus DOCX. Figure numbers/captions/refs baked to literal text before the
   renderer (flux's lesson); export dialog runs the compliance checker first.
2. **Provenance loop** — record canvas edits as replayable overlay ops in
   figure.json, replay on regeneration, "absorb" into the generating script
   as a reviewable diff (spec: provenance-loop.md).
3. **Manuscript-side compliance UI** — surface word/section/availability
   diagnostics (engine already implemented) in the manuscript view.
4. **Agent depth** — live bridge so an agent can drive the canvas command
   bus and editor with undoable, human-equivalent edits; figure screenshots
   for vision models.
5. **Packaging** — signed macOS build, bundled Tectonic + MCP server in
   resources.

## Known rough edges

- Manuscript sidebar summary shows raw `$…$` in the title (the title page
  itself renders it).
- Layers panel lists matplotlib's metadata/RDF nodes unfiltered.
- Canvas align/distribute exist in the engine but have no UI buttons.
- Agent chat has no streaming or tool use yet (single-turn text).
