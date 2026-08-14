"""Sidecar manifest: data<->SVG coordinate anchors and a staleness hash.

``save_svg`` writes ``<out>.suna.json`` next to every exported SVG. The
manifest carries two anchor points per axis — pairs of (data value,
SVG user-unit coordinate) — which is exactly enough for the SUNA canvas
to map data coordinates to SVG coordinates (and back) by linear
interpolation, without importing matplotlib. Log-scaled axes store
``log10(data)`` values and mark the scale field ``"log10"`` so the same
linear interpolation still applies.

The stored ``svgSha256`` lets :func:`verify_manifest` detect a manifest
that has gone stale because the SVG was regenerated or edited without it.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import matplotlib
from matplotlib.axes import Axes
from matplotlib.figure import Figure

from .sizes import MM_PER_INCH

SCHEMA_VERSION = 1

#: matplotlib's SVG backend always renders at 72 dpi: 1 SVG user unit = 1 pt
_SVG_DPI = 72.0


def sidecar_path(svg_path: str | os.PathLike[str]) -> Path:
    """Return the manifest path for ``svg_path`` (``<out>.suna.json``)."""
    return Path(f"{os.fspath(svg_path)}.suna.json")


def _sha256(path: str | os.PathLike[str]) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _scale_name(scale: str) -> str:
    # anchors on log axes store log10(data), so name the scale accordingly
    return "log10" if scale == "log" else scale


def _anchor_data(scale: str, lo: float, hi: float) -> tuple[float, float]:
    if scale == "log":
        return math.log10(lo), math.log10(hi)
    return float(lo), float(hi)


def _axes_entry(ax: Axes, height_pt: float) -> dict[str, Any]:
    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    # display coords at 72 dpi are SVG user units, save for the y flip:
    # matplotlib's display origin is bottom-left, SVG's is top-left.
    (sx0, sy0), (sx1, _), (_, sy1) = ax.transData.transform(
        [(x0, y0), (x1, y0), (x0, y1)]
    )
    xscale = ax.get_xscale()
    yscale = ax.get_yscale()
    xd0, xd1 = _anchor_data(xscale, x0, x1)
    yd0, yd1 = _anchor_data(yscale, y0, y1)
    return {
        "gid": ax.get_gid(),
        "xscale": _scale_name(xscale),
        "yscale": _scale_name(yscale),
        "anchors": {
            "x": [[xd0, float(sx0)], [xd1, float(sx1)]],
            "y": [[yd0, float(height_pt - sy0)], [yd1, float(height_pt - sy1)]],
        },
    }


def build_manifest(fig: Figure, svg_path: str | os.PathLike[str]) -> dict[str, Any]:
    """Build the manifest dict for ``fig`` as already saved at ``svg_path``."""
    w_in, h_in = fig.get_size_inches()
    height_pt = float(h_in) * _SVG_DPI
    orig_dpi = fig.dpi
    try:
        fig.dpi = _SVG_DPI  # measure transforms in SVG user units
        axes = [_axes_entry(ax, height_pt) for ax in fig.axes]
    finally:
        fig.dpi = orig_dpi
    return {
        "schemaVersion": SCHEMA_VERSION,
        "svgSha256": _sha256(svg_path),
        "widthMm": float(w_in) * MM_PER_INCH,
        "heightMm": float(h_in) * MM_PER_INCH,
        "axes": axes,
        "generator": {
            "script": sys.argv[0],
            "mpl_version": matplotlib.__version__,
        },
    }


def write_manifest(fig: Figure, svg_path: str | os.PathLike[str]) -> Path:
    """Write the ``<out>.suna.json`` sidecar for ``svg_path``; return its path."""
    out = sidecar_path(svg_path)
    out.write_text(json.dumps(build_manifest(fig, svg_path), indent=2) + "\n")
    return out


def verify_manifest(svg_path: str | os.PathLike[str]) -> bool:
    """Check that the sidecar manifest still matches the SVG on disk.

    Returns ``True`` when ``<svg_path>.suna.json`` exists and its stored
    ``svgSha256`` equals the hash of the SVG's current bytes; ``False``
    when the sidecar is missing, unreadable, or stale. A missing SVG
    raises :class:`FileNotFoundError`.
    """
    digest = _sha256(svg_path)  # missing SVG is an error, not staleness
    sidecar = sidecar_path(svg_path)
    try:
        data = json.loads(sidecar.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return False
    stored = data.get("svgSha256") if isinstance(data, dict) else None
    return stored == digest
