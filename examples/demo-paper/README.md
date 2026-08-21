# demo-paper — the SUNA example project

A small but complete SUNA research project: a synthetic study of ram-pressure stripping in a $z = 1.7$ cluster, built so that **every workspace view has real content** and every artifact can be regenerated from the files beside it.

## What this project demonstrates

- **Manuscript as data** — `manuscript/` is flat and holds exactly four files: `manuscript.md` (the entire prose — sections are Markdown headings, and the introduction is deliberately unheaded), `manuscript.json` (journal-agnostic metadata, validated by `@suna/core`'s `ManuscriptSchema`), `authors.json` (byline + affiliations, `AuthorsFileSchema`) and `references.bib`. The outline is DERIVED from the Markdown, and numbering of figures, tables, equations, and references is never stored — only derived from order plus the active publisher profile (`suna.json` → `nature`).
- **Reproducible figures** — each figure directory holds `figure.svg`, its `figure.json` document (caption, panels, provenance), and the generating script under `source/`. Exports via `suna_mpl` are byte-deterministic, carry stable element ids (`ax0.title.left`, `ax1.line.quenching-threshold`, ...) that the SUNA canvas addresses, and write a `figure.svg.suna.json` manifest mapping data coordinates to SVG coordinates.
- **A real analysis chain** — raw inputs in `data/` are processed by `analysis/fit_spectrum.py` into `results/spectrum_fit.json`; the values quoted in the manuscript's Results section come from that file. Reusable model code (the Gunn–Gott stripping radius) lives in `code/`.
- **Citations from BibTeX** — `manuscript/references.bib` mixes `@article`, `@book`, `@software`, and `@misc` entries, cited from the prose with `[@key]` syntax.
- **A document set, not one manuscript** — `suna.json` declares a `documents` registry (adr-009): the manuscript, the supplement, two cover letters and a response to referees. Letters live under `manuscript/letters/` so they inherit the comment gutter, versions and the AI diff bar that the manuscript already has.
- **Letters that make checkable claims** — each letter is prose (`<id>.md`) plus a sidecar (`<id>.json`). Factual assertions — no dual publication, no competing interests, where the data live — are structured in the sidecar and placed in the prose with `::assert{id}`, so "no repository named" is a fact the checker reads rather than a sentence it guesses at. The confidential suggested/excluded-reviewer list (`<id>.private.json`) is gitignored by design and is therefore **not** shipped in this example.
- **A peer-review ledger** — `rounds/` records what happened to the paper: an internal circulation to co-authors, then a Nature round that came back `major-revision`. The referees' words live in `rounds/r2-nature/reviewers/*.json`, segmented into 14 points by the offline importer, each one a byte-exact contiguous slice of the retained source. Nothing in the app offers an edit control for them.

## Directory map

| Directory    | Contents |
| ------------ | -------- |
| `manuscript/` | `manuscript.md`, `manuscript.json`, `authors.json`, `references.bib`, `supplementary.md`, `response-r2.md`, `letters/` |
| `rounds/`     | the peer-review ledger: one directory per round (`round.json`, `reviewers/*.json`, `editor-letter.txt`) |
| `figures/`    | one directory per figure: `figure.svg` + `figure.json` + `figure.svg.suna.json` + `source/plot.py` |
| `data/`       | raw demo inputs (`spectrum.csv`, `members.csv`, `velocity_map.csv`) |
| `analysis/`   | pipeline scripts that turn `data/` into `results/` |
| `results/`    | machine-written analysis products (never hand-edited) |
| `code/`       | reusable model code imported/run by the analysis |
| `output/`     | formatted exports land here (generated; empty in the repo) |

## Regenerating everything

All commands run from this directory (`examples/demo-paper/`) and use the `suna_mpl` environment via [uv](https://docs.astral.sh/uv/):

```bash
# 1. analysis products (results/spectrum_fit.json)
uv run --project ../../python/suna_mpl python analysis/fit_spectrum.py

# 2. figures (deterministic SVG + .suna.json manifest sidecars)
uv run --project ../../python/suna_mpl python figures/fig-spectrum/source/plot.py
uv run --project ../../python/suna_mpl python figures/fig-velocity-map/source/plot.py

# 3. the stripping radius quoted in the Results table
uv run --project ../../python/suna_mpl python code/stripping_model.py
```

Every step is deterministic: rerunning it reproduces the committed files byte for byte.

## The review round, and what it is showing you

`rounds/r2-nature/` is a returned external round with a `major-revision` decision. Its `round.json` holds the **mutable half** — one `pointStates` entry per referee point, with the author's status, assignee, reply and links back into the manuscript. The **immutable half** is `reviewers/1.json` and `reviewers/2.json`, which retain the full decision letter as `sourceText` and cut it into points by offset.

Three things in there are deliberate and are not defects:

- **Referee 1's point 4 is `rebutted`, not `done`.** Disagreeing with a referee is a first-class outcome; a tool that models only compliance quietly pressures authors into conceding points they should defend. The response document argues the point rather than caving.
- **Two points are `drafted`.** A half-written response is the normal state to be in, right up until you send it.
- **Referee 2's point 3 (`r2.4`) is `unaddressed` and is answered nowhere in `response-r2.md`.** This makes the response checker report `response.point-unaddressed` by name the moment you open the round — which is the whole reason the check exists. Answer it and the diagnostic goes away.

`manuscript/response-r2.md` names each point it answers with `@point:r1.2`, so the completeness check can tell a reply that exists from a number that was typed by hand.

The project is agent-ready (adr-004): `AGENTS.md`/`CLAUDE.md` point coding agents at the machine context layer, `context/` holds the project brief, memory, and rules, and opening the project in SUNA writes a machine-local `.mcp.json` wiring its manuscript tools.
