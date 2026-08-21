"""The model behind Figure 1a, such as it is.

Reusable code lives here rather than in `analysis/`: `analysis/` scripts are
pipeline steps that turn `data/` into `results/`, and this is the thing they
import. It is deliberately three lines of arithmetic — a reader should be able
to check the claim in the manuscript against the code in one sitting.
"""

from __future__ import annotations


def happiness(week: float, *, baseline: float = 6.0, rate: float = 0.28) -> float:
    """Self-reported happiness after ``week`` weeks of using SUNA.

    A straight line, because the data are one person's opinion recorded once a
    week and a straight line is already more model than that deserves.
    """
    return baseline + rate * week


def hours_saved(before_hours: float, after_hours: float) -> float:
    """Hours per week a chore stopped costing. Never negative by construction."""
    return max(0.0, before_hours - after_hours)


if __name__ == "__main__":
    for w in (1, 6, 12):
        print(f"week {w:2d}: {happiness(w):.2f}")
