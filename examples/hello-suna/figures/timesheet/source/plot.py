"""Generate figures/timesheet/figure.svg. Run from the project root:

    uv run --project ../../python/suna_mpl python figures/timesheet/source/plot.py

Unlike Figure 1 — which was drawn by hand, as the referees noticed — this one
comes from code kept beside it, which is the arrangement the manuscript's
Methods section recommends. `suna_mpl.save_svg` keeps the text as real <text>
elements so the labels stay editable on the canvas, rasterizes the dense mesh
at 300 dpi rather than shipping 96 vector quads, and writes the
`figure.svg.suna.json` manifest the canvas uses to map data coordinates onto
SVG ones.
"""

import csv
import os
from collections import defaultdict

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np

import suna_mpl

OUT = os.environ.get("SUNA_FIGURE_OUT", "figures/timesheet/figure.svg")

CHORES = [
    "Relabeling figures",
    "Fixing references",
    "Reformatting files",
    "Note consolidation",
]


def read_grid() -> tuple[np.ndarray, np.ndarray]:
    cells: dict[str, dict[int, float]] = defaultdict(dict)
    with open("data/timesheet.csv") as f:
        for row in csv.DictReader(f):
            cells[row["chore"]][int(row["week"])] = float(row["hours"])
    weeks = np.array(sorted(next(iter(cells.values())).keys()), dtype=float)
    grid = np.array([[cells[c][int(w)] for w in weeks] for c in CHORES])
    return weeks, grid


def main() -> None:
    weeks, grid = read_grid()

    # SUNA style, not a journal's: 7 pt floor on text, 127 mm single column,
    # 600 dpi on anything rasterized. `journal_rc` only knows Nature, so the
    # house rules are set here from resources/profiles/suna.json and the
    # figure passes its own project's compliance check on the first open.
    rc = suna_mpl.journal_rc()
    rc.update({
        "font.size": 7.0,
        "axes.labelsize": 7.0,
        "xtick.labelsize": 7.0,
        "ytick.labelsize": 7.0,
        "legend.fontsize": 7.0,
        "savefig.dpi": 600,
    })
    with plt.rc_context(rc):
        fig, ax = plt.subplots()
        suna_mpl.set_size(fig, 127.0, height_mm=62.0)

        # imshow, not pcolormesh: a mesh ships one vector quad per cell, and
        # 96 of those is both a slow SVG and a compliance report as long as
        # your arm. `rasterized=True` collapses the whole grid to a single
        # 300 dpi <image> and leaves every label as editable text.
        im = ax.imshow(
            grid,
            aspect="auto",
            cmap="viridis",
            extent=(weeks[0] - 0.5, weeks[-1] + 0.5, len(CHORES) - 0.5, -0.5),
            interpolation="nearest",
            rasterized=True,
        )
        ax.axvline(12.5, color="#000000", lw=0.8, ls="--")

        ax.set_yticks(range(len(CHORES)))
        ax.set_yticklabels(CHORES)
        ax.set_xlabel("week")

        bar = fig.colorbar(im, ax=ax, pad=0.02)
        bar.set_label("hours per week")

        fig.tight_layout()

        suna_mpl.save_svg(fig, OUT)


if __name__ == "__main__":
    main()
