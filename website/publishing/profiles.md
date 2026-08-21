# Journal profiles

A journal profile is that journal's own author guidelines, transcribed into a file SUNA can check against. Pick one for your project and the app knows your citation style, your word limits, your figure widths — and can tell you where your manuscript disagrees with them. This page covers what a profile contains, which ones ship, where you switch between them, and which two are not yet trustworthy.

## What a profile actually is

Each profile is one JSON document under `resources/profiles/<id>.json`, transcribed from the journal's published guidelines. Three properties matter to you as an author.

**Every value carries its source.** Each block of rules lists the official guideline URLs it came from, plus a `provenance` list in which every claim records how it was established: `documented` (stated verbatim in the guidelines), `counted-empirically` (measured from published output), or `inferred` (filled in from convention). When a compliance check fires, the message appends the source URL, so you can go read the sentence the rule came from.

**What the journal does not say is stored as `null`, never guessed.** A missing rule is not a default; the corresponding check is skipped entirely. On the Export page's requirements panel a null submission-format rule shows an explicit "not stated" badge, and null limits, figure rules and availability rows are omitted rather than invented.

**Profiles never rewrite anything.** They drive a checker that flags mismatches. The panel says so in the app: "The journal's own stated requirements, from its author guidelines — shown for reference. SUNA flags mismatches; it never silently reformats."

Each profile also records its publisher and the date its guidelines were last verified. The requirements panel prints them together as `<publisher> · verified <date>`.

## The profiles you can pick

Ten entries ship, in this order. SUNA style comes first; the other nine are journals. Every one of them appears in every picker — there is no hidden set.

| Journal profile | In-text citations | Article types it declares | Guidelines verified |
| --- | --- | --- | --- |
| SUNA style | (Author, Year) | Draft manuscript | 2026-08-15 |
| Science | Bracketed numbers [1] | Research Article; Research Article (extended online format); Review; Perspective | 2026-08-13 |
| Nature | Superscript numbers¹ | Article | 2026-08-15 |
| Neuron | Superscript numbers¹ | Article; Report | 2026-08-15 |
| PNAS | Bracketed numbers [1] | Research Report; Brief Report | 2026-08-15 |
| Brain Stimulation | Bracketed numbers [1] | Original Research (incl. reviews); Letter to the Editor; Editorial (by invitation) | 2026-08-17 |
| SLEEP | Bracketed numbers [1] | Original Articles; Review Articles; Perspectives; Research Letters; Editorials | 2026-08-15 |
| SLEEP Advances | Bracketed numbers [1] | Original Articles; Brief Research Report; Perspective; Editorial; Letter to the Editor | 2026-08-15 |
| Journal of Neural Engineering | Bracketed numbers [1] | Paper; Note; Comment/Reply | 2026-08-15 |
| Journal of Neuroscience | (Author, Year) | Research Article; Review | 2026-08-15 |

The Export page's **Journal profile** dropdown shows the full journal name as written above. Settings and the References view shorten the long ones — `Brain Stimul.`, `J. Neural Eng.`, `J. Neurosci.`, `SLEEP Adv.` — because those controls are narrower.

## SUNA style, for a project with no journal yet

`SUNA style` is the house style and the only bundled entry not derived from a journal's guidelines. Onboarding falls back to it when you decline to pick a target journal, and it is the fallback whenever a render profile cannot be resolved.

It states no word limits, no abstract limit and no required sections, so it flags almost nothing — which is what you want while the paper is still being written. Its own notes put it plainly: switch to a journal profile before submission to get that journal's rules.

It is also the typographic base underneath every other profile: US Letter, 12.7 mm (0.5 in) margins, Times New Roman, 11 pt body at 1.15 line spacing, 14 pt title, 13/11 pt headings, 10 pt captions and references with a 12.7 mm hanging indent, and a page break after the front matter. A journal profile contributes only the small deltas its guidelines state. In practice only two bundled profiles state any at all: SLEEP (figures labelled "Figure", captions collected in a list after the text, tables at the end, references starting a new page) and Brain Stimulation (only "Fig." as the figure label). Every other journal inherits the SUNA layout whole.

## What a profile controls

| Block | Rules it carries |
| --- | --- |
| Citations | In-text mode, range collapsing, textual tokens, a reference-list entry template per work type, author truncation, journal-name abbreviation, DOI policy, sort order, maximum references |
| Figures | Width presets in mm, maximum height, minimum and maximum font size in pt, line-weight range, preferred fonts, palette guidance, accepted vector and raster formats with a minimum dpi, panel-label convention |
| Manuscript | Per-article-type abstract, word, title, display-item and reference limits; required sections; data and code availability statements; running-head limit; submission format |
| Document style | Optional deltas over the SUNA house style — figure label, figure and table placement, whether references start a new page, typography |
| Notes | Free text from the transcription: caveats, publisher quirks, and rules the schema has no slot for |

<figure class="shot">
  <img src="/shots/export.webp" alt="The Export page: a left column with Document, Format, Journal profile and Article type pickers and Double spacing / Line numbers / Page numbers checkboxes, a compliance check listing two errors each ending in a guideline URL, and a right-hand REQUIREMENTS panel of the journal's stated rules." />
  <figcaption>Everything in the right-hand REQUIREMENTS panel is read straight out of the selected profile. Change the Journal profile dropdown and the whole panel, the checkbox defaults and the compliance results change with it.</figcaption>
</figure>

Word limits carry a scope string and a hard/soft flag: a soft limit reports as a warning, a hard one as an error, and the scope text decides whether the abstract, captions and an estimated reference-word count count towards the measured total. Nature's Article limit, for example, is 4300 words soft, with a 200-word abstract, a 75-character title, at most 6 display items and 50 references. A SLEEP Research Letter is 1200 words hard, 1 display item, 10 references.

Figure rules vary just as much, and several journals state nothing at all:

| Profile | Width presets | Text size | Stroke | Minimum dpi |
| --- | --- | --- | --- | --- |
| SUNA style | 127 / 152 / 178 mm | 7–12 pt | 0.5–2 pt | 300 |
| Nature | 89 / 183 mm, max height 247 mm | 5–7 pt | 0.25–1 pt | 300 |
| Science | 90 / 183 mm | 6–9 pt | ≥0.28 pt | 300 |
| PNAS | 87 mm (single only) | ≥6 pt | not stated | 300 |
| Brain Stimulation | 90 / 190 mm | not stated | not stated | 300 |
| Journal of Neural Engineering | 85 / 150 mm | 8–12 pt | not stated | not stated |
| SLEEP | not stated | not stated | not stated | 300 |

Neuron, JNeurosci and SLEEP Advances state no width presets either; Neuron states an overall 200 mm height maximum instead of a column grid. Where a preset is unstated, the canvas and the export still offer generic fallback widths (89 / 120 / 180 mm) so no dropdown row is missing.

The active profile is what the [compliance check](/publishing/compliance) measures against, what the References view renders your bibliography in, and what [export](/publishing/export) rasterizes figures at. Agents see the same rules through the read-only `check_manuscript` and `check_figure_compliance` verbs — see [MCP](/ai/mcp).

## Choosing and switching

You first choose in onboarding, on the **Target journal** step, whose cards show each journal's citation style, its figure widths as single/1.5/double mm, and its first article type's abstract limit. There is a decide-later option, which leaves you on SUNA style.

Afterwards there are three places to change it.

| Where | Control | Effect |
| --- | --- | --- |
| Settings | **Preview / render profile** — "Which publisher profile the References view and the combined manuscript preview render as" | Per-project view preference |
| References view | The **Rendered as** chips under a selected entry | Per-project view preference |
| Export page | The **Journal profile** dropdown | This export and this compliance run only |

The two controls are not the same store. The References **Rendered as** chip is a machine-local view preference, remembered per project folder and never written to `suna.json`. The Settings row **Preview / render profile** writes `previewProfileId` into `suna.json`, so that one travels with the repository. Neither changes `activeProfileId`, the journal the project is actually aimed at. The Export page starts from your project's profile and lets you point a single export somewhere else without disturbing it.

<figure class="shot">
  <img src="/shots/references.webp" alt="The References sidebar: Library and Search tabs, a filter box, All / Cited / Uncited chips, entries with Find PDF and Attach PDF buttons, and a RENDERED AS row of journal chips above a formatted in-text citation preview." />
  <figcaption>The Rendered as chips re-render the entry and the in-text preview in another journal's style. Nothing in references.bib changes.</figcaption>
</figure>

**Switching a profile changes nothing in your source.** Your prose, `manuscript.json`, `authors.json` and `references.bib` are untouched; reference formatting and every number in the paper are derived at format time, never stored. Switch to Science, look at the bracketed numbers, switch back to Nature, and the files on disk are byte-for-byte what they were.

Two switching details worth knowing. Article-type ids are journal-specific, so changing the journal on the Export page resets **Article type** to "None — generic journal overview". And "None" does not skip the check: the checker falls back to the profile's first declared article type, its primary research-article type. "None" only changes which type the requirements panel spotlights.

## Two profiles that are not yet trustworthy

::: warning Verify these against the live guidelines
**Neuron** and **SLEEP Advances** carry explicit caveats in their own notes, shown in the requirements panel.

Neuron's entire profile was assembled from search-engine excerpts of cell.com pages that refused direct retrieval. Its notes call this "materially lower-confidence sourcing than the Nature and Science entries" and ask you to re-verify against the live pages "before relying on any 'documented' claim here for a hard compliance check".

SLEEP Advances was fetched directly, but its guidelines page is materially thinner than SLEEP's: it documents article-type word, reference and figure limits and is silent on citation style, figure preparation and submission formatting. Because the schema cannot leave citation mode empty, its citation style is a conservative placeholder, not a documented fact — and deliberately not borrowed from sibling journal SLEEP. Verify it before you submit.
:::

PNAS and JNeurosci were also assembled from search excerpts rather than a direct read of the publisher's site, and both say so in their notes. Read the Notes section of the requirements panel before you trust a specific number from any profile.

## Not built yet

::: warning You cannot add your own profile
Nothing today reads a profile JSON you write yourself — not from your project folder, not from a settings directory. The ten bundled profiles are the whole set. If your target journal is not among them, work in SUNA style and check that journal's guidelines by hand.
:::

::: warning Manuscript compliance lives only on the Export page
Manuscript-side diagnostics are not surfaced in the Manuscript tab while you write. You see them on the Export page, or through the `check_manuscript` MCP verb. Figure diagnostics do appear live, as the issue chip on the [canvas](/figures/canvas).
:::

There is also no submission-stage selector. Every check runs at initial submission.
