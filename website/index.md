---
layout: home

hero:
  name: SUNA
  text: Write the paper where the work lives
  tagline: A desktop workspace for research manuscripts — prose, figures, references, journal rules and the analysis code in one plain-text project, open to you and to your AI agent alike.
  actions:
    - theme: brand
      text: What SUNA is
      link: /guide/what-is-suna
    - theme: alt
      text: Quickstart
      link: /guide/quickstart
    - theme: alt
      text: Tour the interface
      link: /guide/tour

features:
  - title: One manuscript, two views
    details: Your paper is a single Markdown file. Read it typeset — math set, citations numbered, figures placed — and edit it right there, or flip to source with ⌘E. Both are the same buffer.
  - title: Figures you can actually edit
    details: The canvas edits the SVG itself. No import, no export, no parallel scene graph — select a tick label, change it, and the file on disk is still the figure your script produced.
  - title: References that renumber themselves
    details: Write @key. SUNA reads your BibTeX, numbers by first appearance and renders in whatever style the target journal wants. Change journals and every citation follows.
  - title: Journal rules, checked not enforced
    details: Profiles built from published author guidelines. SUNA tells you the abstract is 40 words long and links the rule it came from. It never silently reformats your work.
  - title: Review in the margin
    details: Comments live in a sidecar file and anchor to a quote, so your prose is never marked up. Threads, replies, resolve — and only a human ever resolves one.
  - title: Built for agents
    details: A typed 23-verb MCP interface over the same files you edit. Your agent reads the manuscript, checks compliance and leaves comments — as a collaborator, not a copy-paste target.
---

<div class="doctrine">

JSON, Markdown, BibTeX, SVG and LaTeX are the only sources of truth. PDF and DOCX are produced at export time only.

Nothing in a SUNA project is locked inside a proprietary format. Open the folder in any editor, diff it, branch it, hand it to a collaborator who has never heard of SUNA — it is still just text.

</div>

## The workspace

A file tree, tabs, split panes, a terminal and git — the shape every researcher who has met VS Code already knows — with the manuscript, the figures and the citations as first-class objects rather than files you happen to have open.

<figure class="shot">
  <img src="/shots/manuscript-reading.webp" alt="SUNA showing a manuscript in reading mode: typeset title page, running abstract, superscript citations and a numbered display equation, with the project file tree on the left." />
  <figcaption>The manuscript in reading mode. This is an editable view, not a preview — click into the prose and type.</figcaption>
</figure>

## Figures stay figures

The canvas opens `figure.svg` and edits the SVG DOM directly, so what you save is what your plotting script produced, with your corrections applied. Rulers are in millimetres because that is the unit journals specify, and the export rail rasterises to a journal's stated column width and dpi.

<figure class="shot">
  <img src="/shots/canvas.webp" alt="The SUNA figure canvas: a two-panel matplotlib figure on a millimetre artboard, with a layers tree on the left and a properties rail on the right showing align, figure size, palette, an agent prompt box and journal-spec raster export." />
  <figcaption>A matplotlib figure on the canvas, sized in millimetres, with the layer tree of the real SVG on the left.</figcaption>
</figure>

## Compliance you can read

Every journal profile is built from that journal's published author guidelines, with the source URL kept. Before an export, SUNA checks your manuscript against the profile and lists what does not match — as warnings you can overrule, never as edits it makes for you.

<figure class="shot">
  <img src="/shots/export.webp" alt="The SUNA export dialog: format and journal-profile pickers, submission-format checkboxes, a compliance check listing two missing required sections with the journal's guideline URL, and a panel of the journal's stated requirements for word counts, sections, citations and figures." />
  <figcaption>Export, with the compliance check on the left and the journal's own stated requirements on the right.</figcaption>
</figure>

## Review without marking up the prose

Select a sentence, press <kbd>⌘⇧M</kbd>, and the comment anchors to that quote in `manuscript/comments.json`. The manuscript file itself stays clean — a reviewer's thread never becomes a stray HTML comment you have to remember to delete before submission.

<figure class="shot">
  <img src="/shots/comments.webp" alt="A SUNA manuscript with two anchored review comments highlighted in the prose and a comments rail on the right showing a thread with a reply and Reply, AI, Resolve and Delete actions." />
  <figcaption>Anchored review threads in the rail. Resolving is always a human's move.</figcaption>
</figure>

## Where to start

- New to SUNA? Read [what it is](/guide/what-is-suna), then [install and run it](/guide/install).
- Want to see it working? The [quickstart](/guide/quickstart) opens the example project and walks one loop end to end.
- Coming from Overleaf or Word? [A typical workflow](/guide/workflow) is the page to read.
- Wiring up an agent? Start at [how SUNA works with agents](/ai/overview).
