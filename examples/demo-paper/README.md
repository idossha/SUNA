# demo-paper — the SUNA example project

A small but complete SUNA research project: a synthetic study of ram-pressure stripping in a $z = 1.7$ cluster, built so that **every workspace view has real content** and every artifact can be regenerated from the files beside it.

## What this project demonstrates

- **Manuscript as data** — `manuscript/` is flat and holds exactly four files: `manuscript.md` (the entire prose — sections are Markdown headings, and the introduction is deliberately unheaded), `manuscript.json` (journal-agnostic metadata, validated by `@suna/core`'s `ManuscriptSchema`), `authors.json` (byline + affiliations, `AuthorsFileSchema`) and `references.bib`. The outline is DERIVED from the Markdown, and numbering of figures, tables, equations, and references is never stored — only derived from order plus the active publisher profile (`suna.json` → `nature-astronomy`).
- **Reproducible figures** — each figure directory holds `figure.svg`, its `figure.json` document (caption, panels, provenance), and the generating script under `source/`. Exports via `suna_mpl` are byte-deterministic, carry stable element ids (`ax0.title.left`, `ax1.line.quenching-threshold`, ...) that the SUNA canvas addresses, and write a `figure.svg.suna.json` manifest mapping data coordinates to SVG coordinates.
- **A real analysis chain** — raw inputs in `data/` are processed by `analysis/fit_spectrum.py` into `results/spectrum_fit.json`; the values quoted in the manuscript's Results section come from that file. Reusable model code (the Gunn–Gott stripping radius) lives in `code/`.
- **Citations from BibTeX** — `manuscript/references.bib` mixes `@article`, `@book`, `@software`, and `@misc` entries, cited from the prose with `[@key]` syntax.

## Directory map

| Directory    | Contents |
| ------------ | -------- |
| `manuscript/` | `manuscript.md`, `manuscript.json`, `authors.json`, `references.bib` |
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

The project is agent-ready (adr-004): `AGENTS.md`/`CLAUDE.md` point coding agents at the machine context layer, `context/` holds the mission, notebook, and rules, and opening the project in SUNA writes a machine-local `.mcp.json` wiring its manuscript tools.
