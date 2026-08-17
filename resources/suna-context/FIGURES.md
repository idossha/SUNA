# FIGURES.md — figures for agents

Each figure is a directory under `figures/` (directory name from `suna.json`'s
`directories` record). Your surface over the figure itself (`figure.svg`) is
read-only; mutation happens in the app's canvas.

## Layout

```
figures/<figure-id>/
  figure.json            # metadata, incl. caption.title — the caption lives HERE,
                         #   not in the prose
  figure.svg             # the figure itself; app-owned (canvas document model)
  figure.svg.suna.json   # provenance sidecar
  source/plot.py         # the figure's source code (generating script)
```

Figure ids match `[A-Za-z][A-Za-z0-9_.-]*`.

## What you can do today

| verb | input | purpose |
|---|---|---|
| list_figures | `{}` | figure ids with caption titles |
| read_figure_svg | `{figureId}` | the figure's SVG source |
| check_figure_compliance | `{figureId}` | figure vs the active journal profile |

That is the whole verb surface: read-only. **Never hand-edit `figures/*/figure.svg`**
— editing it bypasses the app's undo history, id-minting, and provenance tracking. The
same applies when MCP is down and you fall back to file access (see MCP.md): read the
SVG freely, never write it.

## Changing a figure

Figure mutation goes through the app's canvas, not through you. To change a figure:

1. Edit the generating script — `figures/<id>/source/plot.py`, or the producing script
   under `code/` or `analysis/` — with your normal file tools.
2. Ask the user to regenerate and update the figure in the app — `figure.svg` changes
   only through the app's canvas, never through you.
3. If you cannot trace the figure to a script, or the change is a judgment call,
   propose it instead: `add_comment` anchored to the figure's embed or the prose
   discussing it, or an entry in `context/NOTEBOOK.md` (notebook discipline is in
   WORKFLOW.md). Destructive or ambiguous changes are proposed first, never done
   silently.

Record what you changed and why in `context/NOTEBOOK.md` as you go.

## Compliance loop

Profiles encode the journal's author guidelines for figures — fonts, line weights,
dimensions, palette — each rule tagged with its source URL; rules the journal does not
state are skipped. Compliance is advisory-only: it flags, it never rewrites.

1. `list_figures`, then `check_figure_compliance` per figure.
2. Read the findings: each states the measured value vs the journal's stated rule.
3. Fix in the source script where possible (font size, line width, output dimensions
   are usually one-line changes in `plot.py`), then ask the user to regenerate and
   update the figure in the app.
4. If a fix would change scientific content — or the figure has no script — report the
   finding to the user instead of forcing it.

`check_manuscript` separately verifies figure-reference integrity in the prose (every
`![[fig:id]]` and `@fig:id` resolves to a real figure).

## Embedding in prose

- Embed: `![[fig:overview]]` alone on its own paragraph. The figure and its caption
  render there; the caption text stays in `figure.json`.
- Reference: `@fig:overview`, panel `@fig:overview{a}`. Write cross-references, never
  literal "Figure 3" — numbering is derived at format time, never stored.

Full syntax in MANUSCRIPT.md.
