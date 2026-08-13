"""Canvas-ready SVG export."""

from __future__ import annotations

import os
from typing import Any

import matplotlib as mpl
from matplotlib.figure import Figure

from .gid import autogid as _autogid


def save_svg(
    fig: Figure,
    path: str | os.PathLike[str],
    *,
    autogid: bool = True,
    editable_text: bool = True,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Save ``fig`` as an SVG the SUNA canvas can address and edit.

    ``editable_text`` keeps glyphs as real ``<text>`` elements
    (``svg.fonttype: none``) instead of outlined paths, so labels stay
    editable and restylable on the canvas.
    """
    if autogid:
        _autogid(fig)
    rc = {"svg.fonttype": "none"} if editable_text else {}
    with mpl.rc_context(rc):
        fig.savefig(path, format="svg", metadata=metadata)
