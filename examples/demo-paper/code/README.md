# code/

Reusable analysis code for the demo project — the model layer, as opposed to the one-shot pipeline scripts in `analysis/` and the figure scripts in `figures/*/source/`.

## Modules

- `stripping_model.py` — the Gunn & Gott (1972) ram-pressure stripping criterion for a double-exponential disk. Exposes `ram_pressure()`, `restoring_pressure()`, and `stripping_radius_kpc()`; the module defaults describe the demo galaxy and reproduce the stripping radius quoted in the Results table of the manuscript (8.4 kpc).

## Running

From the project root (`examples/demo-paper/`):

```bash
uv run --project ../../python/suna_mpl python code/stripping_model.py
```

prints the input parameters and the derived stripping radius as JSON. The module has no dependencies beyond the Python standard library, so any Python >= 3.10 works; `uv run` is used only for consistency with the rest of the project.
