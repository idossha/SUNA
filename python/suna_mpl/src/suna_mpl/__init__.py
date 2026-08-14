"""suna_mpl — matplotlib companion for the SUNA platform.

Typical use in a figure script::

    import matplotlib.pyplot as plt
    import suna_mpl

    with plt.rc_context(suna_mpl.journal_rc()):
        fig, ax = plt.subplots()
        ax.plot(x, y, label="halpha")
        suna_mpl.set_size(fig, "single")
        suna_mpl.save_svg(fig, "figure.svg")

The exported SVG has deterministic element ids (``ax0.line.halpha``) that the
SUNA canvas and its provenance overlay address, and all text remains editable
text. The export is byte-reproducible, writes a ``<out>.suna.json`` sidecar
mapping data<->SVG coordinates, and auto-rasterizes over-dense artists.
"""

from .export import save_svg
from .gid import autogid
from .manifest import build_manifest, sidecar_path, verify_manifest, write_manifest
from .raster import autorasterize
from .sizes import MM_PER_INCH, PROFILE_WIDTHS_MM, WIDTH_PRESETS_MM, resolve_width_mm, set_size
from .style import WONG_PALETTE, journal_rc

__all__ = [
    "MM_PER_INCH",
    "PROFILE_WIDTHS_MM",
    "WIDTH_PRESETS_MM",
    "WONG_PALETTE",
    "autogid",
    "autorasterize",
    "build_manifest",
    "journal_rc",
    "resolve_width_mm",
    "save_svg",
    "set_size",
    "sidecar_path",
    "verify_manifest",
    "write_manifest",
]

__version__ = "0.1.0"
