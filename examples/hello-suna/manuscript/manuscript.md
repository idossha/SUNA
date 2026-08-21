Hello,

This starter manuscript is a working tour of the editor — every feature below is live, so change a word and watch what happens. When you have seen enough, select all and start writing your own paper.

Prose is Markdown with a few additions for scientific writing. A citation is its BibTeX key in square brackets [@knuth1984], and the reference list at the end of an export is derived from the keys you actually cite — never hand-maintained. Cite two at once like this [@knuth1984; @wong2011].

Maths is LaTeX. Inline, it sits in single dollars ($E = mc^2$); on its own line it takes double dollars and, optionally, a label you can point at:

$$ {#eq:hello}
\mathrm{manuscript} = \mathrm{prose} + \mathrm{figures} + \mathrm{references}
$$

That is @eq:hello — the number is worked out at export time, so inserting another equation above it renumbers everything for you.

# Results

A figure lives in its own folder under `figures/` as an SVG you can edit on the canvas. Embed it where it belongs in the prose:

![[fig:hello]]

Refer to the whole figure as @fig:hello, or to one panel of it as @fig:hello{a}. Captions are not written here — they live with the figure, so moving the embed never separates a figure from its caption.

A second figure comes from code rather than from a steady hand. `figures/timesheet/source/plot.py` reads `data/timesheet.csv` and writes the SVG beside it, so the figure in the manuscript and the numbers on disk cannot disagree:

![[fig:timesheet]]

The weekly cost of all four chores falls after the week marked in @fig:timesheet, which is the same claim the bars in (@fig:hello{b}) make in summary form, and a straight-line fit to the happiness log gives $+0.31$ points per week under SUNA against $-0.12$ for the control (`results/happiness_fit.json`, written by `analysis/fit_happiness.py`). We report this in the spirit in which it was measured.

Tables work the same way: an embed line carrying the caption, followed by the table itself in plain Markdown.

![[tbl:hello]]

| Piece | Where it lives | Format |
| --- | --- | --- |
| Prose | `manuscript/manuscript.md` | Markdown |
| References | `manuscript/references.bib` | BibTeX |
| Figures | `figures/<id>/figure.svg` | SVG |
| Metadata | `manuscript/manuscript.json` | JSON |

Every one of those is a plain-text file under version control. There is no SUNA file format, and nothing here is locked away from another tool (@tbl:hello).

# Methods

Describe how the work was done. Headings become the outline in the left sidebar, and the export applies whichever profile the project is set to — SUNA style while you draft, a journal's rules once you know where this is going.

None of the practice here is invented. Writing the analysis down so somebody else can rerun it is old advice [@wilson2014; @sandve2013]; the tools that do the arithmetic and draw the pictures are themselves citable [@hunter2007; @harris2020; @virtanen2020; @perez2007]; the typesetting tradition this file is a plain-text descendant of is older than the author [@lamport1994]; and the thing quietly keeping every version of it is older than the paper [@chacon2014; @git]. A reference list is derived from the keys above, in order of first appearance, whatever order they sit in `references.bib`.

Code goes in a fence tagged with its language, and is highlighted the same way in the editor and in Reading mode:

```python
import matplotlib.pyplot as plt
import suna_mpl

# A figure normally comes from code kept beside it, in
# figures/<id>/source/. Figure 1 does not: it was drawn by hand, and the
# referees noticed.
with plt.rc_context(suna_mpl.journal_rc()):
    fig, ax = plt.subplots()
    suna_mpl.set_size(fig, "double", height_mm=58.0)
    ax.plot(time_on_project, happiness, label="SUNA")
    ax.set_xlabel("Time on project")
    ax.set_ylabel("Researcher happiness")
    suna_mpl.save_svg(fig, "figures/hello/figure.svg")
```

`suna_mpl.save_svg` writes text as real `<text>` elements rather than outlines, which is what keeps a figure's labels editable on the canvas after it has been exported.

When Markdown genuinely cannot say a thing, a `{=latex}` fence passes the source straight through to the LaTeX export untouched, and every other exporter skips it:

```{=latex}
\begin{tabular}{ll}
  Escape hatch & used once \\
  Regret       & none \\
\end{tabular}
```

Three things worth trying before you delete this file:

1. Open `figures/hello/figure.svg` to edit the figure on the canvas.
2. Open the Export tab to see the profile's requirements and export a PDF.
3. Open the cover letter and the review round in the Writing panel — a paper is
   more than its manuscript, and both are here already, part-answered.
