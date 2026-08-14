"""Generate figures/fig-velocity-map/figure.svg. Run from the project root:

    uv run --project ../../python/suna_mpl python figures/fig-velocity-map/source/plot.py
"""

import csv
import os

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np

import suna_mpl

OUT = os.environ.get("SUNA_FIGURE_OUT", "figures/fig-velocity-map/figure.svg")


def main() -> None:
    with open("data/velocity_map.csv") as f:
        grid = np.array([[float(v) for v in row] for row in csv.reader(f)])

    half = grid.shape[0] // 2
    extent = (-half * 0.5, half * 0.5, -half * 0.5, half * 0.5)

    with plt.rc_context(suna_mpl.journal_rc()):
        fig, ax = plt.subplots()
        suna_mpl.set_size(fig, "single", height_mm=70.0)

        im = ax.imshow(grid, origin="lower", cmap="RdBu_r", extent=extent,
                       vmin=-160, vmax=160, rasterized=True)
        ax.set_xlabel("offset (kpc)")
        ax.set_ylabel("offset (kpc)")
        cbar = fig.colorbar(im, ax=ax, shrink=0.9)
        cbar.set_label(r"$v_\mathrm{LOS}$ (km s$^{-1}$)")

        fig.tight_layout()
        suna_mpl.save_svg(fig, OUT)
        print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
