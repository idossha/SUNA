"""Semantic, stable SVG ids for matplotlib artists.

Matplotlib copies an artist's ``gid`` into the SVG ``id`` attribute on export.
SUNA's canvas and provenance overlay address elements by these ids, so they
must be deterministic across regeneration: derived from artist labels when
available, positional otherwise.
"""

from __future__ import annotations

import re

from matplotlib.artist import Artist
from matplotlib.figure import Figure


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip()).strip("-").lower()
    return slug or "unnamed"


class _Namer:
    """Allocates unique names within one figure."""

    def __init__(self) -> None:
        self._used: set[str] = set()

    def claim(self, candidate: str) -> str:
        name = candidate
        n = 2
        while name in self._used:
            name = f"{candidate}-{n}"
            n += 1
        self._used.add(name)
        return name


def _labelled_name(artist: Artist, fallback: str) -> str:
    label = artist.get_label()
    if isinstance(label, str) and label and not label.startswith("_"):
        return _slug(label)
    return fallback


def _tag(namer: _Namer, artist: Artist, candidate: str) -> None:
    # never clobber a gid the author set explicitly
    if artist.get_gid() is None:
        artist.set_gid(namer.claim(candidate))
    else:
        namer.claim(str(artist.get_gid()))


def autogid(fig: Figure) -> Figure:
    """Assign semantic gids to every addressable artist in ``fig``."""
    namer = _Namer()

    suptitle = getattr(fig, "_suptitle", None)
    if suptitle is not None:
        _tag(namer, suptitle, "suptitle")

    for i, ax in enumerate(fig.axes):
        base = f"ax{i}"
        _tag(namer, ax, base)
        if ax.title.get_text():
            _tag(namer, ax.title, f"{base}.title")
        if ax.xaxis.label.get_text():
            _tag(namer, ax.xaxis.label, f"{base}.xlabel")
        if ax.yaxis.label.get_text():
            _tag(namer, ax.yaxis.label, f"{base}.ylabel")

        for j, line in enumerate(ax.lines):
            _tag(namer, line, f"{base}.line.{_labelled_name(line, f'line{j}')}")
        for j, coll in enumerate(ax.collections):
            _tag(namer, coll, f"{base}.coll.{_labelled_name(coll, f'coll{j}')}")
        for j, patch in enumerate(ax.patches):
            _tag(namer, patch, f"{base}.patch{j}")
        for j, image in enumerate(ax.images):
            _tag(namer, image, f"{base}.image{j}")
        for j, text in enumerate(ax.texts):
            _tag(namer, text, f"{base}.text{j}")

        legend = ax.get_legend()
        if legend is not None:
            _tag(namer, legend, f"{base}.legend")

    for k, legend in enumerate(fig.legends):
        _tag(namer, legend, f"legend{k}" if k else "legend")

    return fig
