"""Generate a realistic two-panel figure as a canvas test fixture.

Run from python/suna_mpl:  uv run python examples/demo_two_panel.py <out.svg>
"""

import sys

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np

import suna_mpl

rng = np.random.default_rng(42)


def main(out: str) -> None:
    with plt.rc_context(suna_mpl.journal_rc()):
        fig, (ax_spec, ax_scatter) = plt.subplots(1, 2)
        suna_mpl.set_size(fig, "double", height_mm=60.0)

        # panel a: step spectrum with model overlay
        wavelength = np.linspace(6500, 6650, 120)
        flux = np.exp(-0.5 * ((wavelength - 6563) / 6.0) ** 2) + rng.normal(
            0, 0.05, wavelength.size
        )
        model = np.exp(-0.5 * ((wavelength - 6563) / 6.0) ** 2)
        ax_spec.step(wavelength, flux, where="mid", label="observed", lw=0.8)
        ax_spec.plot(wavelength, model, label="model fit", color="crimson")
        ax_spec.set_xlabel(r"wavelength ($\mathrm{\AA}$)")
        ax_spec.set_ylabel("normalized flux")
        ax_spec.set_title("a", loc="left", fontweight="bold")
        ax_spec.legend()

        # panel b: scatter with error bars and threshold line
        mass = 10 ** rng.uniform(9, 11.5, 40)
        sfr = 10 ** (np.log10(mass) - 10 + rng.normal(0, 0.3, 40))
        ax_scatter.errorbar(
            mass,
            sfr,
            yerr=sfr * 0.3,
            fmt="o",
            ms=2.5,
            lw=0.5,
            label="cluster members",
        )
        ax_scatter.axhline(1.0, ls="--", lw=0.7, color="gray", label="threshold")
        ax_scatter.set_xscale("log")
        ax_scatter.set_yscale("log")
        ax_scatter.set_xlabel(r"$M_\ast$ ($M_\odot$)")
        ax_scatter.set_ylabel(r"SFR ($M_\odot\,\mathrm{yr}^{-1}$)")
        ax_scatter.set_title("b", loc="left", fontweight="bold")
        ax_scatter.legend()

        fig.tight_layout()
        suna_mpl.save_svg(fig, out)
        print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "demo-two-panel.svg")
