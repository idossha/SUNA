"""Journal figure-size presets in physical units.

Widths follow the Nature-family conventions observed in SUNA's reference
analysis (single column ~89 mm, full text block ~183 mm); other publishers
can be expressed by passing an explicit millimetre width.
"""

from __future__ import annotations

from matplotlib.figure import Figure

MM_PER_INCH = 25.4

#: preset name -> width in mm
WIDTH_PRESETS_MM: dict[str, float] = {
    "single": 89.0,
    "onehalf": 120.0,
    "double": 183.0,
}

#: default height/width ratio when no height is given
GOLDEN = 0.618


def resolve_width_mm(width: str | float) -> float:
    if isinstance(width, str):
        try:
            return WIDTH_PRESETS_MM[width]
        except KeyError:
            raise ValueError(
                f"unknown width preset {width!r}; use one of "
                f"{sorted(WIDTH_PRESETS_MM)} or a millimetre value"
            ) from None
    return float(width)


def set_size(
    fig: Figure,
    width: str | float = "single",
    height_mm: float | None = None,
    ratio: float = GOLDEN,
) -> Figure:
    """Size ``fig`` to a journal column width (preset name or mm)."""
    w_mm = resolve_width_mm(width)
    h_mm = height_mm if height_mm is not None else w_mm * ratio
    fig.set_size_inches(w_mm / MM_PER_INCH, h_mm / MM_PER_INCH)
    return fig
