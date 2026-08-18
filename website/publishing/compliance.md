# Compliance checks

SUNA measures your manuscript and your figures against the journal profile you selected, names each rule it thinks you have broken, and links the guideline it came from. It never rewrites your work and never stops an export.

## Advisory, always

A compliance check is a reading, not an edit. Every diagnostic states the measured value against the stated rule — "Abstract is 312 words, over the 200-word limit" — and appends the URL of the author guidelines the rule was transcribed from, so you can check SUNA's homework in one click. The figure checker's own source note puts it plainly: flags only, the SVG is never modified.

This is deliberate. A checker that silently reflowed your abstract to 200 words would be making an editorial decision on your behalf, and you would not know it had happened. SUNA tells you the number and leaves the sentence to you.

Rules the journal does not state are not invented. Where a profile records `null` — SLEEP states no figure widths, fonts or stroke weights at all — the corresponding check is skipped entirely rather than falling back to a guess. See [journal profiles](/publishing/profiles) for how that data is sourced and marked.

## Where checks run today

Two surfaces run checks, and they check different things.

| Surface | What it checks | When it runs |
| --- | --- | --- |
| The Export tab | The manuscript: limits, required sections, availability statements, figure cross-references | Before every export, automatically |
| The figure canvas | One figure's SVG: type sizes, stroke weights, artboard width, raster resolution, color use | On load and after every edit |

::: warning Not built yet
Manuscript diagnostics do not appear in the manuscript editing view. If your abstract is over the limit, nothing in the editor says so — you find out when you open the Export tab, or when you ask an agent to run `check_manuscript`. A manuscript-side compliance UI is listed as remaining work on the roadmap.
:::

<figure class="shot">
  <img src="/shots/export.webp" alt="The Export tab: pickers for Document, Format, Journal profile and Article type on the left, three submission-format checkboxes, and a COMPLIANCE CHECK block listing two red-dotted errors with guideline URLs; the right column is a REQUIREMENTS panel of the journal's stated rules." />
  <figcaption>The check runs before export and lists what it found. The right-hand panel is the journal's own stated requirements, shown for reference — the two columns answer "what did I break" and "what are the rules".</figcaption>
</figure>

## Manuscript rules

These eleven rules are the whole manuscript checker. Nothing else is checked.

| Rule | Severity | What it measures | Example message |
| --- | --- | --- | --- |
| `ms.abstract-words` | error | Abstract length against the article type's limit | Abstract is 312 words, over the 200-word limit |
| `ms.word-limit` | warning or error | Total length against the article type's limit, counting whatever the journal's stated scope includes | Manuscript is ~4620 words, over the 4300-word limit (main text) |
| `ms.title-chars` | error | Title length in characters | Title is 91 characters, over the 75-character limit |
| `ms.running-head` | error | Short title length in characters | Running head is 63 characters, over the 50-character limit |
| `ms.section-missing` | error | A section the journal requires is absent | Required section "Methods" is missing |
| `ms.availability-data` | error | A required data availability statement is empty | The journal requires a data availability statement; none is present |
| `ms.availability-code` | error | A required code availability statement is empty | The journal requires a code availability statement; none is present |
| `ms.display-items` | error | Figures plus tables against the limit | Manuscript has 8 display items (6 figures + 2 tables), over the limit of 6 |
| `ms.max-references` | error | Reference count against the limit | Manuscript cites 62 references, over the limit of 50 |
| `ms.figure-ref-unknown` | error | Prose cites a figure number that does not exist | Prose references Figure 7, but the manuscript has 5 main figures |
| `ms.figure-uncited` | warning | A managed figure is never referenced in the text | Figure 3 ("psd-by-band") is never referenced in the text |

Two of these are worth a note.

`ms.word-limit` is a warning when the journal's limit is soft and an error when it is hard — Nature's 4300 words for an Article is soft, SLEEP's 1200 for a Research Letter is hard. What gets counted follows the journal's stated scope: the abstract is included unless the scope excludes it, and captions and references are added in only when the scope mentions them. Where references count, they are estimated rather than typeset, and the message says so.

`ms.figure-uncited` knows the difference between your figure and someone else's. A mention of "Figure 2" sitting next to an author name reads as a citation of another paper's figure and does not count as a reference to yours; when that happens the message tells you it discounted it.

## Violations never block an export

The Export tab states this in the interface. A run with problems reads:

```text
2 errors, 1 warning — export anyway if you choose; nothing here blocks it.
```

A clean run reads `No issues found.` At most the first 30 diagnostics are listed. The Export button is enabled either way — there is no override to click, no confirmation to dismiss. You are over Nature's word limit today because you are still drafting; that is not SUNA's business to prevent.

Two more things about when the check runs. Choosing **Article type: None — generic journal overview** does not skip the check: the checker falls back to the profile's first declared article type, which is its primary research-article type. "None" only changes which type the requirements panel spotlights. And checks are not run at all when **Document** is set to Supplementary Information — the page says so where the results would otherwise be.

The mechanics of the export itself are in [Export](/publishing/export).

## Figure compliance

Figure checks live in [the canvas](/figures/canvas), not in the export flow, and they run against the SVG you are editing. Any diagnostic puts a chip in the canvas toolbar reading "3 issues" — red when at least one is an error. Click it to expand the list; each row shows a severity dot, the rule id and the message. The check re-runs on load and after your edits, so the count tracks the drawing.

<figure class="shot">
  <img src="/shots/canvas.webp" alt="The figure canvas: a tool rail down the left, a LAYERS tree, a millimetre-ruled artboard holding a plot, and a PROPERTIES rail on the right with Align, Figure, Palette, Agent and Export sections." />
  <figcaption>Figure checks measure the artboard in millimetres and the type in points — the same units the journal states its rules in.</figcaption>
</figure>

| Rule | Severity | What it measures | Example message |
| --- | --- | --- | --- |
| `fig.min-font` | error | Any text below the stated point minimum | Text "Time (s)" is 4.5pt, below the journal's 5pt minimum |
| `fig.max-font` | error | Any text above the stated point maximum | Text "A" is 14pt, above the journal's 7pt maximum |
| `fig.line-weight` | error | Stroke width outside the stated range | Stroke width 0.15pt on \<path\> is below the journal's 0.25pt minimum |
| `fig.artboard-width` | warning | Artboard width against the journal's column presets, within 1 mm | Artboard width 190mm matches none of the journal's width presets (single 89mm, double 183mm) within 1mm |
| `fig.raster-dpi` | error | Resolution of an embedded PNG at its placed size | Embedded PNG renders at ~144 dpi (504px over 89mm), below the journal's 300 dpi minimum |
| `fig.color-sole-delimiter` | warning | Traces distinguished by color alone — same dash, similar width | Traces in group "ax0" differ only by stroke color (#0072b2, #d55e00) — same dash pattern and similar widths; the journal discourages color as the sole delimiter |
| `fig.palette` | warning | A trace color outside the journal's suggested hex palette | Trace color #ff00aa is not in the journal's suggested palette |

Three caveats on the figure side.

`fig.palette` only fires for a profile that actually states suggested colors. Among the profiles the pickers offer, that is SUNA style alone, with its eight-color Wong ramp; under every other journal the rule is silently skipped.

Both color rules look only at data traces — shapes clipped to a plotting area, which is how matplotlib marks its data artists. Axis spines, tick marks, legend swatches and text are never flagged.

The canvas Export section repeats the count above the PNG and TIFF buttons as "2 issues — export anyway?" when at least one diagnostic is an error. Like the manuscript version, it is a nudge with no teeth. A crash inside the checker is swallowed rather than surfaced, because a broken advisory check should not take the canvas down with it.

You can also run the check on demand from the command palette: **Run Compliance Check**, under Figures, enabled while a canvas is active.

## Asking an agent

Both checkers are exposed to agents as read-only MCP verbs — `check_manuscript` and `check_figure_compliance` — so you can ask in prose and get the same diagnostics back, without the agent being able to alter anything in the course of looking. Both check against the project's active profile and return `no active publisher profile: nothing to check against` when there is none. `check_manuscript` takes no article-type argument; it always uses the profile's first declared type. See [MCP verbs](/ai/mcp).
