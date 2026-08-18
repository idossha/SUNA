# Figures from code

How a matplotlib figure becomes a SUNA figure that stays editable on the canvas — what `suna_mpl` does to the SVG, how you run it, and exactly what happens (and does not happen) when you edit the result by hand.

A SUNA figure is a directory, not a file. Under `figures/<id>/` you get:

| File | What it is |
| --- | --- |
| `figure.svg` | The editable document. The canvas edits this SVG DOM directly. |
| `figure.json` | Caption, namespace, width preset, panel letters, `provenance` |
| `figure.svg.suna.json` | Coordinate manifest written by `suna_mpl` |
| `source/plot.py` | The script that generated `figure.svg` |

A figure drawn from scratch on the canvas has `provenance: null` and no `source/`. A figure that came from code has the script sitting beside it, in the project, versioned with everything else.

## What suna_mpl does

`suna_mpl` is a small matplotlib companion that lives in the repo at `python/suna_mpl`. It does not draw anything for you. It changes four things about the SVG matplotlib writes, so that the SVG is worth opening in an editor.

**Stable semantic ids.** Plain matplotlib SVG names elements `patch_2`, `line2d_7` — names that change when you add a series. `suna_mpl.autogid(fig)` (run automatically by `save_svg`) assigns deterministic ids instead: `suptitle`, `ax0`, `ax0.title`, `ax0.xlabel`, `ax0.ylabel`, `ax0.legend`, and per-artist ids taken from the label you already pass, like `ax0.line.halpha`. An artist with no public label falls back to `line0` / `coll0`; duplicates get a `-2`, `-3` suffix; an id you set yourself is never overwritten.

Those ids are what make the canvas usable. Clicking on the plot resolves to the nearest ancestor with a semantic id, so you select `ax0.legend` or `ax0` rather than an anonymous path deep in matplotlib's output. They also survive regeneration, which is the whole point.

**Editable text.** `journal_rc()` sets `svg.fonttype: none`, so glyphs stay real `<text>` elements instead of being converted to outlines. You can double-click an axis label on the canvas and retype it. Without this setting a figure is a picture of text and nothing can touch it.

**Journal sizes in millimetres.** `set_size(fig, "double")` sizes the figure to a column width, not to inches you guessed.

| Profile | `single` | `onehalf` | `double` |
| --- | --- | --- | --- |
| `nature` | 88 mm | 136 mm | 180 mm |
| `science` | 90 mm | 138 mm | 183 mm |
| `mnras` | 80 mm | 120 mm | 168 mm |

You can also pass a literal number of millimetres. Height defaults to `ratio=0.618` of the width, or pass `height_mm=`. An unknown preset or profile raises `ValueError` naming the valid options.

**Byte-reproducible export.** `save_svg` pins matplotlib's `svg.hashsalt` and strips the creation date, so rerunning the same script produces the same bytes. A figure that only changes when the data changes is a figure your version control can tell you something about.

Two further behaviours worth knowing: `save_svg` writes the `figure.svg.suna.json` manifest sidecar, and it auto-rasterizes any line or collection with more than 800 primitives, so a dense scatter exports as one embedded image while axes, ticks and text stay vector. Each behaviour has an off switch: `autogid=False`, `editable_text=False`, `deterministic=False`, `manifest=False`, `rasterize_threshold=None`.

::: info The style presets are narrower than the app's
`journal_rc()` accepts one profile name only — `nature`. Any other name raises `ValueError`. `set_size()` knows three (`nature`, `science`, `mnras`). The app itself ships 13 profiles. If you write for a journal the Python side does not know, set the rcParams yourself and pass `set_size` a literal millimetre width; the [journal profile](/publishing/profiles) in SUNA still checks and exports at the right size.
:::

## Installing and running it

`suna_mpl` needs Python ≥ 3.10 and matplotlib ≥ 3.8. It is not on PyPI — you run your figure scripts *through* its environment with [uv](https://docs.astral.sh/uv/), from the project root:

```bash
uv run --project ../../python/suna_mpl python figures/fig-spectrum/source/plot.py
```

Adjust the `--project` path to wherever the SUNA repo sits relative to your project. To run the package's own tests:

```bash
cd python/suna_mpl && uv run pytest
```

## A real script

This is `figures/fig-spectrum/source/plot.py` from the bundled demo paper — a two-panel figure at double-column width, 58 mm tall. The listing is abridged: its `read_csv` helper and the second panel are left out to keep the `suna_mpl` calls visible.

```python
import os

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import suna_mpl

OUT = os.environ.get("SUNA_FIGURE_OUT", "figures/fig-spectrum/figure.svg")


def main() -> None:
    wave, flux = read_csv("data/spectrum.csv", "wavelength_A", "flux_norm")
    mass, sfr, sfr_err = read_csv("data/members.csv", "mass_msun", "sfr_msun_yr", "sfr_err")
    model = np.exp(-0.5 * ((wave - 6563.2) / 6.1) ** 2)

    with plt.rc_context(suna_mpl.journal_rc()):
        fig, (ax_a, ax_b) = plt.subplots(1, 2)
        suna_mpl.set_size(fig, "double", height_mm=58.0)

        ax_a.step(wave, flux, where="mid", lw=0.8, label="observed")
        ax_a.plot(wave, model, lw=1.0, label="model fit")
        ax_a.set_xlabel(r"wavelength ($\mathrm{\AA}$)")
        ax_a.set_ylabel("normalized flux")
        ax_a.legend()

        ax_b.errorbar(mass, sfr, yerr=sfr_err, fmt="o", ms=2.5, lw=0.5,
                      label="cluster members")
        ax_b.axhline(1.0, ls="--", lw=0.7, color=suna_mpl.WONG_PALETTE[7],
                     label="quenching threshold")
        ax_b.set_xscale("log")
        ax_b.set_yscale("log")
        ax_b.legend()

        fig.tight_layout()
        suna_mpl.save_svg(fig, OUT)
```

Three lines carry the weight. `plt.rc_context(suna_mpl.journal_rc())` applies the journal rcParams — 7 pt body text, 6 pt ticks and legends, 0.5 pt axes lines, 1.0 pt data lines, no legend frame, and the Wong colorblind-safe cycle. `suna_mpl.set_size` fixes the physical size. `suna_mpl.save_svg` does the ids, the editable text, the determinism and the sidecar.

`label=` is not decoration. It becomes the SVG id: `label="observed"` gives you `ax0.line.observed` in the Layers tree. Label your artists as if someone will have to find them later, because they will.

`suna_mpl.WONG_PALETTE` is the 8-colour Wong (2011) set — `#0072b2`, `#d55e00`, `#009e73`, `#cc79a7`, `#e69f00`, `#56b4e9`, `#f0e442`, `#000000` — and it is the default cycle under `journal_rc()`, so reach into it directly only when you need a specific colour for a specific element.

::: tip SUNA_FIGURE_OUT
The demo scripts read the output path from an environment variable: `OUT = os.environ.get("SUNA_FIGURE_OUT", "figures/fig-spectrum/figure.svg")`. That is a convention of the example scripts, not something `suna_mpl` implements — the library never reads that variable. Copy the pattern if you like it; nothing in the app sets it for you.
:::

## Opening it on the canvas

The script writes `figures/<id>/figure.svg` directly, so the figure is already a managed figure: open it from the **Figures** view and the canvas edits that SVG DOM in place — no import conversion, no second copy of the document.

Do **not** reach for <kbd>⌘⇧I</kbd> here. Importing is for an SVG that is not already a managed figure, and it wraps what it brings in, prefixing every id inside. That namespacing destroys the `ax0` / `ax0.legend` id shapes the next section depends on.

<figure class="shot">
  <img src="/shots/canvas.webp" alt="The SUNA figure canvas: a vertical tool rail on the left, a LAYERS tree listing SVG elements by id, a two-panel scientific figure on a millimetre artboard in the centre, and a PROPERTIES rail on the right with Align, Figure, Palette, Agent and Export sections." />
  <figcaption>The Layers tree is reading the ids <code>suna_mpl</code> wrote. Selecting <code>ax0.legend</code> instead of an anonymous path is what those ids buy you.</figcaption>
</figure>

The `ax0`, `ax1` naming has one more payoff: **Auto-letter panels (a, b, c)** in the Figure section finds every element whose id matches `ax0`, `ax1`, …, orders them in reading order, and places a panel letter above each one's top-left corner, styled per the journal profile. It only works on ids in that exact form, which is what `autogid` produces. See [the canvas](/figures/canvas) for the rest of the editing surface, and [export](/publishing/export) for getting the figure out at journal width and dpi.

## The manifest sidecar

`save_svg` writes `figure.svg.suna.json` next to the SVG. It records the SVG's SHA-256, the artboard size in millimetres, a `generator` block naming the script and the matplotlib version, and — per axes — the x/y scale plus two anchor pairs mapping data values to SVG user-unit coordinates, so a point on the canvas can in principle be read back as a data value.

`suna_mpl.verify_manifest(svg_path)` returns `True` only when the sidecar exists, parses, and its stored hash still matches the SVG's bytes. That is how you detect an SVG that has drifted from its manifest — for example, one you have since edited on the canvas.

::: warning Nothing reads it yet
The sidecar is written correctly and the coordinate mapping in it is real. No code in the SUNA app reads it. Treat it today as a record for your own scripts, not as something the canvas uses.
:::

## Regenerating when the analysis changes

The analysis moves, the figure has to follow. Today that is a terminal action you perform:

```bash
uv run --project ../../python/suna_mpl python figures/fig-spectrum/source/plot.py
```

There is no "Run script" or "Regenerate figure" button in the app. The script writes `figure.svg` wholesale, overwriting whatever was there. If the figure tab is open with unsaved changes, save or undo them first.

::: danger Regenerating discards canvas edits
Rerunning `plot.py` overwrites `figure.svg` completely. Any edit you made on the canvas since the last run — a moved legend, a retyped label, a recoloured line, an auto-lettered panel — is gone. Nothing in the app warns you before this happens, because the app is not involved.

The working discipline that follows: put everything you can into the script, and treat canvas edits as the final layer applied after the last regeneration.
:::

Because the export is byte-reproducible, a regeneration that changes nothing changes no bytes. `git diff` after a rerun tells you truthfully whether the figure actually moved.

## The provenance loop

::: warning Not built yet
Canvas edits do **not** flow back into your Python. This is the one thing on this page most worth being clear about, because the design documents describe the loop in enough detail that it reads as shipped.

What the specs describe: canvas edits recorded as overlay operations in `figure.json`, replayed onto a freshly regenerated base SVG, and eventually absorbed into `source/plot.py` as a reviewable diff. The schema for those overlay ops is in the codebase — `set-style`, `set-text`, `set-attr`, `translate`, `scale`, `delete`, `reorder`, `insert`, all defined and validated.

What happens today: nothing writes them and nothing replays them. The `@suna/provenance` package is an empty placeholder — it appears in the dependency listing and contains no implementation. The roadmap still lists the provenance loop as outstanding.

So when you move a legend on the canvas and press <kbd>⌘S</kbd>, the change is written to `figure.svg` and to nowhere else. `figure.json`'s `provenance.overlay` array stays `[]`. `source/plot.py` is untouched and does not know. The next time you run the script, your edit is overwritten.
:::

Until the loop exists, the two sane workflows are:

| If the change belongs to… | Do this |
| --- | --- |
| the data, the model, the axes, anything you would want reproducible | Edit `source/plot.py` and rerun it |
| layout, annotation, panel letters, a one-off nudge for the final proof | Edit on the canvas, and expect to redo it after any regeneration |

The [in-app agent](/ai/in-app) sits on the second side of that line: the Agent section in the Properties rail edits `figure.svg` in place and is explicitly told never to regenerate the figure from `source/plot.py`. Ask an agent to change the science, and it should be changing the script — then you rerun it yourself.
