"""Canvas-ready SVG export."""

from __future__ import annotations

import os
from typing import Any

import matplotlib as mpl
from matplotlib.figure import Figure

from .gid import autogid as _autogid
from .manifest import write_manifest as _write_manifest
from .raster import DEFAULT_MAX_PRIMITIVES, autorasterize as _autorasterize

#: fixed svg.hashsalt so generated ids don't vary run to run
_HASHSALT = "suna"


def save_svg(
    fig: Figure,
    path: str | os.PathLike[str],
    *,
    autogid: bool = True,
    editable_text: bool = True,
    deterministic: bool = True,
    manifest: bool = True,
    rasterize_threshold: int | None = DEFAULT_MAX_PRIMITIVES,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Save ``fig`` as an SVG the SUNA canvas can address and edit.

    ``editable_text`` keeps glyphs as real ``<text>`` elements
    (``svg.fonttype: none``) instead of outlined paths, so labels stay
    editable and restylable on the canvas.

    ``deterministic`` makes repeated exports of the same figure
    byte-identical: it pins ``svg.hashsalt`` and strips the creation
    date from the SVG metadata (an explicit ``metadata={'Date': ...}``
    still wins).

    ``manifest`` also writes a ``<out>.suna.json`` sidecar with the
    coordinate anchors and content hash SUNA uses to map data<->SVG
    coordinates and detect stale exports (see :mod:`suna_mpl.manifest`).

    ``rasterize_threshold`` auto-rasterizes lines/collections with more
    primitives than the budget (see :func:`suna_mpl.autorasterize`);
    pass ``None`` to keep everything vector.
    """
    if autogid:
        _autogid(fig)
    if rasterize_threshold is not None:
        _autorasterize(fig, rasterize_threshold)

    rc: dict[str, Any] = {}
    if editable_text:
        rc["svg.fonttype"] = "none"
    md = dict(metadata) if metadata else {}
    if deterministic:
        rc["svg.hashsalt"] = _HASHSALT
        md.setdefault("Date", None)  # None removes the <dc:date> stamp

    with mpl.rc_context(rc):
        fig.savefig(path, format="svg", metadata=md or None)

    if manifest:
        _write_manifest(fig, path)
