import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pytest

import suna_mpl


@pytest.fixture()
def fig():
    f = plt.figure()
    yield f
    plt.close(f)


def test_set_size_single_column(fig):
    suna_mpl.set_size(fig, "single")
    w_in, h_in = fig.get_size_inches()
    assert w_in == pytest.approx(88.0 / 25.4)
    assert h_in == pytest.approx(88.0 * 0.618 / 25.4)


def test_profile_width_tables(fig):
    suna_mpl.set_size(fig, "single", profile="mnras")
    assert fig.get_size_inches()[0] == pytest.approx(80.0 / 25.4)
    with pytest.raises(ValueError, match="unknown journal profile"):
        suna_mpl.set_size(fig, "single", profile="apocrypha")


def test_journal_rc_uses_wong_palette():
    rc = suna_mpl.journal_rc()
    colors = [c["color"] for c in rc["axes.prop_cycle"]]
    assert colors[0] == "#0072b2"
    assert len(colors) == len(suna_mpl.WONG_PALETTE)
    assert rc["axes.titlesize"] == 7.0


def test_set_size_explicit_mm(fig):
    suna_mpl.set_size(fig, 120.0, height_mm=40.0)
    w_in, h_in = fig.get_size_inches()
    assert w_in == pytest.approx(120.0 / 25.4)
    assert h_in == pytest.approx(40.0 / 25.4)


def test_set_size_rejects_unknown_preset(fig):
    with pytest.raises(ValueError, match="unknown width preset"):
        suna_mpl.set_size(fig, "triple")


def _demo_figure():
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1], label="halpha")
    ax.plot([0, 1], [1, 0], label="continuum fit")
    ax.set_title("Spectrum")
    ax.set_xlabel("wavelength")
    ax.set_ylabel("flux")
    ax.legend()
    return fig, ax


def test_autogid_semantic_ids():
    fig, ax = _demo_figure()
    try:
        suna_mpl.autogid(fig)
        assert ax.get_gid() == "ax0"
        assert ax.title.get_gid() == "ax0.title"
        assert ax.xaxis.label.get_gid() == "ax0.xlabel"
        assert ax.lines[0].get_gid() == "ax0.line.halpha"
        assert ax.lines[1].get_gid() == "ax0.line.continuum-fit"
        assert ax.get_legend().get_gid() == "ax0.legend"
    finally:
        plt.close(fig)


def test_autogid_deduplicates_and_respects_explicit_gids():
    fig, ax = plt.subplots()
    try:
        ax.plot([0, 1], label="flux")
        ax.plot([1, 2], label="flux")
        (explicit,) = ax.plot([2, 3])
        explicit.set_gid("my-special-line")
        suna_mpl.autogid(fig)
        gids = [line.get_gid() for line in ax.lines]
        assert gids[0] == "ax0.line.flux"
        assert gids[1] == "ax0.line.flux-2"
        assert gids[2] == "my-special-line"
        assert len(set(gids)) == 3
    finally:
        plt.close(fig)


def test_save_svg_ids_and_editable_text(tmp_path):
    fig, _ax = _demo_figure()
    try:
        out = tmp_path / "figure.svg"
        suna_mpl.save_svg(fig, out)
        svg = out.read_text()
        assert 'id="ax0.line.halpha"' in svg
        assert 'id="ax0.title"' in svg
        assert 'id="ax0.legend"' in svg
        # svg.fonttype 'none' keeps labels as literal text, not glyph paths
        assert "Spectrum" in svg
        assert "wavelength" in svg
    finally:
        plt.close(fig)


def test_journal_rc_applies():
    with plt.rc_context(suna_mpl.journal_rc()):
        assert plt.rcParams["font.size"] == 7.0
        assert plt.rcParams["svg.fonttype"] == "none"
    with pytest.raises(ValueError, match="unknown style profile"):
        suna_mpl.journal_rc("science-fiction")
