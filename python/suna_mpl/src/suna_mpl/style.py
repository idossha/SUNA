"""Journal-appropriate rcParams presets.

Sizes follow the typography observed in SUNA's reference analysis of
Nature-family papers: ~7 pt sans labels, hairline axes, no chartjunk.
"""

from __future__ import annotations

from typing import Any


def journal_rc(profile: str = "nature") -> dict[str, Any]:
    if profile != "nature":
        raise ValueError(f"unknown style profile {profile!r}; available: 'nature'")
    return {
        "font.family": "sans-serif",
        "font.size": 7.0,
        "axes.titlesize": 8.0,
        "axes.labelsize": 7.0,
        "xtick.labelsize": 6.5,
        "ytick.labelsize": 6.5,
        "legend.fontsize": 6.5,
        "axes.linewidth": 0.5,
        "xtick.major.width": 0.5,
        "ytick.major.width": 0.5,
        "xtick.minor.width": 0.4,
        "ytick.minor.width": 0.4,
        "lines.linewidth": 1.0,
        "lines.markersize": 3.0,
        "legend.frameon": False,
        "figure.dpi": 150,
        "savefig.dpi": 300,
        "svg.fonttype": "none",
    }
