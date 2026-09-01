"""Turn data/happiness.csv into results/happiness_fit.json.

Run from the project root:

    uv run --no-project --with "${SUNA_MPL:-../../python/suna_mpl}" python analysis/fit_happiness.py

(This script needs only numpy, but it borrows `suna_mpl`'s environment so that
one command runs everything in the project. `$SUNA_MPL` is exported by SUNA's
terminal panel and points at the copy of `suna_mpl` that ships with the app,
wherever it is installed; the `:-` fallback covers a source checkout. `uv`
itself has to be on your PATH.)

Deterministic: rerunning it reproduces the committed results file byte for
byte. The numbers quoted in the manuscript's Results come from here rather
than from anybody's memory of what the plot looked like.
"""

import csv
import json
from collections import defaultdict

import numpy as np


def main() -> None:
    series: dict[str, list[tuple[float, float]]] = defaultdict(list)
    with open("data/happiness.csv") as f:
        for row in csv.DictReader(f):
            series[row["condition"]].append((float(row["week"]), float(row["happiness"])))

    fit = {}
    for condition, points in sorted(series.items()):
        weeks = np.array([p[0] for p in points])
        values = np.array([p[1] for p in points])
        slope, intercept = np.polyfit(weeks, values, 1)
        fit[condition] = {
            "slope_per_week": round(float(slope), 4),
            "intercept": round(float(intercept), 4),
            "n_weeks": int(weeks.size),
        }

    out = {
        "source": "data/happiness.csv",
        "model": "code/happiness_model.py",
        "fit": fit,
        "note": "n = 1 participant, unblinded, who also wrote the software.",
    }
    with open("results/happiness_fit.json", "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
