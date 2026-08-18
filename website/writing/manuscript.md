# The manuscript

Your paper is one Markdown file plus two small JSON files. This page explains how those fit together, how the Manuscript tab edits all three at once, and why you never type "Figure 3".

## Four files, one flat folder

The `manuscript/` folder holds no subdirectories and no per-section files. Prose lives in one file; metadata and people live beside it.

| File | Holds |
| --- | --- |
| `manuscript.md` | All prose. Sections are Markdown headings. |
| `manuscript.json` | Title, running title, article type, abstract, significance, highlights, the figure and table registries, back matter. |
| `authors.json` | The byline: authors and affiliations. |
| `references.bib` | Your BibTeX library for this paper. |

Two fields in `manuscript.json` name the other files. `manuscriptFile` is the prose file and defaults to `manuscript.md`, so you can rename it if you want. `bibliography` is required and must end in `.bib`.

Comments are a fifth file, `manuscript/comments.json`, written by the comments rail rather than by hand — see [comments](/writing/comments).

## Sections are just headings

There is no section object, no ordering array, no per-section file to create. Write a Markdown heading and you have a section.

Only root-level headings count. A `#` inside a blockquote or a list item does not start a section, and a `#` inside a fenced or indented code block is code. Setext headings — a line underlined with `===` or `---` — work too, and report as level 1 and level 2.

Prose written before the first heading is the untitled leading section. It appears in the outline at level 0 and keeps its word count, but it cannot be cross-referenced.

To reference a section, use a slug of its heading text: lowercase it, replace every run of non-alphanumeric characters with a hyphen, and trim hyphens off the ends. A heading `Data and Methods` is `@sec:data-and-methods`. If two headings slug to the same string, the reference resolves to the first one.

`@sec:` always resolves to the heading *text*, never to a section number — in the app and in the export alike.

## The Manuscript tab

Open the Manuscript view from the activity bar and SUNA opens one scrollable page: the typeset title page, a single live editor over the whole of `manuscript.md`, and the reference list generated from your citations.

<figure class="shot">
  <img src="/shots/manuscript-document.webp" alt="The combined Manuscript tab: a typeset title page with title, author line with superscript affiliation markers, abstract and significance, a horizontal rule, then the manuscript prose, and a generated References list at the bottom." />
  <figcaption>One page, three parts: title page, prose, references. The rules mark the seams; everything between them is a single editor over manuscript.md.</figcaption>
</figure>

The sticky toolbar carries an unsaved-changes dot, the Source/Reading toggle (the button shows the mode you are *in*), the comments-rail toggle, an `Export…` button and the appearance gear.

| Key | Does |
| --- | --- |
| <kbd>⌘E</kbd> | Source ⇄ Reading |
| <kbd>⌘S</kbd> | Save |
| <kbd>⌘⌥M</kbd> | Toggle the comments rail |
| <kbd>⌘⇧K</kbd> | Insert a citation |
| <kbd>⌘⇧F</kbd> | Insert a figure |

This tab is also the only place where citation and cross-reference chips resolve to real numbers. Open the same `manuscript.md` in a plain editor tab and reading mode shows the raw forms instead — a citation chip reads `[key1; key2]`, a cross-reference reads `kind:id`. Nothing is wrong; that tab has no document-wide numbering to resolve against.

::: info Vim in the Manuscript tab
If you turn vim motions on, the scrolling commands <kbd>⌃d</kbd>, <kbd>⌃u</kbd>, <kbd>⌃f</kbd>, <kbd>⌃b</kbd> and `zz` / `zt` / `zb` do nothing in this tab, because the outer page scrolls rather than the editor. Cursor motions such as `G`, `gg` and `}` still scroll the view to follow you.
:::

## Editing the title page

Every field on the title page is click-to-edit in place. No modal, no separate metadata form, same typography before and after.

| Click on | Edits | Written to |
| --- | --- | --- |
| The title | Title | `manuscript.json` |
| Running title | Short title for running heads | `manuscript.json` |
| Article type | Article / Review / Letter | `manuscript.json` |
| The author line | The authors editor | `authors.json` |
| The affiliations | The affiliations editor | `authors.json` |
| Abstract | Abstract text | `manuscript.json` |
| Significance | Significance statement | `manuscript.json` |
| Highlights | The highlights list | `manuscript.json` |

For the text fields — title, running title, abstract, significance — <kbd>Esc</kbd> discards your edit, <kbd>⌘⏎</kbd> or clicking away commits it, and typing auto-commits about 400 ms after your last keystroke. Title, running title and abstract cannot be emptied; SUNA refuses the write and tells you so inline.

Authors and affiliations get real controls instead, because adding, removing and reordering people needs them. Each author row has given and family name, ORCID, email, `Corresponding` and `Equal contribution` checkboxes, up/down arrows for byline order, and a chip per affiliation that you press to attach or detach. The ORCID field validates against the `0000-0002-1825-0097` shape and the email against an address shape; an invalid entry is flagged in place. At least one author must remain, so the last remove button is disabled.

Affiliation superscripts are derived from array order, never stored. Reorder the affiliations and every marker on the byline renumbers itself. Any author flagged `Corresponding` who also has an email address puts that address on the correspondence line under the affiliations.

## The outline, and what it counts

The Manuscript view in the sidebar derives an outline from the headings — one row per section, with a level chip (`A` for `#`, `B` for `##`, `C` for `###` and deeper), the heading text, and a word count.

<figure class="shot">
  <img src="/shots/outline.webp" alt="The Manuscript sidebar beside the document: paper title, author and abstract counts, then an outline list with level chips and per-section word counts, and figure and table totals at the bottom." />
  <figcaption>The sidebar outline. Word counts roll up, so a top-level heading reports its whole branch, not just the prose before its first subheading.</figcaption>
</figure>

Click a row and SUNA opens or focuses the Manuscript tab and scrolls to that heading. In the other direction, a scroll-spy highlights the row for whichever section is currently at the top of the view, so the outline tracks where you are as you read.

The outline refreshes as you type, debounced by 500 ms, and again on every successful save. While the Manuscript tab is closed it is computed from a fresh read of the file on disk, so it is never stale.

Word counts ignore Markdown syntax rather than counting it. Fenced code, display math, raw HTML, images and figure embeds contribute nothing. `**bold**ly` counts as one word. An inline `$…$` span counts as one word. A heading's own text is not counted toward its section. Counts roll up: a `#` heading reports its own body plus every nested subsection beneath it, while the untitled leading section reports only itself.

The sidebar also shows the author count, the abstract's word count, and the number of figures and tables registered in `manuscript.json`.

::: warning No document-wide word count
SUNA has no running total for the whole manuscript — no status-bar counter, no "N words" anywhere in the shell. What exists is the per-section rolled-up counts in the outline and the abstract count above them.
:::

## You never type "Figure 3"

Numbering is derived at render and export time, never stored in the source. You write the label; SUNA works out the number. That is what makes it safe to move a section, drop a figure, or add a citation in the introduction without auditing the rest of the paper.

| Numbered thing | Ordered by |
| --- | --- |
| Figures and tables | First appearance of `![[fig:id]]` / `![[tbl:id]]` in the prose. Items the prose never embeds keep their `manuscript.json` order, after the embedded ones. |
| Display equations | Document order. An unlabelled equation still consumes a number. |
| References | First citation in the prose. |

The app and the exporter use the same first-appearance rule, so what you see is what ships.

In the Manuscript tab, reading-mode chips resolve against the active journal profile: a citation becomes a numeric `1,3–5` or an author-year `(Gunn & Gott 1972)`, a cross-reference becomes `Fig. 1`, `Table 1`, `equation (1)`, or the heading text for `@sec:`, and a labelled display equation gets its number in the right margin. An id the document does not know keeps its raw `kind:id` text and is flagged rather than blanked, so a typo is visible instead of silently missing.

::: tip On-screen labels differ from exported ones
The in-app chips always read "Fig." and "Table". The export path uses the journal profile's `figureLabel`, which defaults to the spelled-out "Figure". The same `@fig:x` can therefore read `Fig. 1` on screen and `Figure 1` in the exported DOCX. See [profiles](/publishing/profiles).
:::

<figure class="shot">
  <img src="/shots/manuscript-reading.webp" alt="manuscript.md in Reading mode: a typeset title page above prose with superscript numeric citations and a centred KaTeX display equation with its number in the right margin." />
  <figcaption>Reading mode. The citations are superscript numbers and the equation is typeset, but the text under your cursor reverts to source the moment you touch it.</figcaption>
</figure>

## Captions do not live in the prose

A figure's caption comes from `figures/<id>/figure.json`. A table's caption and note come from that table's entry in `manuscript.json`. Neither is stored in `manuscript.md` — the embed line is only a placement marker.

Reading mode renders the SUNA caption standard: a bold derived label (`Figure 3.`, `Table 1.`) followed by the caption title in italics and then the body, with an italic `Note. …` line under a table.

You edit captions where you see them. Click the rendered caption title — or a figure's caption body, or a table's Note body — type, then press <kbd>Enter</kbd> or click away to commit; <kbd>Esc</kbd> reverts. Emptying a caption title reverts it, because titles are required. Emptying a body is a real deletion. If the write fails, the previous text comes back.

::: warning Footnotes are not supported
GFM footnote syntax (`[^1]` and its definition) parses, but SUNA renders the reference as a bare superscript with no link and drops the definition entirely. There is no footnote apparatus. Do not rely on it.
:::

## Where to go next

The dialect itself — citations, cross-references, embeds, labelled equations, image widths, raw LaTeX — is documented on [SciMark](/writing/scimark). For the editing surface, its two modes and the pickers, see [the editor](/writing/editor). For the bibliography and the generated reference list, see [references](/writing/references). For getting the finished thing out, see [export](/publishing/export).
