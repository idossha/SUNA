# ADR-005 — SUNA default export style: always-on base, journal deltas on top

Date: 2026-08-17 · Status: accepted

## Context

The DOCX/PDF export had two renderers forked on a single boolean
(`isHouseStyle`): the `suna` profile — the only one carrying a
`documentStyle` — got the good typography, while all twelve journal
profiles fell back to a legacy look (A4, Word's default blue 16 pt
headings, full-grid tables). An optional external accelerator
(`docx-tools` on PATH) could build the DOCX instead of the bundled
library.

Ground truth was established from three of the user's real submitted
manuscripts (`examples/docx_examples/`: two main papers + one
supplementary-information document, all produced by their docx-tools
CLI and verified at the OOXML level) plus the SLEEP journal's official
author guidelines (https://academic.oup.com/sleep/pages/author-guidelines).
The three documents share one invariant core — US Letter, 0.5 in
margins, Times New Roman, 11 pt body at 1.15, superscript-affiliation
title block, 13/11 pt black headings, bracketed `[n]` citations,
0.5 in-hanging 10 pt references, `Figure N.` bold + italic captions
below inline figures, three-line APA tables with captions above —
and differ only in journal conventions.

## Decision

1. **The SUNA house style is the always-on base for every profile.**
   `export-style.ts` holds `SUNA_DEFAULT_STYLE` (the ground-truth values)
   and `resolveDocumentStyle(profile)` deep-merges a profile's now-PARTIAL
   `documentStyle` over it. `isHouseStyle` and the legacy style are gone.
2. **Journal differences are small typed deltas**, stated only when the
   journal's guidelines actually state them (`null`/absent = inherit):
   `figureLabel` ('Figure' | 'Fig.'), `figurePlacement`
   ('inline' | 'captions-list'), `tablePlacement` ('inline' | 'end'),
   `referencesStartNewPage`, plus any typography field. SLEEP carries
   captions-list + tables-end + 'Figure'; Nature Astronomy and MNRAS
   carry `figureLabel: 'Fig.'` (each sourced in the profile's notes).
3. **Everything ships in-package.** The docx-tools accelerator
   (external CLI detection, `export:tools-available`, the dialog
   checkbox) is removed; the bundled `docx` library is the only builder.
   Its logic was ported instead: real Word lists (numbering.xml),
   figure/table bookmarks with internal-hyperlink cross-references,
   back matter in docx-tools' order (Acknowledgments → Funding →
   Competing Interests → Data and Code Availability → Author
   Contributions → References), keywords, neutral docProps.
4. **Journal-stated submission options are shown, not enforced.** The
   export page's requirements panel (right column) summarizes the
   selected journal's stated rules generically — required / do not use /
   not stated — and profile-stated double-spacing/line-number values
   seed the option defaults but never lock the checkboxes.

## Consequences

- Every profile's export now opens in Word looking like the user's real
  published manuscripts; a journal switch changes conventions, not
  quality.
- The old "journal profile is left completely alone" test invariant is
  obsolete by design; the new invariant is "journal profiles inherit
  the SUNA default plus only their stated deltas" (profiles.test.ts,
  export-docx.test.ts, export-profile-contrast.test.ts).
- `documentStyle` in a journal profile is subject to the same source
  discipline as every other field: no delta without a guideline
  statement behind it.
- Supplementary Information export (S-numbering, Contents TOC,
  independent references) and a strict-subset LaTeX→OMML math
  converter build on the same seams (phase 3 of the overhaul).
