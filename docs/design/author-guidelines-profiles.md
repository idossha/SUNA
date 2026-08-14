oritative formatting source; IOP defers to them.",
      "The ApJL '5-6 page limit' seen in web summaries is third-party and excluded; official page states word/figure limits only, no longer compulsory."
    ]
  },
  "citations": {
    "mode": "author-year",
    "textualTokens": { "ref": "ref.", "refs": "refs" },
    "sortOrder": "alphabetical",
    "collation": { "value": null, "notStated": true, "note": "n/a (author-year mode); no numeric collation rules." },
    "inTextAuthorYear": {
      "value": {
        "includeInitials": true,
        "twoAuthorJoiner": "&",
        "etAlFromNAuthors": 3,
        "threeAuthorFirstMentionFull": false,
        "sameYearSuffixes": true,
        "multiCiteSeparator": null
      },
      "note": "'(G. E. Hale 1929)' — first initial(s) + last name + year, no comma before date; '(G. B. Press & W. H. Rybicki 1992)'; 3+ authors: '(A. A. Goodman et al. 2003)'. natbib \\citep/\\citet with latest aasjournal.bst required; multi-cite separator not stated."
    },
    "entryTemplates": {
      "journalArticle": {
        "value": "{authors} {year}, {journalAbbrev}, {volume}, {firstPage}, doi:{doi}",
        "note": "Example: 'Martín, E. L., Rebolo, R., & Zapatero Osorio, M. R. 1996, ApJ, 469, 706, doi:10.1086/177817'."
      },
      "book": { "value": null, "notStated": true, "note": "No book example on the official references page extract." },
      "preprint": {
        "value": "{authors} {year}, arXiv e-prints, arXiv:{id}, doi: {doi}",
        "note": "Preprints citable only for manuscripts not yet published."
      },
      "datasetOrSoftware": {
        "value": "{author} {year}, {title}, {version}, {publisher}, {prefix}:{identifier}",
        "note": "Cite both the canonical paper and a DOI to the artifact where possible. Example: 'Corrales, L. 2015, dust: ..., v1.0, Zenodo, doi:10.5281/zenodo.15991'."
      }
    },
    "refListAuthors": {
      "value": { "etAlAllowed": true, "truncateWhenMoreThan": 5, "keepFirstN": 3 },
      "note": "List alphabetical by first-author surname; same authors chronological; same year gets 2025a/2025b; 'et al.' entries grouped last, as if the fourth author started with 'z'."
    },
    "journalAbbreviation": { "value": { "policy": "ads-bibcodes" }, "note": "'Except in rare instances (e.g., Icarus)'." },
    "doi": { "value": { "requiredFor": ["all-when-available"], "format": "written in full with 'doi:' or 'https://doi.org/' prefix" } },
    "maxReferences": {
      "value": null, "notStated": true,
      "note": "None stated for ApJ/ApJL/AJ/ApJS. RNAAS: references COUNT toward the 1,500-word total (see rnaas wordLimit)."
    },
    "disallowedCitationTargets": { "value": ["preprint-when-published-version-exists"] },
    "citationsAllowedInAbstract": { "value": null, "notStated": true }
  },
  "figureRules": {
    "widthPresetsMm": {
      "value": null, "notStated": true,
      "note": "No mm presets on the Graphics Guide. Implied: raster figures need >=1000 px horizontal at 300 dpi (~85 mm single column); interactive-figure viewport 650 px; AASTeX \\plotone fits body-text width, \\gridline/\\fig accept fractional widths."
    },
    "maxHeightMm": { "value": null, "notStated": true },
    "minFontPt": { "value": 6 },
    "maxFontPt": { "value": null, "notStated": true },
    "targetFontPt": { "value": null, "notStated": true },
    "fontFamilies": { "value": { "styleClass": "any-common", "preferred": ["Times", "Helvetica", "Symbol"] } },
    "lineWeightPt": {
      "min": { "value": 0.5 },
      "max": { "value": null, "notStated": true }
    },
    "palette": {
      "requirement": "colorblind-safe-recommended",
      "suggestedHex": { "value": null, "notStated": true },
      "suggestedRamps": { "value": ["viridis", "cubehelix"], "note": "Recommended colorblind-safe palettes; check with Color Oracle." },
      "redGreenCombination": { "value": null, "notStated": true },
      "colorSoleDelimiterAllowed": {
        "value": false,
        "note": "Color must not be the only distinguishing delimiter: colored lines also need distinct line styles, colored symbols distinct shapes, colored histograms distinct hatching/weights."
      },
      "colorMode": { "value": null, "notStated": true }
    },
    "formats": {
      "vector": { "value": { "preferred": ["eps", "pdf"] } },
      "raster": { "value": { "accepted": ["png", "jpg", "tiff"], "minDpi": 300, "maxDpi": null }, "note": "Minimum 300 DPI on the final PDF page AND >=1000 px horizontal resolution." },
      "maxFileSizeMb": { "value": null, "notStated": true },
      "textMustRemainEditable": { "value": null, "notStated": true }
    },
    "captionWordLimit": { "value": null, "notStated": true, "note": "RNAAS: captions count toward the 1,500-word total." },
    "requiredElements": { "value": null, "notStated": true },
    "panelLabel": {
      "case": { "value": null, "notStated": true, "note": "AAS template practice is lowercase (a), (b); official page silent." },
      "weight": { "value": null, "notStated": true },
      "fontPt": { "value": null, "notStated": true },
      "wrapper": { "value": null, "notStated": true },
      "placement": { "value": "letter inside the box around the figure, not outside" }
    }
  },
  "manuscriptRules": {
    "titleLimitChars": { "value": null, "notStated": true },
    "runningHeadLimitChars": { "value": 44, "note": "Short title / running head 'not more than 44 characters'." },
    "abstractStructured": { "value": false },
    "articleTypes": [
      {
        "id": "apj-article", "name": "ApJ Article",
        "wordLimit": { "value": null, "notStated": true, "note": "No length, figure-count, or reference-count limit stated." },
        "abstractWordLimit": { "value": 250 }
      },
      {
        "id": "apj-letter", "name": "ApJ Letters",
        "wordLimit": { "value": { "max": 3500, "scope": "main text, excl. acknowledgments, appendices, supplementary", "hard": false } },
        "abstractWordLimit": { "value": 250 },
        "maxDisplayItems": { "value": 5, "note": "Combined figures + tables, e.g. 3 figures and 2 tables. Limits 'no longer intended to be compulsory' — Scientific Editor discretion." },
        "maxPanelsPerFigure": { "value": 9 }
      },
      {
        "id": "rnaas", "name": "Research Notes of the AAS",
        "wordLimit": { "value": { "max": 1500, "scope": "total, INCLUDING references and captions", "hard": true } },
        "abstractWordLimit": { "value": 150 },
        "maxDisplayItems": { "value": 1, "note": "A single figure OR table, not both." }
      }
    ],
    "requiredSections": {
      "value": [
        { "id": "title-page", "heading": null },
        { "id": "abstract", "heading": "Abstract" },
        { "id": "body", "heading": null, "note": "Figures/tables integrated in the text; no longer required at the end." },
        { "id": "acknowledgments", "heading": "Acknowledgments", "note": "With author contributions, facilities, and software sections — after body, before bibliography." },
        { "id": "appendices", "heading": null },
        { "id": "references", "heading": "References" }
      ],
      "note": "Each author needs an \\email command (AASTeX v7)."
    },
    "forbiddenFeatures": { "value": ["images-for-tables", "images-for-equations"] },
    "availability": {
      "data": { "value": null, "notStated": true, "note": "No dedicated Data Availability section stated as required; data/software citation rules live on the References and Data Guide pages." },
      "code": { "value": null, "notStated": true },
      "materials": { "value": null, "notStated": true },
      "placement": { "value": null, "notStated": true }
    },
    "keywords": { "value": null, "notStated": true },
    "submissionFormat": {
      "spacing": {
        "value": null, "notStated": true,
        "note": "AASTeX default: 10 pt single-spaced single column; 'manuscript' option gives 12 pt double-spaced; Word template Courier New 10 pt at 1.5 spacing (Times New Roman 12 / Calibri 12 also allowed). No standalone spacing rule."
      },
      "lineNumbers": {
        "value": true,
        "note": "REQUIRED for submission and revision: AASTeX v6+ 'linenumbers' style option, other LaTeX via lineno.sty. Exception: RNAAS must NOT use line numbers."
      },
      "fileTypes": {
        "initial": { "value": ["tex (AASTeX v7; Overleaf accepted)", "doc", "docx"] },
        "final": { "value": ["tex (AASTeX v7)", "doc", "docx"] }
      },
      "latexClass": { "value": "aastex v7 (+ aasjournal.bst, natbib \\citep/\\citet)" },
      "language": { "value": null, "notStated": true }
    }
  }
}
```

### 2.4 `mnras.json`

```json
{
  "meta": {
    "profileId": "mnras",
    "journalName": "Monthly Notices of the Royal Astronomical Society (MNRAS)",
    "publisher": "Royal Astronomical Society / Oxford University Press",
    "lastVerified": "2026-08-13",
    "sourceUrls": {
      "citations": ["https://academic.oup.com/mnras/pages/general_instructions"],
      "figures": ["https://academic.oup.com/mnras/pages/general_instructions"],
      "manuscript": [
        "https://academic.oup.com/mnras/pages/general_instructions",
        "http://www.ctan.org/tex-archive/macros/latex/contrib/mnras"
      ]
    },
    "scopeNotes": [
      "Current official page's in-text citation examples INCLUDE first initials ('(J. Brown 1999)'), unlike the legacy mnras.bst output ('Brown 1999') — verified three times verbatim.",
      "MNRAS Letters (academic.oup.com/mnrasl) instructions mirror this page. Fully Open Access (CC BY); APCs: Papers £2,356, Letters £1,122 non-members."
    ]
  },
  "citations": {
    "mode": "author-year",
    "textualTokens": { "ref": "ref.", "refs": "refs" },
    "sortOrder": "alphabetical",
    "collation": { "value": null, "notStated": true, "note": "n/a (author-year mode)." },
    "inTextAuthorYear": {
      "value": {
        "includeInitials": true,
        "twoAuthorJoiner": "&",
        "etAlFromNAuthors": 4,
        "threeAuthorFirstMentionFull": true,
        "sameYearSuffixes": true,
        "multiCiteSeparator": "; "
      },
      "note": "Harvard style: '(J. Brown 1999)'; 'J. Brown & P. Jones (1991)'; three authors all at first mention '(J. Brown, P. Jones & A. Smith 1994)' then 'J. Brown et al. 1994' (et al. roman, not italic); >3 authors always et al. Same-author years collate '(J. Brown 1992, 1995)'; same-year 'A. Smith et al. (2000a,b)'; multiple citations separated by semicolons."
    },
    "entryTemplates": {
      "journalArticle": {
        "value": "{authors}, {year}, {journalAbbrev}, {volume}, {firstPage}",
        "note": "Example: 'Eke V., Cole S., Frenk C.S., 1996, MNRAS, 282, 263'. No bold/italic; no commas after surnames; no ampersand between final two names."
      },
      "book": {
        "value": "{authors}, {year}, {title}. {publisher}, {place}",
        "note": "Example: 'Peebles P. J. E., 1980, The Large-Scale Structure of the Universe. Princeton Univ. Press, Princeton, NJ'."
      },
      "preprint": { "value": "{authors}, {year}, preprint (arXiv:{id})", "note": "Example: 'Smith P. et al., 2013, preprint (arXiv:0123.45678)'." },
      "datasetOrSoftware": {
        "value": "{author}, {year}, Astrophysics Source Code Library, record ascl:{id}",
        "note": "Full citation in reference list when in an online source."
      }
    },
    "refListAuthors": {
      "value": { "etAlAllowed": true, "truncateWhenMoreThan": 8, "keepFirstN": 1 },
      "note": "'List all of the authors if there are eight or fewer, otherwise give just the first author followed by et al.' — e.g. 'Pounds K. A. et al., 1993, MNRAS, 260, 77'."
    },
    "journalAbbreviation": {
      "value": { "policy": "custom-list" },
      "note": "~20 frequent journals listed (A&A, ApJ, AJ, MNRAS, Nature, Science, PASP, PASJ, ...); otherwise IAU standard abbreviations."
    },
    "doi": { "value": null, "notStated": true, "note": "No DOI-printing requirement; reference details must be accurate because online links are generated from them." },
    "maxReferences": { "value": null, "notStated": true, "note": "'Long lists of citations ... should be avoided, unless the articles cited are directly relevant.'" },
    "disallowedCitationTargets": {
      "value": ["private-communication-in-reference-list", "in-preparation-in-reference-list"],
      "note": "Cite in the text only ('Smith (in preparation) shows that...') and omit from the reference list."
    },
    "citationsAllowedInAbstract": { "value": null, "notStated": true }
  },
  "figureRules": {
    "widthPresetsMm": {
      "value": { "singleColumn": 80 },
      "note": "'approx. 80 mm wide, or 3.15 inches'. No full-text-width (two-column) dimension stated."
    },
    "maxHeightMm": { "value": null, "notStated": true },
    "minFontPt": { "value": null, "notStated": true },
    "maxFontPt": { "value": null, "notStated": true },
    "targetFontPt": { "value": 8, "note": "'sized appropriately for the figure and its likely final size of around font size 8 point'." },
    "fontFamilies": {
      "value": { "styleClass": "any-common", "preferred": ["Times", "Arial", "Helvetica"] },
      "note": "All fonts and logos must be embedded in the figure file."
    },
    "lineWeightPt": {
      "min": { "value": 0.3, "note": "'not less than 0.3 pt at final size'; must withstand significant reduction." },
      "max": { "value": null, "notStated": true }
    },
    "palette": {
      "requirement": "colorblind-safe-recommended",
      "suggestedHex": { "value": null, "notStated": true },
      "suggestedRamps": { "value": ["ColorBrewer"], "note": "Recommended tools: ColorBrewer and Color Oracle." },
      "redGreenCombination": { "value": "avoid", "note": "'The use of red and green in the same figure is particularly problematic for some readers.'" },
      "colorSoleDelimiterAllowed": { "value": null, "notStated": true },
      "colorMode": { "value": null, "notStated": true, "note": "No RGB/CMYK rule; no colour charges (fully Open Access)." }
    },
    "formats": {
      "vector": {
        "value": { "preferred": ["eps"], "accepted": ["pdf", "tiff"] },
        "note": "EPS: include PC preview/header, crop tightly, embed all fonts/logos. Simple filenames ('fig6.eps'). Bitmapped elements inside vector files: >=400 dpi effective at final printing."
      },
      "raster": {
        "value": { "accepted": ["tiff"], "minDpi": 300, "maxDpi": null },
        "note": "300 ppi for grey-scale/half-tone (photos), 800 ppi for combined line/tone at final size — an 80 mm figure needs >=945 px (photo) or ~2500 px (line/tone)."
      },
      "maxFileSizeMb": { "value": 10, "note": "Initial submission: single file <=10 MB with figures included; supplementary material <=350 MB combined, published as supplied." },
      "textMustRemainEditable": { "value": null, "notStated": true }
    },
    "captionWordLimit": { "value": null, "notStated": true },
    "requiredElements": {
      "value": ["border-on-all-sides", "fiducial-marks-on-every-border", "axis-labels-with-units"],
      "note": "Refer to own figures as 'Fig. 1'/'Table 1' (lowercase for other papers'); every figure/table numbered, captioned, cited in numerical order, placed at logical points in the text."
    },
    "panelLabel": {
      "case": { "value": "lower" },
      "weight": { "value": null, "notStated": true },
      "fontPt": { "value": null, "notStated": true },
      "wrapper": { "value": "parentheses", "note": "'labels (a), (b) etc. should be added as appropriate'." },
      "placement": { "value": "embedded in the graphics file itself — not added via LaTeX code (figures are processed separately)" }
    }
  },
  "manuscriptRules": {
    "titleLimitChars": { "value": null, "notStated": true, "note": "'Titles should be informative, and obscure acronyms should be avoided'; attention-seeking content may be removed by the editor." },
    "runningHeadLimitChars": { "value": null, "notStated": true, "note": "A running head is used; no character limit stated." },
    "abstractStructured": { "value": false, "note": "Single paragraph, unstructured. Corrections have no abstract." },
    "articleTypes": [
      {
        "id": "paper", "name": "Paper",
        "wordLimit": { "value": null, "notStated": true, "note": "'There are no page limits, but it is important for Papers to be concise.'" },
        "abstractWordLimit": { "value": 250, "note": "'normally of not more than 250 words'." }
      },
      {
        "id": "letter", "name": "Letter",
        "abstractWordLimit": { "value": 200 },
        "pageLimit": { "value": 5, "note": "Title, author list, affiliations, abstract, keywords, data availability statement, acknowledgements and references NOT included in the page limit." }
      }
    ],
    "requiredSections": {
      "value": [
        { "id": "title-page", "heading": null, "note": "Title, authors, affiliations, correspondence." },
        { "id": "abstract", "heading": "Abstract" },
        { "id": "keywords", "heading": "Key words" },
        { "id": "introduction", "heading": "Introduction", "note": "First numbered section." },
        { "id": "conclusions", "heading": "Conclusions", "note": "Last numbered section." },
        { "id": "acknowledgements", "heading": "Acknowledgements", "note": "Un-numbered endmatter." },
        { "id": "data-availability", "heading": "Data availability" },
        { "id": "references", "heading": "References" },
        { "id": "appendices", "heading": null, "note": "At the end, after references." }
      ],
      "note": "Numbered sections/subsections; numbered equations; figures/tables cited in order."
    },
    "forbiddenFeatures": {
      "value": ["table-cell-shading-or-colouring"],
      "note": "'cannot be supported in the web version' — use bold text or superscript symbols instead."
    },
    "availability": {
      "data": { "value": "required", "note": "'The inclusion of a Data Availability Statement is a requirement for articles published in MNRAS.'" },
      "code": { "value": null, "notStated": true },
      "materials": { "value": null, "notStated": true },
      "placement": { "value": "endmatter, after the Acknowledgements, under the heading 'Data availability'" }
    },
    "keywords": { "value": { "min": 1, "max": 6, "controlledList": "MNRAS key words list" } },
    "submissionFormat": {
      "spacing": { "value": "single", "note": "'Papers should be formatted with two columns (except the abstract) and single line spaced.'" },
      "lineNumbers": { "value": null, "notStated": true, "note": "Not mentioned on the official page." },
      "fileTypes": {
        "initial": { "value": ["pdf", "ps", "doc", "rtf", "txt"], "note": "Single file with all figures and tables, <=10 MB." },
        "final": {
          "value": ["zip/tar.gz of .tex + .eps + .bib (LaTeX)", "doc/docx + figure files (Word)"],
          "note": "'First Look' source files after acceptance. Revisions: changes highlighted (bold or colour); Overleaf submission supported."
        }
      },
      "latexClass": { "value": "mnras.cls (CTAN: macros/latex/contrib/mnras); Overleaf template available" },
      "language": {
        "value": "en-GB",
        "note": "British spellings: 'centre', 'sulphur', 'acknowledgements', 'artefact', 'best-fitting', 'disc', 'haloes', 'time-scale'. Units: SI + astronomy units, roman type, non-breaking space ('200 keV'), 'km s−1' not 'km/s'; scalars italic, vectors bold italic."
      }
    }
  }
}
```

---

## 3. Compliance checker rule list

**Global policy** (applies to every rule):

- **Suppression:** a rule whose governing field is `{ value: null, notStated: true }` emits **nothing** — no diagnostic, no default enforcement.
- **Severity derivation:** `hard: true` / unhedged stated limits → **error**; `hard: false`, hedged phrasing, or umbrella/flagship-sourced values (per-field `sourceUrl` differing from journal pages) → **warning**.
- **Provenance:** every diagnostic carries a "why?" affordance showing the governing field's `note` and `sourceUrl`.
- Errors block the export dialog's "final submission" path (overridable with acknowledgment); warnings never block.

### Citation & reference rules (bib checker)

| ID | Diagnostic | Governing field | Severity | Surfaces |
|---|---|---|---|---|
| CIT-001 | Reference count exceeds per-type limit (Nature Article >50 main-text; Science Perspective >15; Science Review >150) | `citations.maxReferences[type]` | warning (`hard:false`) / error (`hard:true`) | manuscript editor (status bar), export dialog |
| CIT-002 | Methods-scope reference allocation exceeded (Nature: separate 50 for Methods) | `citations.maxReferences[type]` scope `methods` | warning | manuscript editor |
| CIT-003 | Citation cluster inside the abstract (Nature "unreferenced"; Science ban) | `citations.citationsAllowedInAbstract = false` | error | manuscript editor |
| CIT-004 | Entry cites a disallowed target: in-press-at-publication, personal communication, in-preparation, grant details as numbered ref | `citations.disallowedCitationTargets` | error | manuscript editor, export dialog |
| CIT-005 | Literal "et al."/"and others" in author data where full lists are mandatory (Science) | `citations.refListAuthors.etAlAllowed = false` | error | manuscript editor (bib panel), export dialog |
| CIT-006 | Author list not truncated per policy in rendered list (>5 → 1+et al. Nature; >5 → 3+et al. ApJ; >8 → 1+et al. MNRAS) — renderer autofixes; diagnostic fires only on user-overridden entries | `citations.refListAuthors` | warning (autofix) | bib panel |
| CIT-007 | Missing DOI where required (ApJ: all when available; Nature: datasets/code; Science: epub-ahead-of-print) | `citations.doi.requiredFor` | warning | bib panel, export dialog |
| CIT-008 | DOI format mismatch (ApJ needs `doi:` or `https://doi.org/` prefix written in full; Nature datasets need full-URL form) | `citations.doi.format` | warning | bib panel |
| CIT-009 | Journal name not abbreviated per policy (ApJ: ADS bibcode; MNRAS: journal list/IAU; Nature: common usage) | `citations.journalAbbreviation.policy` | warning | bib panel |
| CIT-010 | Entry missing a template-required field (article title for Nature long-form; publisher for Nature books; version+repository for datasets) or carrying a forbidden one (title present in Nature short-form types) | `citations.entryTemplates.*` | warning | bib panel, export dialog |
| CIT-011 | Same work cited under two keys / two numbers, or two works share one number | `citations.numbering.onePerNumber` | error | manuscript editor |
| CIT-012 | Reference list order mismatch (appearance vs. alphabetical; MNRAS/ApJ et-al grouping) — renderer-enforced; fires only on manual list edits | `citations.sortOrder` | error | export dialog |
| CIT-013 | Preprint cited although a published version exists in the library (ApJ) | `citations.disallowedCitationTargets` | warning | bib panel |
| CIT-014 | Self-citation share exceeds cap (Science Reviews/Analytical Reviews <20%) | `citations.maxReferences[type][].maxSelfCitationPercent` | warning | manuscript editor, export dialog |

### Figure rules (canvas checker; some re-run at export)

| ID | Diagnostic | Governing field | Severity | Surfaces |
|---|---|---|---|---|
| FIG-001 | Artboard width matches no preset (±0.5 mm) — e.g. 100 mm artboard under Nature's 88/180 | `figureRules.widthPresetsMm` | warning | figure canvas, export dialog |
| FIG-002 | Figure height exceeds caption-tier maximum (Nature: >130 mm single-column with a 250-word caption) | `figureRules.maxHeightMm` + caption word count | warning | figure canvas |
| FIG-003 | Text element below minimum size at final scale (Nature <5 pt; Science <6 pt; ApJ <6 pt) | `figureRules.minFontPt` | error | figure canvas, export dialog |
| FIG-004 | Text element above maximum size (Nature >7 pt except 8 pt panel letters; Science >9 pt) | `figureRules.maxFontPt` | warning | figure canvas |
| FIG-005 | Font family off-policy (serif label where sans required; non-preferred family) | `figureRules.fontFamilies` | warning | figure canvas |
| FIG-006 | Stroke below minimum weight (Nature 0.25 / Science 0.28 / MNRAS 0.3 / ApJ 0.5 pt) | `figureRules.lineWeightPt.min` | error | figure canvas, export dialog |
| FIG-007 | Stroke above maximum weight (Nature >1 pt) | `figureRules.lineWeightPt.max` | warning | figure canvas |
| FIG-008 | Color outside the required accessible palette (Nature: non-Wong color; suggests nearest Wong hex) | `figureRules.palette.requirement = colorblind-safe-required` + `suggestedHex` | warning | figure canvas |
| FIG-009 | Red + green used as contrasting pair in the same figure | `figureRules.palette.redGreenCombination` | warning | figure canvas |
| FIG-010 | Data series distinguished by color alone (ApJ: lines need distinct dash patterns, symbols distinct shapes, histograms distinct hatching) | `figureRules.palette.colorSoleDelimiterAllowed = false` | warning | figure canvas |
| FIG-011 | Color-mode mismatch for export target (Nature Review exported RGB where CMYK stated; Science non-RGB) | `figureRules.palette.colorMode` | warning | export dialog |
| FIG-012 | Placed raster below minimum effective resolution (300 dpi all four; ApJ also <1000 px horizontal; MNRAS 800 ppi line/tone) | `figureRules.formats.raster.minDpi` | error | figure canvas, export dialog |
| FIG-013 | Figure asset in a disallowed format (PNG/TIFF as Nature main-figure line art; PowerPoint for Science) | `figureRules.formats.vector.notAccepted` | error | export dialog (import-time warning in canvas) |
| FIG-014 | Figure file exceeds size cap (Nature 50 MB main / 10 MB Extended Data; MNRAS 10 MB initial bundle) | `figureRules.formats.maxFileSizeMb` | error | export dialog |
| FIG-015 | Outlined/flattened text detected where live text required (Nature, Science) | `figureRules.formats.textMustRemainEditable` | warning | export dialog |
| FIG-016 | Panel label style mismatch — case/weight/size/wrapper (lowercase 8 pt bold for Nature; uppercase 10 pt bold upper-left for Science; parenthesized lowercase embedded for MNRAS); offers autofix | `figureRules.panelLabel.*` | warning | figure canvas |
| FIG-017 | Panel count exceeds per-figure cap (ApJL: 9) | `manuscriptRules.articleTypes[].maxPanelsPerFigure` | warning | figure canvas |
| FIG-018 | Missing required plot elements (MNRAS: border on all sides + fiducial marks + axis units; Nature: scale bar instead of magnification; Science: leading zeros, SI units in parentheses) | `figureRules.requiredElements` | warning | figure canvas |
| FIG-019 | Caption exceeds word limit (Science 200 — error; Nature 300 flagship-sourced — warning) | `figureRules.captionWordLimit` | error / warning per provenance | manuscript editor, canvas inspector |

### Manuscript rules (manuscript editor checker)

| ID | Diagnostic | Governing field | Severity | Surfaces |
|---|---|---|---|---|
| MAN-001 | Title exceeds character limit (Science 96 incl. spaces) | `manuscriptRules.titleLimitChars` | error | manuscript editor |
| MAN-002 | Running head exceeds limit (ApJ 44 chars) | `manuscriptRules.runningHeadLimitChars` | error | manuscript editor, export dialog |
| MAN-003 | Abstract over word limit for the selected article type (Nature 200; Science 125; ApJ 250/RNAAS 150; MNRAS 250/Letters 200) | `articleTypes[].abstractWordLimit` | error (warning for MNRAS "normally") | manuscript editor |
| MAN-004 | Abstract has headings or paragraph breaks where a single unstructured paragraph is required | `manuscriptRules.abstractStructured = false` | error | manuscript editor |
| MAN-005 | Main-text word count over limit (Nature Article 3,000; Science RA 3,000; ApJL 3,500; RNAAS 1,500 total) — counter uses the `scope` string to include/exclude sections | `articleTypes[].wordLimit` | warning (`hard:false`) / error (`hard:true`) | manuscript editor (status bar), export dialog |
| MAN-006 | Below stated minimum length (Nature Correspondence <300; Science Policy <2,000) | `articleTypes[].wordLimit.min` | warning | manuscript editor |
| MAN-007 | Display-item count exceeds cap (Nature Article >6; Science RA >5; ApJL >5 combined) | `articleTypes[].maxDisplayItems` | warning / error per `hard` | manuscript editor, export dialog |
| MAN-008 | Extended Data count exceeds cap (Nature 10; Matters Arising 3) | `articleTypes[].maxExtendedDataItems` | error | manuscript editor |
| MAN-009 | Required section missing (Data availability for Nature/MNRAS; Science Acknowledgments sub-statements incl. competing interests "even if none"; ApJ per-author \email) | `manuscriptRules.requiredSections`, `availability.* = required` | error | manuscript editor, export dialog |
| MAN-010 | Section order violates the stated sequence (MNRAS: Data availability after Acknowledgements, Conclusions last, appendices at end; Science: tables after references) | `manuscriptRules.requiredSections` (ordered) | warning | manuscript editor |
| MAN-011 | Forbidden feature present (Nature: footnotes; Science: paragraph break in abstract, co-first designation; MNRAS: shaded table cells; ApJ: image used as table/equation) | `manuscriptRules.forbiddenFeatures` | error | manuscript editor |
| MAN-012 | Keyword count outside range or keyword not in controlled list (MNRAS: 1–6 from official list) | `manuscriptRules.keywords` | error (count) / warning (list membership) | manuscript editor |
| MAN-013 | Spelling variant off-language (MNRAS en-GB: "center", "sulfur", "halos" flagged) | `submissionFormat.language` | warning | manuscript editor |
| MAN-014 | Abbreviations in abstract (Science) | `manuscriptRules.forbiddenFeatures` | warning | manuscript editor |
| MAN-015 | Estimated typeset length exceeds page limit (MNRAS Letters 5 pages, excluding the stated endmatter) | `articleTypes[].pageLimit` | warning (estimate-based) | manuscript editor, export dialog |

### Export preflight (export dialog checker)

| ID | Diagnostic | Governing field | Severity | Surfaces |
|---|---|---|---|---|
| EXP-001 | Chosen output format not accepted for the submission stage (PDF for Nature final; PDF-only for Science initial LaTeX; figure formats at Science revision) | `submissionFormat.fileTypes.initial/final` | error | export dialog |
| EXP-002 | Line numbers disabled where required (ApJ) — offers one-click enable | `submissionFormat.lineNumbers = true` | error | export dialog |
| EXP-003 | Line numbers enabled for RNAAS (must be off) | `submissionFormat.lineNumbers` note + article type `rnaas` | error | export dialog |
| EXP-004 | Spacing setting differs from stated requirement (Science/MNRAS single) — offers autofix | `submissionFormat.spacing` | warning | export dialog |
| EXP-005 | LaTeX export not using the stated class/template (mnras.cls; AASTeX v7; standard classes only for Nature) | `submissionFormat.latexClass` | warning | export dialog |
| EXP-006 | Profile staleness: `lastVerified` older than 12 months — prompt to re-verify against `meta.sourceUrls` | `meta.lastVerified` | info | export dialog |
| EXP-007 | Preflight summary: aggregates all unresolved CIT/FIG/MAN errors; "final submission" export requires acknowledgment of each | all | blocking summary | export dialog |