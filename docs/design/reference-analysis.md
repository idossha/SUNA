# Reference Analysis: Design Requirements

> **Historical design note.** The contract is [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the
> decisions are in [`docs/DECISIONS.md`](../DECISIONS.md). This file is kept for the detail and the
> sourcing it carries, but where it disagrees with the contract the contract wins — and
> `ARCHITECTURE.md` §20 lists the places it is known to. Do not treat anything here as current.

Derived from structured analyses of four published Nature-family astrophysics papers (3× *Nature Astronomy* Articles 2026, 1× *Nature Physics* Review Article 2017). These papers define the target output quality for SUNA's formatter and figure canvas. All requirements below are traceable to observed features in the reference PDFs.

---

## 1. Publisher Profile Model

A publisher profile is a **declarative JSON document** consumed by the output formatter. It must be able to reproduce every layout decision in the reference papers without code changes. The profile is the *only* place journal-specific styling lives; `manuscript.json` stays journal-agnostic.

### 1.1 Page geometry

| Field | Observed values | Notes |
|---|---|---|
| `page.trim` | ~210 × 280 mm | Per-journal |
| `page.margins` | ~17–20 mm | Independent top/bottom/inner/outer |
| `page.columns` | 2 | Column count for body flow |
| `page.columnWidth` / `gutter` | ~88–89 mm / ~5–6 mm | Also drives figure width presets |
| `page.textBlockWidth` | ~180–183 mm | Double-column figure width |
| `page.folio` | `continuing` (start folio configurable, e.g. 1208) \| `none` (online-first) \| `outer-margin-bold` (Nat Phys) | Three distinct pagination models observed |

### 1.2 Typography tokens

- `fonts.body`: serif (Harding-like for Nature Astronomy, Minion-like for Nature Physics), ~8.5–9 pt, justified, hyphenation on/off control.
- `fonts.headings`: sans (Nature) — dual-typeface hierarchy (serif body vs sans for title/standfirst/heads/captions/refs) is a hard requirement for Nature Physics.
- `fonts.title`: ~26–28 pt bold serif (Nat Astron) or bold sans (Nat Phys) — face and size per profile.
- `fonts.abstract`: larger than body (~11 pt); Nat Phys sets it bold sans as a "standfirst".
- `fonts.caption`: sans ~7–7.5 pt; `fonts.references`: ~7.5 pt; `fonts.affiliations`: ~6 pt.
- `dropCap`: `{enabled, lines: 3, scope: "first-paragraph-only"}` — Nature Physics only.
- Heading hierarchy (3 levels observed): **A-heads** (bold, slightly larger: Results, Methods, References…), **B-heads** (bold at body size, own line, may wrap), **run-in C-heads** (bold, terminated by period, inside paragraph — e.g. "Particle initialization." in Methods). Profile declares style + spacing per level.

### 1.3 Page templates (minimum two per profile)

**Front-matter page** (bespoke, page 1):
- Masthead band: journal wordmark (lowercase, position), rule bands in brand color, Open Access badge slot (SVG asset), article-type label + hyperlinked DOI strip separated by thin rules. Nature Physics variant: full-width dark banner with article type in white caps + published-online date + logo block — the banner must be a configurable component, not hardcoded.
- Full-width title zone (title may contain inline math, e.g. italic *z* = 2.51).
- **Asymmetric grid**: narrow left rail (~30%: Received/Accepted/Published-online in thin-rule-delimited rows + "Check for updates" badge) beside wide right zone (~70%: author byline + abstract). Profile declares rail width, rule styles, badge slots.
- Abstract: single wide block, rule-delimited, **no "Abstract" heading**, larger type. Nat Phys variant: bold sans standfirst spanning full width. Both must be expressible.
- Body starts two-column on page 1, below the front matter, **with no forced "Introduction" heading**.
- Affiliations placement is a profile switch: `footnote-page1` (full block at page bottom, ~6 pt, ends with ✉ e-mail) **or** `deferred-end` (page-1 pointer footnote "A full list of affiliations appears at the end of the paper" + numbered block at end of paper). Both observed in the same journal.
- Nature Physics simple variant: single author + asterisk footnote + affiliation/e-mail footnote block above footer rule.

**Running-text page**:
- Header: bold article-type label left | blue DOI URL right | thin rule. Nat Phys variant: **alternating recto/verso** colored-band running heads — profile needs a `header.mode: "mirrored"` option.
- Footer variants (all observed): `"Nature Astronomy | Volume 10 | August 2026 | 1208–1217"` (journal name in brand teal) + bold folio; blue journal name only, no folio (online-first); Nat Phys: outer-margin bold folio + `JOURNAL | VOL | MONTH YEAR | URL` + **centered per-page copyright line**. Footer is a template string with tokens (`{journal} {volume} {month} {year} {firstPage}–{lastPage}`).

**Extended Data pages**: one figure/table per page after back matter, same running header/footer, caption below figure / title above table.

### 1.4 Section ordering rules

Profile declares an ordered list of required/optional back-matter sections with fixed sequence, e.g. for Nature Astronomy:

```
Methods → Data availability → Code availability → References → Acknowledgements
→ Author contributions → [Funding] → Competing interests → Additional information
→ [deferred affiliations] → Extended Data objects
```

"Additional information" is itself a template of **bold run-in sub-blocks** in fixed order: Extended data; Supplementary information; Correspondence and requests for materials; Peer review information; Reprints and permissions; Publisher's note; Open Access licence paragraph; © line. These are boilerplate templates with slots (correspondence name, reviewer names, licence text) — the profile ships the boilerplate strings.

Older/other profiles (Nat Phys 2017) omit Methods/Data availability/Extended Data entirely and use: dates line → References → Acknowledgements → Additional information → Competing financial interests. **Section ordering must be data, not code.**

### 1.5 Figure, caption, table, citation styling knobs

- Caption format string: bold `"Fig. N | "` + bold title fragment + roman text; panel letters bold lowercase inline (`a,` `b,c`, ranges `a–f`, compound `a(i)`, numeric `a1–a4`, parenthesized `(a)` in Extended Data). Nat Phys uses `"Figure N | "` — label word is configurable. Caption placement (below figure), width = figure width, and **two-column caption flow under full-width figures**.
- Table style: caption **above** with `"Table N | "` pipe convention, tinted header band, horizontal rules only, optional zebra striping, units-in-parentheses second header row, superscript-letter footnotes (a–d) resolved below at ~6.5 pt. Must also accept **author-supplied pre-typeset table blocks verbatim** (LaTeX/Computer Modern Extended Data Table 1 placed under a journal-styled caption).
- Equation numbering: centered display equations, right-aligned `(N)`, **continuous numbering across Results and Methods** (no per-section reset), stacked multi-line forms sharing one number.
- Citation style: see §4 — fully declared in the profile.
- Brand tokens: `colors.accent` (teal masthead/footer — Nat Astron), `colors.link` (blue for every hyperlink class: citations, DOIs, URLs, e-mails, Fig./Table/equation cross-refs), `colors.banner` (indigo — Nat Phys), badge asset paths (OA padlock, Check-for-updates/CrossMark, ORCID glyph, envelope glyph).
- Special namespaces: `Extended Data Fig. N` / `Extended Data Table N` / `Box N` / `Figure BN` — each an independent numbering series with its own cross-reference and placement rules (in-document one-per-page vs external link-out; both observed).
- Box/sidebar environment (Nat Phys): full-width tinted panel, `"Box N | Title."` bold sans heading, independent internal two-column text flow, internal figure series (`Figure B1`).

### 1.6 Generalization notes (Nature-specific vs portable)

**Portable to Science / ApJ / MNRAS (build as core engine features):**
- Page geometry + two-column justified body with float placement at column/page top.
- Heading-hierarchy declaration, section-ordering-as-data, required/optional section lists.
- Caption format strings, table style declaration, figure width presets (single/double column).
- Pluggable citation processor (numeric-superscript is one mode; see §4 — ApJ/MNRAS need author-year, Science needs parenthetical italic numerals).
- Reference-list format strings (CSL-like), link styling tokens.
- Display-equation numbering policy (continuous vs per-section — must be a switch; ApJ resets differently).
- Author/affiliation renderer, ORCID glyphs, corresponding-author marking (now universal).
- Data/Code availability sections (now required nearly everywhere).

**Nature-specific (implement as profile content, do not bake into the engine):**
- Extended Data namespace and its one-per-page back-matter placement / external-DOI link-out.
- Methods-after-Discussion placement with run-in sub-subheads; unheaded Introduction and unheaded Abstract (ApJ/MNRAS use labeled, numbered sections; ApJ has no end-Methods).
- "Additional information" boilerplate block, Check-for-updates badge, article-history rail, masthead bands, standfirst/drop-cap (Nat Phys), Box environments, per-page copyright line, alternating branded running heads.
- `"Fig. N |"` pipe caption convention and bold-panel-letter prose style (ApJ uses "Figure N." with different conventions).

---

## 2. Canvas Requirements (Ranked)

Ranked by frequency of appearance across the 24 figures analyzed. **V1 = required to reproduce the majority of observed figures; V2/V3 = required for full coverage.**

### Must-have V1

1. **Math-capable rich text everywhere** (appears in ~100% of figures): axis titles, tick labels, legends, annotations, colorbar titles, panel titles. Greek letters, multi-level sub/superscripts (*r*<sub>eff,gas</sub>, *Q*<sub>thick,crit</sub>), overbars (ν̄, b b̄, mean-SNR), ×10ⁿ notation, M⊙, ≈ ≳ ≤ ± :=, unit exponents (cm⁻² s⁻¹ sr⁻¹), quantum-number notation (7₇,₁–6₆,₁). This is the single most pervasive requirement.
2. **Multi-panel grid composition with lettered panels** (~20/24 figures): bold lowercase letters at consistent offsets; hierarchical sub-labels a(i)/a(ii) and a1–a5; irregular grids (a center cell spanning rows/cols reserved for a non-plot inset — Fig. 1 of the sugar paper); mixed panel widths under one figure; snapping/alignment across rows and columns.
3. **Axis system**: linear, log (up to 7 decades, 10ⁿ tick labels), semi-log, log-log, symlog, **reversed axes**, minor ticks, per-panel independent ranges within shared grids, **shared spanning axis titles** (one rotated y-label / one centered x-label for a whole grid), rotated y-titles, comma-thousands and scientific tick formatting.
4. **Line/step/curve traces**: step-histogram traces with translucent area fill to baseline; overlaid smooth curves in semantic colors (red = fit, blue = total model); solid/dashed/dotted as a *semantic* channel independent of color; curve families (5-color ordered ramps) with markers and inline end-of-curve labels; moving-average and background-fit overlays.
5. **Scatter with error bars**: categorical marker styling (filled square/circle/diamond, ×, +, open vs filled), symmetric X and Y error bars, Poisson error bars, upper-limit arrows, semi-transparent two-class point clouds, per-point color bound to a colorbar.
6. **Legends**: framed and unframed; mixed entry types (line sample, marker, filled swatch, hatched swatch, contour swatch); in-panel, outside-right, top-centered, and **two independent legends in one plot** (color legend + line-style legend, Nat Phys Fig. 6); semi-transparent rounded legend boxes over images.
7. **Raster image embedding with vector overlays** (all 4 papers): imported astronomical composites, planet photo basemaps (clipped to circles), 3D chemistry/CAD renders, event displays — layered *under* vector annotation: circles/ellipses with independent stroke/dash/no-fill, contour polyline sets imported from data, text labels with leader lines, credit-line text support.
8. **Heatmap/colormap layers + colorbars**: pixel maps and spectrograms with diverging (red–white–blue), sequential, rainbow, and dual-ended colormaps; log and symlog color scales; colorbars in horizontal-below, horizontal-top, horizontal-bottom, and vertical-right orientations with tick labels, end-cap range labels, and math-formatted titles.
9. **Semi-transparent shaded regions**: confidence bands following curves (±1σ envelopes that blend where red/blue overlap), horizontal/vertical shaded reference bands and event intervals with labels, large soft background region shading with labels ("Adiabatic"/"Main").
10. **Reference/annotation lines**: dashed/dotted thresholds, decision boundaries, model-fit lines with legend labels, inline numeric labels along contour lines, horizontal reference lines carrying inline legend text (*Q*<sub>thick,crit</sub> = 0.67).
11. **Free annotations**: colored/italic in-plot text ("IceCube preliminary"), rotated (90°) text anchored to data coordinates, boxed/framed text labels containing math, leader-line callouts, per-panel stat annotations above axes, glyph annotations (asterisks) at arbitrary positions.
12. **Export presets**: single-column (~88–89 mm) and double-column (~180–183 mm) canvas presets; SVG export with fonts embedded/outlined so 6–8 pt labels survive print; consistent sans label font across all figures.

### V2

13. **Small-multiple factories**: replicate a panel template into 6×6, 6×2, 4×3, 5×4 grids with per-stamp ID text, per-row color themes, per-column bold titles and parameter text blocks, selective highlight borders, a scale bar in one stamp that "applies to all".
14. **Secondary/dual axes**: right-hand y-axis with independent scale and independently colored spines/labels; top x-axis as a nonlinear transform of the bottom axis (T vs 1000/T); multi-row composite tick labels (UTC + X/Y/Z coordinate rows under one time axis).
15. **Hatch-pattern fills**: diagonal hatching as overlay uncertainty bands atop solid fills; hatched glyphs (beam ellipses).
16. **Zoom insets and connector lines**: magnified sub-region inset boxes with leader/connector lines to the parent region; standalone mini-plot insets (trajectory diagrams) beside/inside panels; arrow connectors *between* panels.
17. **Sky/WCS and projection axes**: RA/Dec axes with sexagesimal tick labels (10 h 01 m 04 s, 2° 22′); Mollweide/Hammer all-sky projection with graticule and coordinate edge labels; per-point marker glyphs carrying small numeric ID labels.
18. **Freeform schematic drawing**: smooth curved field lines, curved arrows with heads, glow/halo effects, endpoint dots, dimension-style depth-scale annotations — mixed with quantitative axes in the same figure (magnetosphere schematics, IceCube cutaway).
19. **Composite sub-panels sharing an axis** inside one lettered panel (CDF bars + radial profile sharing Y; Fig. 4a of the RPS paper); overlapping semi-transparent bar/CDF charts with error bars.
20. **Layer management**: grouping, z-order, clipping (data clipped to axes, images clipped to shapes), lockable base layers.

### V3 / later

21. **Custom composite glyphs**: nonstandard quantile plots (box + ticks + arrow whiskers + labeled percentile scale), nested 5/50/95% percentile ribbons along curves.
22. **Orbit/trajectory overlays**: ellipses/tracks with along-track timestamp labels, directional arrows, dashed projected footprints.
23. **Annular/binned spatial occurrence maps** around a central image disk with dual-ended shared colorbars.
24. **3D molecular/structure rendering** — treat as *imported* raster/vector assets with overlay annotation (numbered colored circles, curved reaction arrows, dotted bond lines); native 3D rendering is out of scope.
25. **Palette management**: color-blind-aware distinct series colors that remain distinguishable when combined with hatching.

---

## 3. Manuscript Structural Model

`manuscript.json` is the journal-agnostic source of truth. Everything the four papers' front/back matter needs must be representable. Proposed schema (illustrative, not exhaustive):

```jsonc
{
  "title": "…",                       // may contain inline math (LaTeX fragment)
  "shortTitle": "…",                  // running-head fallback
  "articleType": "article | review | letter",
  "doi": "10.1038/…",                 // assigned post-acceptance; nullable
  "openAccess": { "license": "CC-BY-4.0", "copyrightHolder": "The Author(s)", "year": 2026 },

  "authors": [{
    "id": "a1",
    "given": "Tao", "family": "Wang",
    "nativeScript": "汉字",            // CJK parenthetical gloss (observed)
    "orcid": "0000-0000-0000-0000",   // nullable; renders green glyph
    "affiliationRefs": ["af1", "af3"],
    "corresponding": true,             // multiple corresponding authors observed
    "email": "taowang@nju.edu.cn",
    "equalContribution": false,        // "These authors contributed equally"
    "deceased": false
  }],
  "affiliations": [{ "id": "af1", "text": "School of Astronomy…, Nanjing, China" }],

  "history": { "received": "2025-06-04", "accepted": "2026-05-12", "publishedOnline": "2026-06-22" },

  "abstract": { "content": "…markdown+math…" },   // word limit enforced per publisher profile, not here

  "body": [                            // ordered section tree
    { "kind": "section", "heading": null, "content": "…" },          // unheaded intro MUST be representable
    { "kind": "section", "heading": "Results", "level": "A",
      "children": [{ "heading": "…", "level": "B", "content": "…" }] },
    { "kind": "box", "label": "Box 1", "title": "The IceCube experiment.",
      "content": "…", "figures": ["figB1"] },                        // Nat Phys sidebar
    { "kind": "section", "heading": "Methods", "level": "A",
      "children": [ /* B-heads and run-in C-heads: {"level":"C-runin"} */ ] }
  ],

  "figures": [{
    "id": "fig1", "namespace": "main | extended-data | box",         // independent numbering series
    "canvasRef": "figures/fig1.svg",                                 // SVG source of truth
    "widthPreset": "single | double",
    "caption": { "title": "Sky image of CLJ1001.",                   // bold fragment
                 "body": "…with **a**, **b** panel refs…",
                 "credits": "Mercury USGS/NASA MESSENGER…",          // image-credit line
                 "abbreviations": [{ "abbr": "EM", "def": "electromagnetic" }] },
    "panels": [{ "letter": "a", "subLabels": ["i","ii"] }]           // kept in sync with canvas
  }],
  "tables": [{ "id": "tbl1", "namespace": "main | extended-data",
               "source": "native | pretypeset",                      // pretypeset = author LaTeX block verbatim
               "caption": { "title": "…" }, "footnotes": [{ "mark": "a", "text": "…" }] }],
  "equations": "numbered automatically, continuous; ids for cross-ref",

  "availability": {
    "data": "…text with live links (archive project codes, MAST/Zenodo DOIs)…",
    "code": "…GitHub/Zenodo links; software names carry citation refs…"
  },
  "backMatter": {
    "acknowledgements": "…",
    "authorContributions": "…may cross-reference figure ids…",       // hyperlinks figure numbers
    "funding": [{ "funder": "…", "grant": "…" }],
    "competingInterests": "The authors declare no competing interests.",
    "peerReview": { "statement": "…", "reviewers": ["Name"] },       // optional named reviewers
    "supplementaryInfo": { "doi": "…" }                               // pointer to external SI
  },

  "bibliography": "references.bib",     // BibTeX source of truth; see §4
  "citationsInline": "cite keys embedded in Markdown body: [@wang2025; @smith2024]"
}
```

**Rules for implementers:**
- Numbering (figures, tables, equations, references, affiliations) is **never stored** — always derived at format time per the active profile. Authors/affiliations get superscript markers from array order.
- The section tree must permit `heading: null` (unheaded intro/abstract) — do not synthesize headings.
- Three heading levels + run-in level C are needed; deeper nesting can be rejected by profile validation.
- Namespaces (`main`, `extended-data`, `box`) are first-class: cross-references like `Fig. 1b(i)`, `Extended Data Fig. 6g,h`, `Figure B1`, `Table 1`, `equation (3)` must all resolve, including compound panel targets and link-out targets (Extended Data existing only behind a DOI).
- Validation is profile-driven: required sections present, section order legal, abstract length, figure count, caption length limits.

---

## 4. Reference Handling

Source of truth is `.bib` (BibTeX). The formatter owns numbering and rendering.

### 4.1 In-text citation engine

- **Numbering by order of first appearance**, renumbered automatically on every edit.
- Superscript numeric rendering with **collation**: comma lists (`10,11`), en-dash range collapsing (`1–9`, `2–5`), attached directly to words with no space (`gas fractions12`).
- **Textual fallback forms** when the number is syntactically part of the sentence or follows a numeral: `ref. 14`, `refs. 16,17`, `(ref. 39)`, `(refs. 33,34)` — note both with and without period after "refs" appear across journals (`refs 16,17` in Nat Phys 2017); the exact token is a profile string.
- All citation numbers rendered as **blue hyperlinks** to the reference list.
- Citations must work **inside figure captions** and availability sections (software packages each carrying a citation superscript; caption credit lines citing refs 64–66).
- Pluggable citation processors for other profiles: author-year `(Wang et al. 2025)` for ApJ/MNRAS; parenthetical italic numerals `(14, 15)` for Science. Architect the engine as: cite-key → cluster → processor(profile) → rendered inline node + ordered bibliography.

### 4.2 Bibliography formatting

Nature pattern (declared in profile as a CSL-like template):

```
N. Surname, A. B. et al. Article title in sentence case. Ital. J. Abbrev. BoldVol, first–last (year).
```

- Author truncation to `et al.` after a profile-set count; `Surname, A. B.` initial format.
- Entry-type variants required: journal article; **book chapter** (`in Book Title (eds Name, A.) pages (Publisher, year)`); **preprint** (`Preprint at https://arxiv.org/abs/…` as live blue link); **dataset/software** (Zenodo DOI as live link); collaboration credit (`(for the IceCube Collaboration)`).
- Journal-name abbreviation table (ISO4-style) applied automatically from the full name in BibTeX.
- Layout: numbered list, hanging indent, two columns, ~7.5 pt, under a bold "References" A-head. Observed list sizes: 66–104 entries — no pagination assumptions.
- DOIs/URLs inside entries are blue hyperlinks; the profile's link-color token applies.

### 4.3 Cross-reference resolver (same subsystem)

One resolver handles citations *and* structural cross-refs, all styled as blue links: `Fig. 2b`, `Fig. 1b(i)`, `Table 1`, `Extended Data Fig. 4`, `Extended Data Table 1` (link-out variant when the object is external), `equation (3)`, `Box 1`, `Supplementary Figs.` (external pointer), plus DOIs, URLs, and mailto links in headers, footnotes, and availability sections.

---

## 5. Observed Figure Inventory

Journals: **NA-1** = Nat Astron (ram-pressure stripping), **NA-2** = Nat Astron (interstellar sugar), **NA-3** = Nat Astron (Mercury radiation belt), **NP** = Nat Phys (neutrino review). ED = Extended Data.

| Journal | Label | Kind | Panels | Notable elements |
|---|---|---|---|---|
| NA-1 | Fig. 1 | Annotated JWST sky image, WCS axes | 1 | Sexagesimal RA/Dec ticks; orange/red/white circles (solid+dashed); ID labels + leader lines; X-ray contours; semi-transparent legend box |
| NA-1 | Fig. 2 | Postage-stamp grid + velocity maps | 2 | ~13 cutout stamps w/ CO contours, red highlight borders, shared scale bar, beam ellipses; moment-1 diverging colormaps w/ horizontal colorbars |
| NA-1 | Fig. 3 | Scatter + phase-space diagram (full width) | 2 | XY error bars; per-point colormap + vertical colorbar; theoretical curve; dotted contours w/ inline labels; mixed marker+line legend |
| NA-1 | Fig. 4 | CDF bars + radial profile; log–log scatter | 2 | Composite sub-panels sharing Y axis; overlapping transparent bands; median lines; reference line w/ inline label; best-fit line; legend citing "Ref. 47" |
| NA-2 | Fig. 1 | 12 spectral panels around central 3D-molecule inset | 13 | Irregular grid w/ reserved center cell; grey-filled step spectra; red/blue model curves; boxed quantum-number labels; rotated species labels; shared spanning axis titles |
| NA-2 | Fig. 2 | 3D geometry renders + Arrhenius rate plots | 8 | Imported renders w/ numbered colored circles, curved arrow; secondary top x-axis (T vs 1000/T); italic panel titles; dashed/dotted series |
| NA-2 | Fig. 3 | KMC abundance time series, log y | 3 | 8-curve families w/ ±1 s.d. bands; horizontal shaded observed ranges; secondary right log axis; outside-right legend; math panel titles (ζ values) |
| NA-2 | Table 1 | Journal data table | — | Tinted header, units row, horizontal rules only, ≤ and ± values, superscript-letter footnotes |
| NA-2 | Table 2 | Small ratio table | — | Same styling; ~ and ≥ symbols; one-line footnote |
| NA-2 | ED Fig. 1 | 6×6 spectral mini-panel grid | 36 | Same vocabulary as Fig. 1 at small scale; heterogeneous per-panel y ranges; blue asterisk flags; two-column caption |
| NA-2 | ED Table 1 | Pre-typeset LaTeX table | — | Computer Modern, booktabs rules, bold emphasized rows — accepted verbatim under journal caption/footnote |
| NA-3 | Fig. 1 | Schematics + spectrograms + time series + trajectory | 7 | a(i)/a(ii)/a(iii) sub-panels; rainbow + symlog diverging colorbars; 4-trace magnetometer plots; shaded intervals; connector lines between panels; planet basemap |
| NA-3 | Fig. 2 | Bar chart, dual-axis series, histograms, fits, small multiples | 5 | Dual colored y-axes; overlapping step histograms; semi-log scatter w/ model-fit lines (P labels); 6×2 small-multiple grid + circular trajectory insets; inter-panel arrow |
| NA-3 | Fig. 3 | Quantile glyphs, annular maps, spectra, stacked histograms | 7 | Custom box+tick+arrow quantile glyphs; annular occurrence maps around planet image; dual-ended shared colorbar; diverging residual maps; reversed axis; mean±s.d. annotations |
| NA-3 | Fig. 4 | Simulation maps + physics schematic + curve families | 8 | Labeled region shading; dashed drift shells; zoom inset w/ connectors; schematic w/ top colorbar (κ = √(R_c/r_g)); 4 panels of 5-color curve families w/ inline end labels |
| NA-3 | ED Fig. 1 | Schematic + two line plots | 3 | Planet disk w/ field-line curves; shaded bounce-unstable zone; log y line plots w/ shaded edge bands, along-curve arrows |
| NA-3 | ED Fig. 2 | SNR diagnostics grid | 12 | a1–a4/b1–b4/c1–c4 labels; overlay fits; event-boundary lines; per-panel stat annotations (overbar notation, Pearson r); ISO datetimes in axis labels |
| NA-3 | ED Fig. 3 | Classification scatter + histograms | 4 | Two-class transparent point clouds; decision boundary; HSS in titles; threshold lines on histograms |
| NA-3 | ED Fig. 4 | \|B\| heatmaps + line-profile grid | 9 | Rainbow heatmaps w/ shared vertical log colorbar; planet overlay; dashed graticule; two-line colored column titles; right-margin coordinate legends |
| NA-3 | ED Fig. 5 | Loss-fraction small multiples | 20 | 5×4 grid; row color themes; bold column headers; per-column italic parameter blocks; top marker+linestyle legend; axis arrows on spines |
| NA-3 | ED Fig. 6 | Mission-comparison composite | 8 | Two-column layout w/ dated titles; dual-axis traces; multi-row UTC+XYZ tick tables; Poisson error bars; spectrogram; percentile ribbons; orbit-ellipse overlays |
| NA-3 | ED Table 1 | Simulation-parameters table | — | Grey bold header band, zebra striping, horizontal rules only, ± cells, bold pipe title above |
| NP | Figure B1 | Box-internal schematic pair | 2 | Cutaway w/ depth-scale annotations, leader-line callouts, scale silhouette; exploded 3D render w/ ~8 callouts; sits on tinted box background |
| NP | Figure 1 | Event-display raster pair | 2 | Dark 3D renders; color = arrival time, size = photon count; wireframe geometry; double-column width; bold sans panel letters above panels |
| NP | Figure 2 | Stepped-histogram spectrum, log-log | 1 | Outline + filled histograms; data crosses w/ error bars; framed legend; red "IceCube preliminary" annotation |
| NP | Figure 3 | Stacked histograms + hatched bands, log-log | 1 | Stacked fills; diagonal-hatch uncertainty overlays; solid+dashed power-law fits; abbreviation defs at caption end |
| NP | Figure 4 | All-sky Mollweide map + colorbar | 1 | Elliptical projection, graticule, Galactic labels; + and × markers w/ numeric event IDs; continuous colormap; horizontal colorbar w/ math title |
| NP | Figure 5 | Multi-series flux plot, log-log | 1 | ~7 decades in x; theory curves; open/filled data points w/ error bars; shaded confidence band; upper-limit arrow; italic annotation |
| NP | Figure 6 | Exclusion-limit plot, log-log | 1 | ~8 curves keyed by color AND dash pattern; filled translucent regions; **two independent legends** (color vs line style); overbar math in legend entries |

**Totals for prioritization:** 24 figure objects, 4 native tables + 2 pre-typeset, 128+ individual panels. Multi-panel figures: 17/24. Figures embedding raster imagery: 10/24. Figures requiring log axes: 14/24. Figures with shaded bands/regions: 15/24. Every figure requires math text; every caption requires the bold-label + bold-title + bold-panel-letter micro-format.