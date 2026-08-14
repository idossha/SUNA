# ADR-002 — Formatter scope: author-guideline compliance, not page facsimile

**Status:** accepted · 2026-08-13 (user direction)

## Decision

Publisher profiles encode what journals publish in their **author
guidelines**, not the visual design of their typeset pages. The reference
PDFs (reference-analysis.md) remain grounding for sensible defaults, but SUNA
does not reproduce mastheads, two-column page templates, running heads, drop
caps, or print pagination.

A publisher profile therefore covers:

1. **Citations & references** — in-text citation mode (numeric superscript /
   author-year / parenthetical), collation rules, reference-list entry
   format, journal-name abbreviation policy. (Already implemented in
   @suna/bib.)
2. **Figure design rules** — width presets (mm), minimum/maximum font sizes
   (pt), line-weight ranges (pt), color-palette guidance (including
   colorblind-safe requirements), file-format and resolution requirements,
   panel-labeling convention. Consumed by the canvas (artboard presets,
   style checks) and by suna_mpl (rc presets).
3. **Manuscript rules** — abstract/title length limits, required and
   forbidden sections, section ordering, summary-paragraph vs headed
   abstract, data/code availability requirements.
4. **Compliance checking** — profiles drive a checker that flags violations
   (figure font too small, abstract too long, missing availability
   statement, off-palette colors) rather than silently reformatting.
5. **Export** — final-stage PDF/DOCX remains, but as a clean *submission
   manuscript* (standard article class, journal-required spacing/line
   numbers when specified), not a journal facsimile.

## Consequences

- The V2/V3 "canvas capability" ranking in reference-analysis §2 is
  descoped: figures are authored in matplotlib (or imported); the canvas
  adjusts, annotates, and checks compliance. No native chart-authoring
  engine.
- The profile schema in @suna/core shifts from page-geometry/typography
  templates toward guideline tokens + limits; profiles are populated from
  journals' published author-guideline pages (with source URLs recorded per
  field for maintainability).
- reference-analysis.md §1's page-template material is retained as
  documentation only.
