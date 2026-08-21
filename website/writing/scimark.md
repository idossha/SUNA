# SciMark syntax

SciMark is the dialect your manuscript is written in: GitHub-flavoured Markdown, plus LaTeX math, plus a small set of scholarly constructs for citations, cross-references and managed figures and tables. This page documents every construct SUNA actually parses.

The parser is `remark-parse` with GFM and math, followed by SUNA's own transforms. Anything you already know about Markdown — headings, `**bold**`, lists, fenced code, pipe tables — works unchanged. What follows concentrates on the additions, and on the exact spellings that make them bind.

One rule runs through all of it: **nothing is numbered in the source.** You write `@fig:spectrum`, never "Figure 3". Figure, table, equation and reference numbers are derived every time the document is rendered or exported, so inserting a figure in the middle of the Results never leaves you renumbering prose.

<figure class="shot">
  <img src="/shots/manuscript-source.webp" alt="The SUNA window with the file explorer on the left and manuscript.md open in Source mode, showing plain Markdown text with bracketed citation keys, a display-math block and a figure embed line." />
  <figcaption>manuscript.md in Source mode. This is the whole document — one plain-text file, with the citation keys, embeds and math written out literally.</figcaption>
</figure>

## Every construct at a glance

| Construct | You write | Notes |
| --- | --- | --- |
| Section | `# Results`, `## Spectral fitting` | Root-level headings only; setext (`===`, `---`) also works |
| Bold | `**text**` | <kbd>⌘B</kbd> |
| Italic | `*text*` | <kbd>⌘I</kbd> |
| Strikethrough | `~~text~~` | <kbd>⌘⇧X</kbd> |
| Inline code | `` `text` `` | <kbd>⌘⇧C</kbd> |
| Link | `[text](url)` | <kbd>⌘K</kbd> with a selection |
| List | `- item`, `1. item` | `-`, `*`, `+` all work |
| Table | GFM pipe table | Bind a caption with a `![[tbl:id]]` embed above it |
| Inline math | `$r$` | KaTeX |
| Display math | `$$` … `$$` on their own lines | KaTeX |
| Labelled equation | `$$ {#eq:stripping}` on the opening fence | Label goes on the opener, not the closer |
| Citation | `[@gunn1972]` | |
| Several citations | `[@cortese2021; @boselli2022]` | Semicolon-separated |
| Narrative citation | `As @gunn1972 showed…` | Bare key, no brackets |
| Cross-reference | `@fig:id`, `@tbl:id`, `@eq:id`, `@sec:id` | Bare, never in brackets |
| Panel reference | `@fig:spectrum{a}`, `@fig:spectrum{b,c}` | Brace suffix |
| Figure embed | `![[fig:spectrum]]` | Alone in its own paragraph |
| Table embed | `![[tbl:observed]]` | Alone in its own paragraph, directly above the table |
| Plain image | `![alt](path.png)` | |
| Image width | `![alt](path.png){width=50%}` | No space before the brace |
| Raw LaTeX | ` ```{=latex} ` fence | See [the honest account below](#raw-latex) |

## Headings and sections

Sections are plain Markdown headings. There are no per-section files and no section metadata — `# Results` *is* the Results section, and the sidebar Outline is derived from the headings as you type.

```markdown
# Results

The H$\alpha$ line is detected at high significance.

## Spectral fitting

The demo spectrum is fit with a single Gaussian plus flat continuum.
```

Setext headings — a line underlined with `===` or `---` — are supported and count as level 1 and level 2.

Only headings at the root of the document define sections. A `#` inside a blockquote or a list item does not start one, and a `#` inside a fenced or indented code block, or inside inline code, is code rather than a heading. Prose written before the first heading is kept as the untitled leading section.

Word counts in the Outline exclude Markdown syntax: fenced code, display math, raw HTML, images and figure embeds contribute nothing, `**bold**ly` counts as one word, an inline `$…$` span counts as one word, and a heading's own text is not counted toward its section. Each row's count is rolled up, so `# Methods` reports its own body plus every subsection under it.

## Emphasis, lists and tables

Standard GFM. Bold, italic, strikethrough, inline code, links, ordered and unordered lists and pipe tables all behave as they do on GitHub, and the formatting shortcuts (<kbd>⌘B</kbd>, <kbd>⌘I</kbd>, <kbd>⌘⇧C</kbd>, <kbd>⌘⇧X</kbd>, <kbd>⌘K</kbd>) toggle the markers for you. See [the editor](/writing/editor) for the full set.

Tables are written as GFM pipe tables, and cells may contain inline math:

```markdown
| Quantity | Value | Unit |
| --- | --- | --- |
| Systemic velocity | 1450 | km s$^{-1}$ |
| H$\alpha$ centroid | 6563.3 | Å |
```

A bare table like this renders as a table and nothing more. To give it a number, a caption and a note, put a table embed above it — see [Table embeds](#table-embeds).

## Math

Inline math is `$…$`; display math is a `$$` block with the fences on their own lines. Both render through KaTeX, in the editor's Reading mode and in export alike.

```markdown
When the inequality holds at radius $r$, gas outside $r$ is removed.

$$
P_\mathrm{ram} = \rho_\mathrm{ICM} v^2 > 2\pi G \Sigma_\ast \Sigma_\mathrm{gas}
$$
```

### Labelled equations

To reference an equation, label it by putting `{#eq:id}` on the **opening** fence:

```markdown
$$ {#eq:stripping}
P_\mathrm{ram} = \rho_\mathrm{ICM} v^2 > 2\pi G \Sigma_\ast \Sigma_\mathrm{gas}
$$

When the inequality in @eq:stripping holds at radius $r$, gas outside $r$
is removed on roughly a crossing time.
```

The opening-fence text must match `{#eq:<id>}` exactly — nothing else on the line, and the id starts with a letter. A label anywhere else is not read.

Display equations are numbered in document order, and **unlabelled equations still consume a number.** If you want equation (2) to be the second labelled equation, do not leave an unlabelled `$$` block above it.

## Citations

The canonical form is a key in square brackets:

```markdown
Galaxies falling into dense clusters experience ram pressure [@gunn1972].
```

Several works in one bracket are separated by semicolons:

```markdown
…observed in rich detail across the nearby universe [@cortese2021; @boselli2022].
```

A narrative, in-sentence citation is the bare key, no brackets:

```markdown
As @gunn1972 showed, the stripping condition is a balance of two pressures.
```

The keys are BibTeX keys from the bibliography named in `manuscript.json`; <kbd>⌘⇧K</kbd> opens a picker at the cursor that searches your entries and inserts `[@key]` for you. Reference numbering and the reference list are derived from the citations by order of first appearance — see [references](/writing/references).

Rules worth knowing:

| Situation | What happens |
| --- | --- |
| One malformed item in a bracket | The **whole bracket** stays ordinary text — `[@ok; @1bad]` is not a citation |
| Key starting with a digit | Not a key; keys start with a letter |
| Bare key of one character | Not recognised; a bare key needs at least two characters |
| `@key.` `@key:` `@key-` | Trailing `.`, `:` or `-` is trimmed off the key |
| `@key, and…` | Other punctuation just ends the token and stays in the text |
| `author@example.edu`, `word@key2020` | Not a citation — an `@` glued to a preceding word character is left alone |

A bare `@` is only read as a citation or cross-reference when it starts the text or follows whitespace, `(`, `[` or `{`. That is what keeps email addresses and code-ish text literal.

::: warning Brackets are for citations only
`[@fig:x]` is **not** a cross-reference. The bracket grammar allows `:` inside a key, so `[@fig:x]` parses as a citation whose key is the literal string `fig:x` — and then fails to resolve against your bibliography. Write cross-references bare: `@fig:x`.
:::

## Cross-references

There are exactly four kinds:

| Kind | Example | Resolves to |
| --- | --- | --- |
| `@fig:` | `See @fig:cluster for the map.` | `Fig. 1` on screen |
| `@tbl:` | `In @tbl:params we list values.` | `Table 1` |
| `@eq:` | `From @eq:tf it follows.` | `equation (1)` |
| `@sec:` | `As in @sec:methods we fit.` | The heading text |

Anything else of the shape `@word:something` — `@data:release`, say — is parsed as a citation key, not a cross-reference.

A brace suffix picks out panels, and works after any of the four kinds:

```markdown
The line is detected at high significance (@fig:fig-spectrum{a}), while
cluster members scatter about the main sequence (@fig:fig-spectrum{b}).

Both panels are shown in @fig:x{b,c}.
```

`@sec:` ids are a slug of the heading text: lowercased, every run of non-alphanumeric characters replaced by `-`, leading and trailing hyphens trimmed. A heading `Data and Methods` is referenced as `@sec:data-and-methods`. If two headings slug to the same id, the reference resolves to the first; the untitled leading section can never be referenced.

`@sec:` resolves to the **heading text**, never a section number, both in the app and in export.

::: info Where chips resolve
Numbers and styles only appear in the combined Manuscript tab. In a plain editor tab opened on the same `.md`, Reading mode shows the raw forms — a citation chip reads `[key1; key2]`, a cross-reference reads `kind:id`, and an equation label reads `(eq:stripping)`. An id the document does not know keeps its raw text and is flagged rather than blanked.
:::

<figure class="shot">
  <img src="/shots/manuscript-reading.webp" alt="manuscript.md in Reading mode: a typeset title page with authors and abstract above running prose in which citations appear as superscript numbers, and a KaTeX-typeset display equation set off from the text." />
  <figcaption>The same file in Reading mode inside the Manuscript tab. Citation keys have become superscript numbers in the active journal's style, and the display equation is typeset by KaTeX — while the text underneath stays editable.</figcaption>
</figure>

The in-app chips always say "Fig." and "Table". Export uses the journal profile's `figureLabel` instead, which defaults to the spelled-out "Figure" — so the same `@fig:x` can read "Fig. 1" on screen and "Figure 1" in the exported DOCX or PDF. See [profiles](/publishing/profiles).

## Figure embeds

A managed figure is placed with a wiki-style embed, alone in its own paragraph:

```markdown
The stripped disk shows a regular rotation pattern (@fig:fig-velocity-map).

![[fig:fig-velocity-map]]

Consistent with outside-in removal of the gas reservoir.
```

The embed must be the only thing in its paragraph — blank line above, blank line below. With any other text on the line it stays ordinary text. The id must start with a letter and then use letters, digits, `_`, `.` or `-`; a leading digit or underscore silently leaves the line as plain text.

<kbd>⌘⇧F</kbd> opens the figure picker at the cursor. <kbd>↵</kbd> places the figure as `![[fig:id]]` with the blank lines it needs, leaving the cursor on the line below; <kbd>⇧↵</kbd> inserts the in-prose reference `@fig:id` instead, adding a leading space if the character to the left would swallow it.

Figures are numbered by the order of their **first embed** in the prose. A managed figure the prose never embeds keeps its manifest order, after all the embedded ones. The app and the exporter use the same rule.

**Captions are not in the prose.** A figure's caption title and body live in `figures/<id>/figure.json`; the embed renders the derived `Figure N.` label plus the caption. You edit a caption by clicking it in Reading mode, typing, and pressing <kbd>↵</kbd> — <kbd>esc</kbd> reverts. A figure repaints in place when its SVG is saved, so an edit on [the canvas](/figures/canvas) shows up without reopening the file.

## Table embeds

A table embed does the same job for a managed table, and binds to the GFM table directly beneath it:

```markdown
![[tbl:tab-observed]]

| Quantity | Value | Unit |
| --- | --- | --- |
| Systemic velocity | 1450 | km s$^{-1}$ |
| H$\alpha$ centroid | 6563.3 | Å |
| Stripping radius | 8.4 | kpc |
```

The pair renders as one captioned block: the derived `Table N.` label and caption above the table, and an italic `Note.` line below it. The caption and note come from the `tables` entry in `manuscript.json`, not from the prose, and are editable in place the same way figure captions are.

An embed with no table under it still renders its caption block on its own. The same id rules apply — start with a letter, alone in its paragraph.

## Images

Ordinary Markdown images work for anything that is not a managed figure. A pandoc-style width attribute may be glued directly to the image, with no space between:

```markdown
![Detector layout](hardware/layout.png){width=50%}
```

`{width=320px}` and a bare `{width=320}` (read as pixels) also work, and fractional values like `{width=33.5%}` are allowed. One key, one value, no spaces, no quotes is the entire grammar.

Width is a **ceiling, never a stretch.** The renderer emits `max-width: min(<w>, 100%)`, Reading mode narrows the holder rather than the art, and DOCX export takes the smallest of natural size, requested size and the text measure. It can shrink an image; it can never blow one up past its natural size.

Anything the grammar does not accept is left in the file as visible literal text — `{width=abc}`, `{width=50 %}`, `{ width=50% }`, `{width=50%,height=20%}`, `{width=0}`, `{height=200px}`, `{.wide}`, `{width=}`. A space between the image and the block breaks the binding, and a width block after a reference-style image (`![a][ref]{width=…}`) is not read.

## Footnotes

::: warning Not built yet
Footnotes are not a SciMark construct. GFM footnote syntax parses, but nothing assembles a footnote apparatus: the reference renders as a bare superscript with no link, the definition renders as nothing at all, and Reading mode gives footnotes no treatment. Do not rely on them. Put the material in the sentence, or in a managed table's `Note.` line.
:::

## Raw LaTeX {#raw-latex}

A fenced code block whose info string is `{=latex}` is parsed as a raw-LaTeX node rather than as code:

````markdown
```{=latex}
\begin{equation*}
  \tau_\mathrm{strip} \simeq \frac{\Sigma_\mathrm{gas}}{\dot{\Sigma}_\mathrm{strip}}
\end{equation*}
```
````

::: warning What this does today
Nothing renders it. There is no LaTeX output path in SUNA — PDF export goes through HTML and Chromium's printer, not through a TeX engine. In the HTML preview and PDF the block becomes an HTML comment, so it is invisible; in DOCX export it is dropped entirely. Reading mode leaves the fence as literal source, and the block contributes nothing to word counts.

Treat `{=latex}` as a way to keep LaTeX in the file, marked as LaTeX and out of every renderer's way — not as a way to typeset something SciMark cannot express. Anything that must appear in the exported manuscript needs a construct on this page.
:::

Ordinary fences — ` ```python `, ` ```bash ` — are untouched and render as code.

## What is never in the source

Four things that live in LaTeX or Word documents deliberately do not live in your `.md`:

| Not in the prose | Where it lives instead |
| --- | --- |
| Figure, table, equation and reference numbers | Derived at render and export time |
| Figure captions | `figures/<id>/figure.json` |
| Table captions and notes | The `tables` entry in `manuscript.json` |
| Review comments | The `manuscript/comments.json` sidecar |

That is what makes the prose file safe to reorder. See [the manuscript](/writing/manuscript) for the document as a whole, and [files and folders](/reference/files) for where each piece is kept.

## A complete example

The demo project shipped with SUNA is a working SciMark manuscript that uses nearly every construct on this page — bracketed and multiple citations, a labelled display equation and a reference to it, inline math, panel references, a figure embed, a table embed above a GFM table, and a `{=latex}` fence. It is at `examples/hello-suna/manuscript/manuscript.md`, and it is copyable verbatim.
