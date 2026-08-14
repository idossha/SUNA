"""Fit the demo H-alpha spectrum and write the result to results/.

Model: single Gaussian on a flat continuum,

    f(w) = A * exp(-(w - mu)^2 / (2 sigma^2)) + c

fit to data/spectrum.csv by Gauss-Newton least squares in plain NumPy (no
fitting framework needed for a four-parameter model). The best-fit
parameters are written to results/spectrum_fit.json; those are the values
quoted in the manuscript's Results section and shown as the model curve in
figures/fig-spectrum.

Run from the project root (examples/demo-paper/):

    uv run --project ../../python/suna_mpl python analysis/fit_spectrum.py

The fit is deterministic: same input CSV, same output JSON.
"""

import csv
import json
import os

import numpy as np

INPUT = "data/spectrum.csv"
OUTPUT = "results/spectrum_fit.json"
MAX_ITER = 60
TOL = 1e-12


def read_spectrum(path):
    with open(path) as f:
        rows = list(csv.DictReader(f))
    wave = np.array([float(r["wavelength_A"]) for r in rows])
    flux = np.array([float(r["flux_norm"]) for r in rows])
    return wave, flux


def initial_guess(wave, flux):
    """Moment-based starting point: continuum from the spectrum edges,
    centroid and width from the continuum-subtracted flux."""
    edge = np.concatenate([flux[:15], flux[-15:]])
    c0 = float(np.median(edge))
    resid = np.clip(flux - c0, 0.0, None)
    total = resid.sum()
    mu0 = float((wave * resid).sum() / total)
    sigma0 = float(np.sqrt(((wave - mu0) ** 2 * resid).sum() / total))
    a0 = float(flux.max() - c0)
    return np.array([a0, mu0, sigma0, c0])


def gauss_newton(wave, flux, p):
    """Minimize sum((model - flux)^2) over p = [A, mu, sigma, c]."""
    prev = np.inf
    for _ in range(MAX_ITER):
        a, mu, sigma, c = p
        z = (wave - mu) / sigma
        g = np.exp(-0.5 * z**2)
        model = a * g + c
        r = model - flux
        sse = float(r @ r)
        if abs(prev - sse) < TOL * max(prev, 1.0):
            break
        prev = sse
        jac = np.column_stack(
            [g, a * g * z / sigma, a * g * z**2 / sigma, np.ones_like(wave)]
        )
        step, *_ = np.linalg.lstsq(jac, -r, rcond=None)
        p = p + step
    return p


def main() -> None:
    wave, flux = read_spectrum(INPUT)
    p = gauss_newton(wave, flux, initial_guess(wave, flux))
    a, mu, sigma, c = (float(v) for v in p)
    sigma = abs(sigma)
    z = (wave - mu) / sigma
    rms = float(np.sqrt(np.mean((a * np.exp(-0.5 * z**2) + c - flux) ** 2)))

    result = {
        "script": "analysis/fit_spectrum.py",
        "input": INPUT,
        "model": "gaussian + flat continuum",
        "nPoints": int(wave.size),
        "centroid_A": round(mu, 4),
        "sigma_A": round(sigma, 4),
        "fwhm_A": round(2.0 * np.sqrt(2.0 * np.log(2.0)) * sigma, 4),
        "amplitude": round(a, 4),
        "continuum": round(c, 4),
        "rmsResidual": round(rms, 5),
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(f"wrote {OUTPUT}: centroid {result['centroid_A']} A, "
          f"sigma {result['sigma_A']} A, amplitude {result['amplitude']}")


if __name__ == "__main__":
    main()
