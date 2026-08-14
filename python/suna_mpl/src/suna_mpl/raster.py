"""Automatic rasterization of high-primitive-count artists.

Dense scatters and long traces explode SVG size and make the SUNA canvas
sluggish; the rendered pixels look identical. ``autorasterize`` flips
``set_rasterized(True)`` on any line or collection whose primitive count
exceeds a budget, so those artists export as a single embedded ``<image>``
while everything else — axes, text, sparse data — stays crisp vector.
"""

from __future__ import annotations

from matplotlib.artist import Artist
from matplotlib.collections import Collection, PathCollection
from matplotlib.figure import Figure
from matplotlib.lines import Line2D

DEFAULT_MAX_PRIMITIVES = 800


def _primitive_count(artist: Artist) -> int:
    if isinstance(artist, Line2D):
        return len(artist.get_xdata())
    if isinstance(artist, PathCollection):
        return len(artist.get_offsets())  # one marker per offset
    if isinstance(artist, Collection):
        return len(artist.get_paths())
    return 0


def autorasterize(
    fig: Figure, max_primitives: int = DEFAULT_MAX_PRIMITIVES
) -> list[Artist]:
    """Rasterize lines/collections in ``fig`` above ``max_primitives``.

    Artists the author already marked (rasterized or not) via
    ``set_rasterized`` are left alone only in the True case; returns the
    artists this call switched to rasterized output.
    """
    switched: list[Artist] = []
    for ax in fig.axes:
        for artist in (*ax.lines, *ax.collections):
            if artist.get_rasterized():
                continue
            if _primitive_count(artist) > max_primitives:
                artist.set_rasterized(True)
                switched.append(artist)
    return switched
