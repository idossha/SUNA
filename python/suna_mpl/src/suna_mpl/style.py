"""Journal-appropriate rcParams presets.

Sizes follow the typography observed in SUNA's reference analysis of
Nature-family papers: ~7 pt sans labels, hairline axes, no chartjunk.
"""

from __future__ import annotations

from typing import Any

from cycler import cycler


# Wong (2011) colorblind-safe palette — the categorical palette Nature's
# guidance points authors to.
WONG_PALETTE = [
    "#0072b2",  # blue
    "#d55e00",  # vermillion
    "#009e73",  # bluish green
    "#cc79a7",  # reddish purple
    "#e69f00",  # orange
    "#56b4e9",  # sky blue
    "#f0e442",  # yellow
    "#000000",  # black
]


def journal_rc(profile: str = "nature") -> dict[str, Any]:
    """rcParams that keep figures inside the journal's stated author rules.

    Values trace to official guidelines (see SUNA resources/profiles):
    Nature figures allow 5-7 pt text and 0.25-1 pt lines; colorblind-safe
    palette required.
    """
    if profile != "nature":
        raise ValueError(f"unknown style profile {profile!r}; available: 'nature'")
    return {
        "font.family": "sans-serif",
        "font.size": 7.0,
        "axes.titlesize": 7.0,
        "axes.labelsize": 7.0,
        "xtick.labelsize": 6.0,
        "ytick.labelsize": 6.0,
        "legend.fontsize": 6.0,
        "axes.linewidth": 0.5,
        "xtick.major.width": 0.5,
        "ytick.major.width": 0.5,
        "xtick.minor.width": 0.3,
        "ytick.minor.width": 0.3,
        "lines.linewidth": 1.0,
        "lines.markersize": 3.0,
        "legend.frameon": False,
        "figure.dpi": 150,
        "savefig.dpi": 300,
        "svg.fonttype": "none",
        "axes.prop_cycle": cycler(color=WONG_PALETTE),
    }
