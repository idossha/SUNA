# results/

Machine-generated analysis products. Nothing in this directory is edited by hand — every file is written by a script in `analysis/`, and can be regenerated at any time from the raw inputs in `data/`.

## Files

- `spectrum_fit.json` — best-fit parameters of a Gaussian-plus-flat-continuum model of the demo H-alpha spectrum (centroid, sigma, FWHM, amplitude, continuum level, residual RMS). Produced by `analysis/fit_spectrum.py` from `data/spectrum.csv`. These are the values quoted in the manuscript's Results section; the same model is drawn as the solid curve in `figures/fig-spectrum` panel a.

## Provenance and regeneration

Each JSON product records its own provenance (`script`, `input`, `model` keys). To regenerate, run from the project root (`examples/demo-paper/`):

```bash
uv run --project ../../python/suna_mpl python analysis/fit_spectrum.py
```

The fit is deterministic — same input CSV, same output JSON — so a clean regeneration should produce a byte-identical file.
