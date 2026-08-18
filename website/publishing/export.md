# Export

Turning the project into something you can submit: Word, PDF, or a self-contained web page, with figures rasterised to the journal's stated width and dpi.

Export is a tab, not a modal. Open it from the **Export…** button in the Manuscript tab toolbar (tooltip "Export as Word or PDF"), or from the command palette with **Export Manuscript (Word/PDF)…** under the Manuscript category. Those two are the only doors — there is no keyboard shortcut for it.

Nothing on this page modifies your sources. Export reads `manuscript/` and writes a new file into the project's output directory.

## The three formats

| Format | Dropdown label | What it is for |
| --- | --- | --- |
| Word | `Word (.docx)` | Submission and co-author round-trips. A real `.docx` with Word lists, figure and table bookmarks, and internal cross-reference hyperlinks. |
| PDF | `PDF` | Reading and sharing a fixed-layout copy. Rendered by Chromium from SUNA's own HTML. |
| Web page | `Web page (.html)` | One self-contained file, figures and KaTeX inlined as `data:` URIs, no external requests. Citations are links to their reference entries; cross-references are in-page links. |

DOCX is built entirely with the bundled `docx` library and PDF with Electron's `printToPDF`. Neither needs anything installed on your machine.

The PDF and the web page render in the app's active editor theme — it rides along in the export request, so a dark project exports a dark PDF. DOCX deliberately ignores the theme: a Word file is a collaboration surface, not a themed reading artifact.

::: warning Not built yet
There is no LaTeX export. SUNA has no `.tex` output path, and **Tectonic is not used and does not need to be installed** — some older design documents still describe a LaTeX/Tectonic pipeline, and they are stale. LaTeX inside your prose is handled in two narrow places only: raw-LaTeX escapes in the Markdown dialect, and a LaTeX-to-OMML converter inside the Word writer.
:::

## The form, field by field

<figure class="shot">
  <img src="/shots/export.webp" alt="The Export tab: a left column with Document, Format, Journal profile and Article type pickers, submission-format checkboxes, and a compliance check listing two errors with guideline URLs; a right column headed REQUIREMENTS showing the selected journal's stated rules." />
  <figcaption>The left column exports; the right column is the journal's own stated requirements. The compliance list in the middle is advisory — the Export button stays enabled.</figcaption>
</figure>

**Document** — `Manuscript` or `Supplementary Information`. The supplement option is only enabled when `manuscript/supplementary.md` exists; otherwise it reads `Supplementary Information (no supplementary.md)` and is greyed out.

**Format** — the three above.

**Journal profile** — defaults to the project's active profile and lists the ten profiles the pickers offer, by full journal name. If your project already points at a profile that is hidden from the pickers, the dropdown appends it so your own choice keeps showing. See [journal profiles](/publishing/profiles).

**Article type** — appears only when the selected profile declares article types. It defaults to `None — generic journal overview`, and resets to None whenever you switch journals, because article-type ids are journal-specific. Note what this control does *not* do: choosing None does not skip the compliance check. The checker falls back to the profile's first declared article type — usually its primary research-article type. None only changes which type the requirements panel spotlights.

**Output file name** — pre-filled from a slug of the manuscript's short title (or the title), with `-supplement` appended for the supplement target. The extension is shown beside the field and follows the format. A name you typed yourself is never overwritten when you switch targets.

**Submission format** — three checkboxes, `Double spacing`, `Line numbers` and `Page numbers`, all on by default. Where the journal states a position, the checkbox carries an informational tag such as "SLEEP requires this" or "*journal* says do not use", and switching profiles reseeds the default. It is a seed, never a lock: you can always override it, and a rule the journal does not state leaves your choice alone. All three are disabled for the web-page format, with the hint "The web page renders the reading layout — print options do not apply."

Below the checkboxes, the compliance check runs against the selected profile before you export. It reports "*N* errors, *M* warnings — export anyway if you choose; nothing here blocks it", or "No issues found", listing at most the first 30 diagnostics. Compliance checks are not run for the Supplementary Information target. See [compliance](/publishing/compliance) for what is actually checked.

Press **Export Word** / **Export PDF** / **Export Web page**. When it lands, the page shows `Exported → <path>`.

## Where the files land

All three formats write into the project's output directory as `<output>/<name>.docx`, `.pdf` or `.html`. That is `output/` by default, and remappable through `directories.output` in `suna.json`. Sources are never mutated.

## Figures are rasterised at export time

Every manuscript figure is converted to PNG before the document is built, and those PNGs are what land in the Word, PDF or HTML file.

Each figure is rasterised at the width preset it names for itself in `manuscript.json` (`widthPreset`), resolved against the selected profile's stated millimetres, and at the profile's stated minimum dpi — 300 when the journal states none. If the journal states no widths at all, a generic fallback is used (single 89 mm, 1.5-column 120 mm, double 180 mm) so every preset row still resolves to something.

That is separate from the canvas's own export, which writes a single figure as SVG, PDF, PNG or TIFF at a size you pick. See [the canvas](/figures/canvas).

## Typography

SUNA's house style is the always-on typographic base for every profile: US Letter (215.9 × 279.4 mm), 12.7 mm margins, Times New Roman, 11 pt body at 1.15 line spacing, 14 pt title, 13/11 pt headings, 10 pt captions and references with a 12.7 mm hanging indent, and a page break after the front matter.

A journal profile contributes only the small deltas it states — the figure label (`Figure` vs `Fig.`), whether figures sit inline or collect into a captions list, whether tables sit inline or at the end, whether references start a new page. In the shipped set only SLEEP, Nature Astronomy, MNRAS and Brain Stimulation carry any delta at all; every other journal inherits the house style whole.

Word back matter is emitted in a fixed order: Acknowledgments, Funding, Competing Interests, Data and Code Availability, Author Contributions, References.

## Supplementary Information

Selecting `Supplementary Information` produces a distinct document rather than an appendix: its own cover title and byline, a linked Contents list, S-numbered figures and tables, and an independently numbered Supplementary References list. It is built from `manuscript/supplementary.md`; if that file is missing, the export fails with an error naming the path it expected.

## Things worth knowing before you submit

Math in the Word export is real OMML for a defined LaTeX subset — fractions, scripts, radicals, greek, `\sum` and `\int` with limits, `\text` and `\mathrm`. An equation using anything outside that subset falls back whole to an italic literal, and `$…$` spans in the title, abstract and captions are always italic literals. Check the equations in the exported `.docx`.

Citation runs in the Word export are plain text, not hyperlinks. DOI and URL links inside a reference entry are real hyperlinks.

Managed tables in `manuscript.json` hold a caption and footnotes, not a cell grid, so they export as a numbered captioned block. Write the table body as a GFM Markdown table in the prose to get a real Word table.

PDF line numbers are an approximation. They are measured from the on-screen wrapped lines before Chromium paginates, so they are not pixel-perfect across every page break. Page numbers, by contrast, use Chromium's real header/footer feature.

::: warning Verify the file you are about to submit
Export has no automated end-to-end coverage yet — there is no smoke step that produces and checks a real `.pdf` under automation. Open the exported file and read it before you upload it to a submission system.
:::

## Importing a Word manuscript

If the paper already exists as a `.docx`, SUNA can turn it into a real project. Start from the Welcome tab's **Import .docx…** button, which opens a native picker titled "Import a .docx manuscript" and then opens an import review tab. Picking a file creates nothing.

The review screen shows counts for Sections, References (with how many in-text citations were mapped) and extracted Figures, editable Title / Authors / Affiliations / Abstract fields, and a Warnings list where each entry carries its warning code and message. It says so plainly: "Nothing has been written yet. Review and correct what was detected below, then Import."

Only **Import into new project…** writes anything, and it asks for a target directory first. It refuses a non-empty folder unless you tick **Import into a non-empty folder**, and refuses unconditionally — that checkbox cannot override it — when the target already contains a `suna.json`.

What it writes: `suna.json`, `manuscript/manuscript.json`, `manuscript/manuscript.md`, `manuscript/authors.json`, `manuscript/references.bib`, extracted figure files under `figures/<id>/`, and a `.gitignore`. It then runs `git init` on branch `main` and commits with the message "Import manuscript from DOCX"; if git fails, the import continues without version control. Import runs on the bundled `mammoth` and `jszip` libraries — again, no external binary.

::: warning Equations do not survive import
Word equations (OOXML OMML) are not converted. The surrounding text is kept as-is and you get one document-level warning, code `omml-equations`, saying how many equations were found and that they need manual review. Retype them as [SciMark](/writing/scimark) math.
:::
