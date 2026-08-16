# Feature plan 6 — DOCX import, DOCX/PDF export, and a neuroscience journal set

Requested 2026-08-15. Ground truth probed before writing (§0).

## 0. Probed ground truth

- **Toolchain on this machine**: `docx-tools` (the user's own CLI: `read`
  docx→spec.json, `build` spec→docx, `redline`, `bib`), `pandoc`, and
  `soffice` are all installed. **But a shipped app must not require them** —
  flux's lesson was that a fresh install unable to export is worse than a
  slower path. So the built-in path uses bundled JS libraries and external
  tools are an *optional accelerator*.
- **Installed for this work**: `mammoth` 1.12.1 (docx→HTML), `docx` 9.7.1
  (build .docx programmatically), `jszip` 3.10.1 (raw OOXML access).
- **Verified against a real manuscript** (`sleepTI_draft_v0.9.docx`, 55 MB):
  mammoth yields the title as a **bold paragraph, not an `h1`**; the author
  line as one paragraph with `<sup>` affiliation markers; 26 headings; 141
  paragraphs; images inlined as base64 data URIs (which is why the HTML is
  73 MB — images must be extracted to files, never kept inline).
- The example doc carries `_docx_tools_id_*` anchors because it was built by
  `docx-tools`; **arbitrary Word documents will not have them**, so import
  must work structurally, not from those hints.

---

## 1. Journal profiles — evidence first, no invention

Requested: **Science, Nature, Neuron, PNAS, Brain Stimulation, SLEEP, Sleep
Advances, Journal of Neural Engineering, Journal of Neuroscience**.

**Hard rule from the user: if a journal's guidelines cannot be found, that
journal is not shipped.** No inferred profile, no "close enough" sibling
journal's rules. A profile is only created from the journal's own author
instructions, and every value keeps its source URL — matching the existing
profile schema's `provenance` field (documented / counted-empirically /
inferred).

Research phase produces, per journal: citation style (in-text mode + the
reference-list entry pattern), manuscript limits (abstract, title, word
counts per article type), required sections, figure rules (widths, fonts,
line weights, formats, color/accessibility), and submission format
(spacing, line numbers, file types). Anything the journal does not state is
`null` — never guessed.

The existing `nature-astronomy` and `science` profiles stay; `nature`
(flagship) is added separately from Nature Astronomy since limits differ.

**Acceptance**: `resources/profiles/` contains a schema-valid profile for
exactly those journals whose guidelines were found; the research report
names each journal that was dropped and why; every non-null value traces to
a URL in the findings file.

## 2. DOCX import → SUNA project

`File → Import manuscript…` (and a wizard step) takes a `.docx` and produces
a project: `manuscript.json`, `sections/*.md`, `references.bib`, and
extracted figures.

**Pipeline** (all in the main process; `mammoth` + `jszip`):

1. **Convert** with mammoth using an explicit style map so semantics survive:
   Word heading styles → `h1..h4`, bold/italic → `strong`/`em`, superscript
   → `sup`, and `convertImage` writing each image to
   `figures/imported-N/figure.<ext>` instead of a data URI.
2. **Front matter heuristics** (documented, testable, and *reported to the
   user* rather than silently assumed):
   - Title: the first non-empty block that is a heading **or** a fully-bold
     paragraph before any body text.
   - Authors: the next paragraph containing `<sup>` markers or comma-separated
     names; split names, map each `<sup>` group to affiliation indices.
   - Affiliations: subsequent short paragraphs beginning with a digit or
     `<sup>` marker.
   - Abstract: a paragraph following a heading matching /abstract|summary/i.
   Every heuristic result is shown in an **import review screen** the user can
   correct before anything is written.
3. **Sections**: split at h1/h2 boundaries into `sections/NN-slug.md`;
   convert inline HTML to SciMark (bold/italic/sup/sub, lists, tables, math
   where Word used OMML — if OMML conversion is not reliable, keep the text
   and flag it rather than emitting broken LaTeX).
4. **Citations & references**: detect a References/Bibliography section, parse
   entries with a tolerant matcher (numbered `1. Author, A. …`, author–year,
   Vancouver), emit `references.bib` with generated keys, and rewrite in-text
   markers (`[1]`, `(Author, 2020)`, superscripts) into `[@key]` **only where
   the mapping is unambiguous**; anything ambiguous stays literal and is
   listed in the review screen. This is the one place where guessing would
   corrupt a manuscript, so the bar is: map it or leave it alone.
5. **Report**: the review screen summarises what was found (N sections, N
   authors, N references mapped / N left literal, N figures extracted) with
   per-item "looks wrong?" affordances.

**Acceptance**: importing the real `sleepTI_draft_v0.9.docx` yields a
schema-valid `manuscript.json` with the correct title and ≥10 authors with
affiliation links, ≥20 sections, figures written as files (no data URIs
anywhere in the output), and a `references.bib` that `parseBibtex`
round-trips. No step writes anything until the user confirms the review.

## 3. DOCX export

`Export → Word (.docx)` renders the manuscript through the active profile
using the `docx` library (no external binary):

- Title page per profile (title, authors with affiliation superscripts,
  affiliations, corresponding author, abstract, keywords).
- Body sections with the profile's heading hierarchy; figures embedded as
  PNG (rasterised from the SVG at the profile's dpi, reusing the existing
  figure export) with captions numbered per profile.
- Reference list formatted by the existing `@suna/bib` engine in the
  profile's style; in-text citations rendered to their final form.
- Submission format from the profile: double spacing, line numbers,
  continuous page numbers, and the profile's font/size where stated.
- Output to `output/<name>.docx`; sources are never mutated.
- **Optional accelerator**: when `docx-tools` is on PATH, offer "build via
  docx-tools" (it produces the same spec-driven output and gives the user
  their existing redline workflow). Detected, never required.

## 4. PDF export

`Export → PDF` renders the same profile-styled manuscript to PDF **via
Electron's `printToPDF`** on a hidden window loading our own HTML — no
LaTeX, no Tectonic download, no external binary. Page size, margins, and
running heads come from the profile; figures are embedded at export dpi.

(LaTeX/Tectonic remains a possible future path for LaTeX-native journals; it
is explicitly **not** in this milestone, and the roadmap should say so rather
than implying PDF export is LaTeX-quality typesetting.)

**Acceptance**: exporting the example project produces a `.docx` that Word
opens with the right title/authors/sections/references, and a `.pdf` with the
same content; both land in `output/`; the compliance checker runs first and
warns (never blocks) on violations.

---

## Constraints

- **Do not run `pnpm smoke`** for this work (user instruction). Gates are
  `pnpm typecheck && pnpm test`, plus **fixture-driven verification**: a real
  round-trip on `examples/demo-paper` and on a small committed `.docx`
  fixture, asserted from Node rather than the UI.
- Import never overwrites an existing project without explicit confirmation;
  it writes into a fresh directory by default.
- Every profile value keeps its source URL; unfound journals are dropped, not
  approximated.
- No external binary is required for import or export; `docx-tools`/`pandoc`
  are optional enhancements when present.
