"""Determinism, sidecar manifest, auto-rasterization, staleness check."""

import matplotlib

matplotlib.use("Agg")

import hashlib
import json
import math
import xml.etree.ElementTree as ET

import matplotlib.pyplot as plt
import numpy as np
import pytest

import suna_mpl

SVG_DPI = 72.0


def _spectrum_figure():
    fig, ax = plt.subplots()
    ax.plot([0.0, 1.0, 2.0], [0.0, 1.0, 0.5], label="halpha")
    ax.set_title("Spectrum")
    ax.set_xlabel("wavelength")
    ax.set_ylabel("flux")
    return fig


def _scatter_figure(n, seed=7):
    rng = np.random.default_rng(seed)
    fig, ax = plt.subplots()
    ax.scatter(rng.random(n), rng.random(n), label="cloud")
    return fig


def _element_count(svg_text):
    return sum(1 for _ in ET.fromstring(svg_text).iter())


# ---------------------------------------------------------------- determinism


def test_deterministic_export_byte_identical(tmp_path):
    paths = []
    for name in ("a.svg", "b.svg"):
        fig = _spectrum_figure()
        try:
            out = tmp_path / name
            suna_mpl.save_svg(fig, out)
            paths.append(out)
        finally:
            plt.close(fig)
    first, second = (p.read_bytes() for p in paths)
    assert first == second
    assert b"<dc:date>" not in first


def test_deterministic_strips_date_nondeterministic_keeps_it(tmp_path):
    fig = _spectrum_figure()
    try:
        det = tmp_path / "det.svg"
        loose = tmp_path / "loose.svg"
        suna_mpl.save_svg(fig, det)
        suna_mpl.save_svg(fig, loose, deterministic=False)
        assert "<dc:date>" not in det.read_text()
        assert "<dc:date>" in loose.read_text()
    finally:
        plt.close(fig)


def test_explicit_date_metadata_wins_over_deterministic(tmp_path):
    fig = _spectrum_figure()
    try:
        out = tmp_path / "dated.svg"
        suna_mpl.save_svg(fig, out, metadata={"Date": "1970-01-01"})
        assert "<dc:date>1970-01-01</dc:date>" in out.read_text()
    finally:
        plt.close(fig)


# ------------------------------------------------------------------- manifest


def test_manifest_sidecar_contents(tmp_path):
    fig = _spectrum_figure()
    try:
        out = tmp_path / "figure.svg"
        suna_mpl.save_svg(fig, out)
        sidecar = tmp_path / "figure.svg.suna.json"
        assert sidecar.exists()
        data = json.loads(sidecar.read_text())

        assert data["schemaVersion"] == 1
        assert data["svgSha256"] == hashlib.sha256(out.read_bytes()).hexdigest()
        w_in, h_in = fig.get_size_inches()
        assert data["widthMm"] == pytest.approx(w_in * 25.4)
        assert data["heightMm"] == pytest.approx(h_in * 25.4)
        assert data["generator"]["mpl_version"] == matplotlib.__version__
        assert isinstance(data["generator"]["script"], str)

        (entry,) = data["axes"]
        assert entry["gid"] == "ax0"
        assert entry["xscale"] == "linear"
        assert entry["yscale"] == "linear"

        # anchors are (data, svg-user-unit) pairs at the axis limits and
        # must land on the axes bbox edges — computable without matplotlib
        ax = fig.axes[0]
        pos = ax.get_position()
        width_pt = w_in * SVG_DPI
        height_pt = h_in * SVG_DPI
        (xa0, sx0), (xa1, sx1) = entry["anchors"]["x"]
        (ya0, sy0), (ya1, sy1) = entry["anchors"]["y"]
        assert (xa0, xa1) == pytest.approx(ax.get_xlim())
        assert (ya0, ya1) == pytest.approx(ax.get_ylim())
        assert sx0 == pytest.approx(pos.x0 * width_pt)
        assert sx1 == pytest.approx(pos.x1 * width_pt)
        # SVG y runs downward from the top-left corner
        assert sy0 == pytest.approx((1.0 - pos.y0) * height_pt)
        assert sy1 == pytest.approx((1.0 - pos.y1) * height_pt)
        assert sy0 > sy1
    finally:
        plt.close(fig)


def test_manifest_log_scale_stores_log10(tmp_path):
    fig, ax = plt.subplots()
    try:
        ax.plot([1.0, 10.0, 1000.0], [1.0, 2.0, 3.0])
        ax.set_xscale("log")
        ax.set_xlim(1.0, 1000.0)
        out = tmp_path / "log.svg"
        suna_mpl.save_svg(fig, out)
        data = json.loads((tmp_path / "log.svg.suna.json").read_text())
        (entry,) = data["axes"]
        assert entry["xscale"] == "log10"
        assert entry["yscale"] == "linear"
        (xa0, _), (xa1, _) = entry["anchors"]["x"]
        assert xa0 == pytest.approx(math.log10(1.0))
        assert xa1 == pytest.approx(math.log10(1000.0))
    finally:
        plt.close(fig)


def test_manifest_opt_out(tmp_path):
    fig = _spectrum_figure()
    try:
        out = tmp_path / "bare.svg"
        suna_mpl.save_svg(fig, out, manifest=False)
        assert out.exists()
        assert not (tmp_path / "bare.svg.suna.json").exists()
    finally:
        plt.close(fig)


# ------------------------------------------------------------------ staleness


def test_verify_manifest_roundtrip_and_staleness(tmp_path):
    fig = _spectrum_figure()
    try:
        out = tmp_path / "figure.svg"
        suna_mpl.save_svg(fig, out)
        assert suna_mpl.verify_manifest(out) is True
        out.write_bytes(out.read_bytes() + b"<!-- edited -->\n")
        assert suna_mpl.verify_manifest(out) is False
    finally:
        plt.close(fig)


def test_verify_manifest_missing_sidecar_is_stale(tmp_path):
    fig = _spectrum_figure()
    try:
        out = tmp_path / "orphan.svg"
        suna_mpl.save_svg(fig, out, manifest=False)
        assert suna_mpl.verify_manifest(out) is False
    finally:
        plt.close(fig)


def test_verify_manifest_missing_svg_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        suna_mpl.verify_manifest(tmp_path / "never-saved.svg")


# -------------------------------------------------------------- rasterization


def test_dense_scatter_rasterizes_sparse_stays_vector(tmp_path):
    dense = _scatter_figure(5000)
    sparse = _scatter_figure(100)
    try:
        dense_out = tmp_path / "dense.svg"
        sparse_out = tmp_path / "sparse.svg"
        suna_mpl.save_svg(dense, dense_out)
        suna_mpl.save_svg(sparse, sparse_out)

        dense_svg = dense_out.read_text()
        assert "<image" in dense_svg
        assert _element_count(dense_svg) < 500

        sparse_svg = sparse_out.read_text()
        assert "<image" not in sparse_svg
    finally:
        plt.close(dense)
        plt.close(sparse)


def test_rasterize_threshold_none_disables(tmp_path):
    fig = _scatter_figure(2000)
    try:
        out = tmp_path / "vector.svg"
        suna_mpl.save_svg(fig, out, rasterize_threshold=None)
        assert "<image" not in out.read_text()
    finally:
        plt.close(fig)


def test_autorasterize_counts_lines_and_collections():
    fig, ax = plt.subplots()
    try:
        x = np.linspace(0.0, 1.0, 2000)
        (long_line,) = ax.plot(x, x)
        (short_line,) = ax.plot([0.0, 1.0], [1.0, 0.0])
        dense_scatter = ax.scatter(x, 1.0 - x)
        switched = suna_mpl.autorasterize(fig, max_primitives=800)
        assert set(switched) == {long_line, dense_scatter}
        assert long_line.get_rasterized() is True
        assert dense_scatter.get_rasterized() is True
        assert not short_line.get_rasterized()
        # idempotent: already-rasterized artists are not switched again
        assert suna_mpl.autorasterize(fig, max_primitives=800) == []
    finally:
        plt.close(fig)
