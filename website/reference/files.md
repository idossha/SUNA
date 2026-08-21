# Files and formats

Every file a SUNA project contains, what writes it, and what a valid one looks like — for when you want to read, diff, script or generate these files outside the app.

If you want the directory tree and what each folder is for, read [anatomy of a project](/guide/project) first. This page is the format reference: one section per file, each with an example you can copy.

A note that applies to all of it: you can edit these files with the app open. External writes reach a live editor as a minimal mapped change, so your caret, scroll position and comment anchors survive. If the buffer in SUNA is dirty when the file changes underneath it, you get a divergence banner offering **Reload from disk** or **Keep mine** rather than a silent overwrite.

## suna.json

The manifest at the project root. Its presence is what makes a folder a SUNA project — open a folder without it and SUNA refuses with `not a SUNA project (no suna.json): <dir>`.

```json
{
  "schemaVersion": 1,
  "name": "Ram-pressure stripping in a z=1.7 cluster (demo)",
  "activeProfileId": "nature",
  "directories": {
    "manuscript": "manuscript",
    "figures": "figures",
    "code": "code",
    "data": "data",
    "analysis": "analysis",
    "results": "results",
    "output": "output"
  },
  "createdAt": "2026-08-14T00:00:00.000Z"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | must be exactly `1` | Manifest format version. |
| `name` | string | Display name, shown in the title bar and Recent projects. |
| `activeProfileId` | string | The journal profile behind compliance checking and citation rendering. `"suna"` is the house style and flags nothing. See [profiles](/publishing/profiles). |
| `directories` | map of role → folder name | Keys are `manuscript`, `figures`, `code`, `data`, `analysis`, `results`, `output`. The map is partial: omit a key and SUNA falls back to the default name. |
| `createdAt` | ISO timestamp | When the project was created. |
| `settings` | object, optional | Project-level overrides of your global settings. The full key list is in [anatomy of a project](/guide/project); how the levels resolve is in [settings](/guide/settings). |

Hand-editing is safe and supported. The settings writer re-reads the file from disk, merges its change, validates the whole result *before* writing anything, writes atomically, and preserves every other key verbatim — including keys this schema version does not know about. Invalid JSON is reported as `suna.json is not valid JSON (<path>): …` rather than being overwritten. Numeric bounds in `settings.editor` are enforced, so a hand-edited `fontSizePx` of 40 is rejected rather than clamped.

Every service resolves paths through `directories` rather than a hard-coded `manuscript/`, so a folder renamed here keeps working.

::: warning Not built yet
There is no UI for renaming a project directory. Doing it means editing `suna.json` by hand and moving the folder yourself.
:::

## manuscript/manuscript.json

The journal-agnostic metadata source of truth: everything about the paper that is not prose, not the byline and not BibTeX. SUNA writes it from the title page, field by field; you can also edit it directly.

Numbering is never in this file. Figure, table, equation and reference numbers are derived at format time from order plus the active profile.

```json
{
  "title": "Rapid quenching by ram-pressure stripping in a young cluster at $z = 1.7$",
  "shortTitle": "Ram-pressure stripping at z=1.7",
  "articleType": "article",
  "doi": null,
  "openAccess": null,
  "history": { "received": null, "accepted": null, "publishedOnline": null },
  "abstract": { "content": "Galaxies falling into dense cluster environments can lose their star-forming gas within a few hundred million years." },
  "significance": "Environmental quenching is one of the fastest routes by which galaxies stop forming stars.",
  "figures": [
    {
      "id": "fig-spectrum",
      "namespace": "main",
      "canvasRef": "figures/fig-spectrum/figure.svg",
      "widthPreset": "double",
      "caption": {
        "title": "H\\alpha emission and the star-forming main sequence.",
        "body": "**a**, Continuum-normalized spectrum around H$\\alpha$ (steps). **b**, Star-formation rate against stellar mass.",
        "abbreviations": []
      },
      "panels": [{ "letter": "a", "subLabels": [] }, { "letter": "b", "subLabels": [] }]
    }
  ],
  "tables": [
    {
      "id": "tab-observed",
      "namespace": "main",
      "source": "native",
      "caption": {
        "title": "Observed and derived properties of the stripped galaxy.",
        "body": "Fitted quantities are read from results/spectrum_fit.json."
      },
      "footnotes": [{ "mark": "a", "text": "Gaussian centroid of the H\\alpha line." }]
    }
  ],
  "availability": {
    "data": "The demo data underlying this example are included in the project's data/ directory.",
    "code": "Figure-generating scripts live beside their figures under figures/*/source/."
  },
  "backMatter": {
    "acknowledgements": "We thank the SUNA platform for existing.",
    "authorContributions": "A.R. wrote the example. B.C. reviewed it.",
    "funding": [{ "funder": "Example Science Foundation", "grant": "ESF-2026-0042" }],
    "competingInterests": "The authors declare no competing interests.",
    "peerReview": null,
    "supplementaryInfo": null
  },
  "bibliography": "references.bib",
  "manuscriptFile": "manuscript.md"
}
```

| Field | Notes |
| --- | --- |
| `title`, `shortTitle` | Strings. Math in them is written as SciMark, as above. |
| `articleType` | `article`, `review` or `letter`. |
| `doi` | A DOI string or `null`. |
| `openAccess` | `null`, or `{ license, copyrightHolder, year }`. |
| `history` | `received`, `accepted`, `publishedOnline` — ISO dates or `null`. |
| `abstract` | `{ "content": "…" }`. |
| `keywords` | Optional array of strings, exported as a `Keywords:` line after the abstract. Order is yours. |
| `significance`, `highlights` | Optional title-page extras: a string, and an array of strings. |
| `manuscriptFile` | Names the prose file, relative to the manuscript directory. Defaults to `manuscript.md`; it is data, so you can rename the file. |
| `bibliography` | Must end in `.bib`. |
| `figures[]` | `id`, `namespace` (`main`, `extended-data`, `box`), `canvasRef` (must end in `.svg`), `widthPreset` (`single` or `double`), `caption`, `panels`. |
| `tables[]` | `id`, `namespace` (`main`, `extended-data`), `source` (`native` or `pretypeset`), `caption` (`title`, optional `body`), `footnotes[]` of `{ mark, text }`. |
| `availability` | `data` and `code` statements, both strings. |
| `backMatter` | `acknowledgements`, `authorContributions`, `funding[]` of `{ funder, grant }`, `competingInterests`, `peerReview`, `supplementaryInfo`. |

Captions live here, never in the prose. A caption has a `title` and a `body`, both SciMark — emphasis, math and LaTeX macros work, with backslashes escaped as JSON requires (`"H\\alpha"` is the string `H\alpha`).

A table's *rows* are not in this file. Write `![[tbl:tab-observed]]` alone in a paragraph directly above a Markdown table in the prose, and that table binds to this entry; the caption stays here. Managed tables the prose never embeds still render, in a trailing Tables section.

Title-page edits in the app are read → merge → validate → atomic write, so an agent editing the same file concurrently is never clobbered.

## manuscript/authors.json

The byline: who wrote the paper and where they work. Affiliation superscripts are derived from author order, so they are not stored.

```json
{
  "schemaVersion": 1,
  "authors": [
    {
      "id": "a1",
      "given": "Ada",
      "family": "Researcher",
      "nativeScript": null,
      "orcid": "0000-0002-1825-0097",
      "affiliationRefs": ["af1"],
      "corresponding": true,
      "email": "ada@observatory.edu",
      "equalContribution": false,
      "deceased": false
    },
    {
      "id": "a2",
      "given": "Ben",
      "family": "Collaborator",
      "nativeScript": null,
      "orcid": null,
      "affiliationRefs": ["af2"],
      "corresponding": false,
      "email": null,
      "equalContribution": false,
      "deceased": false
    }
  ],
  "affiliations": [
    { "id": "af1", "text": "Department of Astronomy, Example University, Madison, WI, USA" },
    { "id": "af2", "text": "Institute for Cosmic Discovery, Cambridge, UK" }
  ]
}
```

The ids are the load-bearing part: each string in an author's `affiliationRefs` must match an `id` in `affiliations`. Author order is byline order.

## manuscript/manuscript.md

All of the prose, in one flat file. There is no `sections/` directory — sections are Markdown headings, and the outline you see in the app is derived from them.

The dialect is SciMark: CommonMark and GFM tables, plus math, citations, cross-references and managed embeds. The full syntax is on [the SciMark page](/writing/scimark).

```markdown
Galaxies falling into dense cluster environments experience ram pressure
from the intracluster medium [@gunn1972], a process now observed in rich
detail across the nearby universe [@cortese2021; @boselli2022].

$$ {#eq:stripping}
P_\mathrm{ram} = \rho_\mathrm{ICM} v^2 > 2\pi G \Sigma_\ast \Sigma_\mathrm{gas}
$$

When the inequality in @eq:stripping holds at radius $r$, gas outside $r$
is removed on roughly a crossing time.

# Results

The H$\alpha$ line is detected at high significance (@fig:fig-spectrum{a}).

![[fig:fig-spectrum]]

![[tbl:tab-observed]]

| Quantity | Value | Unit |
| --- | --- | --- |
| Systemic velocity | 1450 | km s$^{-1}$ |
```

Four things to notice. `[@key]` is a citation and `@key` a narrative one; the rendered style — superscript numeric, author–year, parenthetical — comes from the active profile and is never stored in the prose. `![[fig:id]]` on its own paragraph embeds a managed figure and pulls its caption from `manuscript.json`. `@fig:id`, `@tbl:id`, `@eq:label` and `@sec:id` are cross-references; `@fig:id{b}` refers to a panel. You never write "Figure 3" — the number is derived at format time.

This file is yours. Write it in SUNA, in vim, or generate it from a script; nothing about it is app-owned.

## manuscript/references.bib

Plain BibTeX, named by `manuscript.json`'s `bibliography` field. It is the source of truth for references — SUNA reads it, renders it per profile, and appends to it, but never takes ownership.

```text
@article{gunn1972,
  author  = {Gunn, James E. and Gott, J. Richard},
  title   = {On the infall of matter into clusters of galaxies and some effects on their evolution},
  journal = {The Astrophysical Journal},
  volume  = {176},
  pages   = {1--19},
  year    = {1972},
  doi     = {10.1086/151605}
}
```

Entries added from literature search get a generated `firstauthorYEARword` key, deduplicated against what is already there. Reference PDFs are resolved by rule: the entry's `file` field first (Zotero and JabRef forms included), then `references/<citekey>.pdf`, then a fuzzy `Author_Year*` match. Details are on [references](/writing/references).

Hand-edit freely, or point SUNA at a `.bib` you already maintain by changing `bibliography`.

## manuscript/comments.json

Review threads live in this sidecar, not in the prose — the manuscript text stays clean and diffable. The file is created on the first comment write; reading it before that returns an empty file and creates nothing.

```json
{
  "schemaVersion": 1,
  "comments": [
    {
      "id": "c-2026-08-17-3f9a1c02",
      "target": {
        "kind": "section",
        "path": "manuscript.md",
        "anchor": {
          "quote": "removed on roughly a crossing time",
          "prefix": "holds at radius $r$, gas outside $r$\nis ",
          "suffix": ". In this demo manuscript we"
        }
      },
      "body": "Give the crossing time a number here.",
      "author": { "kind": "human", "name": "Ada Researcher" },
      "createdAt": "2026-08-17T09:12:44.000Z",
      "resolved": false,
      "detached": false,
      "replies": [
        {
          "id": "r-2026-08-17-b18d7e44",
          "body": "Added: ~120 Myr at the cluster velocity dispersion.",
          "author": { "kind": "agent", "name": "Claude Code", "model": "claude-opus-4" },
          "createdAt": "2026-08-17T09:31:02.000Z"
        }
      ]
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `target.kind` | `section` (a passage of prose, with `path` and `anchor`), `figure` (`figureId`, optional `elementId` such as `ax0.title`), or `manuscript` (the whole document, no anchor). |
| `anchor` | W3C-style text-quote selector: the exact `quote` plus the text immediately before and after it. |
| `author.kind` | `human` or `agent`. An agent comment also carries `model`. |
| `resolved` | Human-only. There is no MCP verb that resolves a thread. |
| `detached` | Set when re-anchoring failed. A detached comment is kept and flagged, never deleted. |

`path` is the manuscript's prose file — `manuscript.md`. The `kind` is still called `section` so that comment files written under the old sectioned layout stay valid.

A corrupt `comments.json` is reported as `comments.json is not valid JSON (<path>): …` and stops the read, rather than being silently discarded and losing your review threads.

Editing the body text of a comment by hand is harmless. Editing an `anchor` is how you break the link between a comment and its passage, so leave anchors to the app — see [review comments](/writing/comments).

## figures/&lt;id&gt;/figure.json {#figure-json}

One per figure directory. It holds the figure's identity, its caption, its panel letters and where it came from.

```json
{
  "id": "fig-spectrum",
  "namespace": "main",
  "widthPreset": "double",
  "caption": {
    "title": "H\\alpha emission and the star-forming main sequence.",
    "body": "**a**, Continuum-normalized spectrum around H$\\alpha$ (steps). **b**, Star-formation rate against stellar mass.",
    "abbreviations": []
  },
  "panels": [
    { "letter": "a", "subLabels": [] },
    { "letter": "b", "subLabels": [] }
  ],
  "provenance": {
    "generator": { "script": "source/plot.py", "interpreter": "python" },
    "overlay": []
  }
}
```

| Field | Notes |
| --- | --- |
| `id` | Matches the directory name and the `![[fig:id]]` embed in the prose. |
| `namespace` | `main`, `extended-data` or `box`. |
| `widthPreset` | `single` or `double`, resolved to millimetres by the active profile. |
| `caption` | `title` and `body`, both SciMark; optional `credits` and `abbreviations`. |
| `panels` | One entry per panel: a single lowercase `letter` and optional `subLabels`. |
| `provenance` | `null` for a figure drawn from scratch. Otherwise `generator` (`script`, optional `entry` and `interpreter`), an optional `baseSvgHash`, and an `overlay` array. |

Captions are the reason to open this file by hand — a caption fix here is a one-line JSON edit. See [figures from code](/figures/from-code).

::: warning Not built yet
`provenance.overlay` is where canvas edits would be recorded and replayed on top of a regenerated figure. That loop is not built. Edits you make on the canvas do not sync back to the generating script, and re-running the script overwrites the SVG. Change the script, then regenerate.
:::

## figures/&lt;id&gt;/figure.svg {#figure-svg}

The figure itself, and the canvas document model. There is no parallel scene graph and no import/export conversion: what the canvas edits is the SVG DOM, so the file on disk is always a valid SVG that any other tool can open. Round-trips are byte-identical.

```text
<svg xmlns="http://www.w3.org/2000/svg" width="510.23622pt" height="164.409449pt"
     viewBox="0 0 510.23622 164.409449" version="1.1">
 <g id="figure_1">
  <g id="ax0">
   …
```

Semantic group ids such as `ax0` are what the sidecar's anchors and figure comments point at. Figures produced by the `suna_mpl` Python package set matplotlib's `svg.fonttype: none`, which keeps text as real text rather than outlines — required for editing labels on the canvas.

::: danger Do not hand-edit figure.svg
This file is owned by the canvas. Editing it in a text editor bypasses undo, id minting and provenance. Open it in SUNA instead — see [the canvas](/figures/canvas). Reading it is fine; the MCP surface for agents is deliberately read-only for the same reason.
:::

## figures/&lt;id&gt;/figure.svg.suna.json {#figure-svg-suna-json}

A sidecar written next to every SVG exported by `suna_mpl`. It records how big the figure is in millimetres and how data coordinates map onto SVG coordinates, so the canvas can place things in data space without importing matplotlib.

```json
{
  "schemaVersion": 1,
  "svgSha256": "ef83b648f16761aed69941f93cd48be02448d4b66761a3ca05020f037f0cba15",
  "widthMm": 180.0,
  "heightMm": 58.0,
  "axes": [
    {
      "gid": "ax0",
      "xscale": "linear",
      "yscale": "linear",
      "anchors": {
        "x": [[6492.5, 35.16], [6657.5, 248.118]],
        "y": [[-0.1857575, 131.206], [1.1326475, 18.878]]
      }
    }
  ],
  "generator": { "script": "figures/fig-spectrum/source/plot.py", "mpl_version": "3.11.1" }
}
```

Each anchor is a `[data value, SVG user unit]` pair, two per axis — enough to map either direction by linear interpolation. A log axis stores `log10` of the data value and marks its scale `"log10"`, so the same interpolation still works. `svgSha256` is the hash of the SVG's bytes at the moment the sidecar was written, which is how a stale sidecar is detected.

Do not hand-edit this file. It is regenerated with the SVG, and any edit you make to one without the other puts the hash out of date.

## What is safe to edit by hand

| File | Edit by hand? | Why |
| --- | --- | --- |
| `suna.json` | Yes | Read → merge → validate → atomic write; unknown keys preserved; invalid JSON reported, not overwritten. |
| `manuscript/manuscript.md` | Yes | It is your prose. Nothing about it is app-owned. |
| `manuscript/references.bib` | Yes | Plain BibTeX; SUNA appends but never takes ownership. |
| `manuscript/manuscript.json` | Yes, with care | Ids must keep matching the prose's `![[fig:…]]` and `![[tbl:…]]` embeds. |
| `manuscript/authors.json` | Yes, with care | Every `affiliationRefs` entry must match an affiliation `id`. |
| `figures/<id>/figure.json` | Captions and panels, yes | Leave `provenance` to the app. |
| `figures/<id>/source/plot.py` | Yes | This is the figure's real source. Change it, then regenerate. |
| `manuscript/comments.json` | Prefer the app | Ids are minted (`c-…`, `r-…`) and anchors are how a thread finds its passage. |
| `figures/<id>/figure.svg` | No | Bypasses undo, id minting and provenance. |
| `figures/<id>/figure.svg.suna.json` | No | Regenerated with the SVG; a lone edit invalidates `svgSha256`. |
| `output/` | No | Derived. SUNA rewrites it on every export, and it is gitignored. |
| `.mcp.json` | Rarely | Machine-local and gitignored; SUNA heals it on open, preserving other MCP servers you added. See [MCP](/ai/mcp). |

## The doctrine, and what it buys you

Stated plainly in SUNA's own README: **JSON, Markdown, BibTeX, SVG and LaTeX are the only sources of truth. PDF and DOCX are produced at export time only.** No binary container, no proprietary document format, no database.

Four consequences you can act on.

**Git works properly.** Every source file is line-oriented text, so a diff shows what actually changed in a sentence, a caption, a BibTeX field or an SVG path. Merge conflicts are resolvable line by line instead of "keep mine or keep theirs on the whole document". Every new project is a git repository from its first minute.

**Diffs stay about the writing.** Numbering is derived at format time rather than stored, so moving a section renumbers nothing on disk. Review comments live in `comments.json` rather than as inline markers, so a round of review does not touch the prose file at all. Captions live in `manuscript.json`, so rewording one does not reflow a paragraph.

**Derived files stay out.** `output/` is gitignored because everything in it is reproducible from the sources beside it, and `.mcp.json` because it holds absolute paths for one machine. What you commit is what you wrote.

**A collaborator does not need SUNA.** They can read `manuscript.md` in any editor, open `figure.svg` in any SVG tool, and load `references.bib` into Zotero. Send them a `.docx` or a PDF from [export](/publishing/export) when they want to comment in Word; the sources stay where they are, unmutated.

SUNA's own git surface is deliberately small: initialize, status, per-file diffs, a commit-all with a message, and the last 20 commits. Branching, pushing, pulling and staging individual files are your terminal's job — the integrated one included.
