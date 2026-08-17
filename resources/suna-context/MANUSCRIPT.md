# MANUSCRIPT.md — prose, SciMark, and citations

## The manuscript model

All prose lives in one flat Markdown file under `manuscript/`, named by
`manuscript.json`'s `manuscriptFile` (default `manuscript.md`). There are no per-section
files. Sections are Markdown headings; the outline (level, title, word count) is derived
— get it with `list_outline`, never maintain it by hand. Prose before the first heading
is the untitled leading section, commonly the introduction. In Nature-family profiles,
Methods sub-headings render as run-in heads.

The dialect is SciMark: GFM plus math (remark-gfm, remark-math) plus the constructs
below.

## SciMark syntax

| Construct | Example | Notes |
|---|---|---|
| Bracketed citation | `[@gunn1972]` | canonical insert form |
| Multi-key citation | `[@cortese2021; @boselli2022]` | semicolons between keys |
| Narrative citation | `@gunn1972` | bare key; rules below |
| Figure ref | `@fig:overview` | panel suffix: `@fig:overview{a}` |
| Table ref | `@tbl:x` | |
| Equation ref | `@eq:stripping` | |
| Section ref | `@sec:results` | |
| Figure embed | `![[fig:overview]]` | alone on its own paragraph |
| Inline math | `$z = 2.51$` | |
| Display math, labeled | `$$ {#eq:stripping}` … LaTeX … `$$` | label on the opening line |
| Raw LaTeX escape | fenced code block, info string `{=latex}` | |
| Image | `![alt](path.png){width=50%}` | width is a ceiling — never widens |
| Section | Markdown heading | outline is derived from these |

Only `fig`, `tbl`, `eq`, `sec` are cross-reference kinds. Any other `@word:...` falls
through to a citation — never use `:` in an `@` form outside those four.

## Citations

`[@key]` is the canonical form — the app's own citation picker emits it. Multiple works
in one bracket: `[@cortese2021; @boselli2022]`.

Narrative form is a bare `@gunn1972`. Parser rules: the key needs start-of-line or a
space, `(`, `[`, or `{` immediately before it; the key must be at least 2 characters; a
trailing `.`, `:`, or `-` is trimmed off the key.

`manuscript/references.bib` is the source of truth for references; `read_bib` returns
it verbatim. Reference numbering and citation styling are derived at format time.

Adding a citation, start to finish:

1. `search_literature {query}` (default provider Crossref, keyless) or
   `lookup_doi {doi}` to find the work.
2. `add_reference {doi}` — fetches the metadata, appends it to `references.bib`, and
   echoes the generated cite key back to you.
3. CHECK the echoed metadata — registries serve junk on automated deposits (mangled
   titles, wrong years, boilerplate authors). Fix or flag before citing.
4. Insert `[@key]` in the prose with `edit_manuscript`.

## Cross-references and numbering

Numbering — figures, tables, equations, references — is derived at format time, NEVER
stored. Write `@fig:x`, never "Figure 3". Write `@eq:stripping`, never "Equation (2)".
A literal number goes stale silently the moment anything is reordered.

Panel references take a suffix in braces: `@fig:overview{a}`.

`check_manuscript` includes figure-reference integrity among its checks. It flags with
measured value vs stated rule; it never rewrites — compliance is advisory-only.

## Figure embeds and captions

Embed a figure with `![[fig:overview]]` alone in its own paragraph. Figure ids match
`[A-Za-z][A-Za-z0-9_.-]*`. The figure and its caption render at that point in the
formatted manuscript.

The caption does not live in the prose: it lives in `figures/<id>/figure.json`
(`caption.title`). `list_figures` lists ids with caption titles; `read_figure_svg`
returns a figure's SVG. Never hand-edit `figures/<id>/figure.svg` — it is app-owned
(canvas); editing it bypasses undo, id-minting, and provenance.

## Edit discipline

- Prefer `edit_manuscript {find, replace}`: anchored, exact-match, errors if `find`
  matches 0 or more than 1 time (with per-match context so you can extend `find` until
  it is unique). It reports which section it edited.
- `write_manuscript {content}` overwrites the whole prose file. Reserve it for
  wholesale restructures the user asked for — a wholesale rewrite of the user's prose
  is otherwise something you propose first, not perform.
- There are no locks. When the SUNA app is open it live-reloads external file changes;
  anchored edits are what keep you from clobbering the user's in-progress editing.
- `read_section` / `write_section` are deprecated aliases of the whole-file verbs (the
  `path` argument is ignored). Do not use them in new work.
- If MCP is unavailable, edit `manuscript.md` directly with your file tools under the
  same discipline: anchored edits, never blind whole-file rewrites.
- Metadata — title, abstract, figure/table metadata, availability, back matter, and the
  byline — lives in `manuscript.json` + `authors.json`, not in the prose. Read it with
  `read_manuscript_meta`. There is no metadata write verb: propose metadata changes to
  the user rather than editing those files unasked.
- Review comments live in the `manuscript/comments.json` sidecar, never as inline
  markers in the prose. See COMMENTS.md for the comment verbs and procedure.
