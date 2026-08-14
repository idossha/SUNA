"""Generate figures/fig-spectrum/figure.svg. Run from the project root:

    uv run --project ../../python/suna_mpl python figures/fig-spectrum/source/plot.py
"""

import csv
import os

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np

import suna_mpl

OUT = os.environ.get("SUNA_FIGURE_OUT", "figures/fig-spectrum/figure.svg")


def read_csv(path, *cols):
    with open(path) as f:
        rows = list(csv.DictReader(f))
    return [np.array([float(r[c]) for r in rows]) for c in cols]


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
        ax_a.set_title("a", loc="left", fontweight="bold")
        ax_a.legend()

        ax_b.errorbar(mass, sfr, yerr=sfr_err, fmt="o", ms=2.5, lw=0.5,
                      label="cluster members")
        ax_b.axhline(1.0, ls="--", lw=0.7, color=suna_mpl.WONG_PALETTE[7],
                     label="quenching threshold")
        ax_b.set_xscale("log")
        ax_b.set_yscale("log")
        ax_b.set_xlabel(r"$M_\ast$ ($M_\odot$)")
        ax_b.set_ylabel(r"SFR ($M_\odot\,\mathrm{yr}^{-1}$)")
        ax_b.set_title("b", loc="left", fontweight="bold")
        ax_b.legend()

        fig.tight_layout()
        suna_mpl.save_svg(fig, OUT)
        print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
