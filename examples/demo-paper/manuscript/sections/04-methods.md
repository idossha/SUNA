All figures are produced with matplotlib [@hunter2007] through the
`suna_mpl` companion package, which assigns stable SVG element ids,
applies the journal's figure style rules (font sizes, line weights, the
Wong colorblind-safe palette), and exports text as editable text. Exports
are byte-deterministic, and each `figure.svg` is written together with a
`figure.svg.suna.json` manifest that maps data coordinates to SVG
coordinates for the SUNA canvas.

**Spectral fitting.** The demo spectrum in `data/spectrum.csv` is fit by
`analysis/fit_spectrum.py` with a single Gaussian plus flat continuum —
a four-parameter Gauss–Newton least-squares loop in plain NumPy rather
than a full fitting framework such as LMFIT [@newville2014lmfit]; for a
real reduction one would reach for the astropy modelling stack
[@astropy2022; @demo2026]. The script writes the best-fit centroid,
$\sigma$, and amplitude to `results/spectrum_fit.json`; the values quoted
in Results are read from that file, and the same model is drawn as the
solid curve in @fig:fig-spectrum{a}.

**Stripping model.** The stripping radius in the Results table is computed
by `code/stripping_model.py`, which evaluates the Gunn & Gott criterion
(@eq:stripping) [@gunn1972] in closed form for a double-exponential disk,
using the restoring-force formalism of ch. 8 of [@binney2008].

**Velocity field.** The moment-1 map in `data/velocity_map.csv` is a
rotating-disk toy model with a seeded asymmetry; see
`figures/fig-velocity-map/source/plot.py`.

To regenerate the analysis products and every figure from the project
root:

```bash
uv run --project ../../python/suna_mpl python analysis/fit_spectrum.py
uv run --project ../../python/suna_mpl python figures/fig-spectrum/source/plot.py
uv run --project ../../python/suna_mpl python figures/fig-velocity-map/source/plot.py
```
