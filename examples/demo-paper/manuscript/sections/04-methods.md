All figures are produced with matplotlib [@hunter2007] through the
`suna_mpl` companion package, which assigns stable SVG element ids,
applies the journal's figure style rules (font sizes, line weights, the
Wong colorblind-safe palette), and exports text as editable text.

**Spectral fitting.** The demo spectrum in `data/spectrum.csv` is fit with
a single Gaussian plus flat continuum; see
`figures/fig-spectrum/source/plot.py` [@astropy2022; @demo2026].

**Velocity field.** The moment-1 map in `data/velocity_map.csv` is a
rotating-disk toy model with a seeded asymmetry; see
`figures/fig-velocity-map/source/plot.py`.

To regenerate every figure from the project root:

```bash
uv run --project ../../python/suna_mpl python figures/fig-spectrum/source/plot.py
uv run --project ../../python/suna_mpl python figures/fig-velocity-map/source/plot.py
```
