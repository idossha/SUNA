# ROUNDS.md — importing a reviewer report

A revision round lives at `rounds/<id>/`. Its reviewer records are written once, by the
import screen, from one blob of text: a pasted decision letter, or a `.docx`/`.pdf` the
app extracts text from. Everything downstream — point status, the response document,
`check_response` — reads those records. So the import is the only place where a reviewer's
words enter the project, and it is worth understanding before you paste.

## The two guarantees

**Every point is a contiguous slice of the source.** Points are stored as `[from, to)`
offsets plus the text at those offsets, and the commit step refuses outright if the two
ever disagree. A reviewer's sentence gets quoted back to them in the response letter, so
"close enough" is not a category that exists here.

**Nothing is silently dropped.** The failure that matters is not a mis-split — a human
fixes those on the review screen in seconds — it is a paragraph that vanishes between the
letter and the response. Every character inside a reviewer block is accounted for as a
point, a recognised heading, or a reported gap, and the coverage meter is the sum. A real
response document in the evidence set numbered its replies to RE83 with RE58 missing; that
is the class of defect this is built to make impossible.

## Hand it over raw

Paste the letter **exactly as it arrived**. Do not tidy it first. The segmenter reads
structure — blank lines, list markers, headings, the reviewer delimiters — and every
"helpful" cleanup destroys some of it:

- **Do not re-wrap or join paragraphs.** A blank line is a point boundary. Joining two
  paragraphs merges two points; removing blank lines from a list turns it into one.
- **Do not renumber or re-letter points.** The numbers are the reviewer's, they get quoted,
  and the response letter's own numbering is derived separately.
- **Do not merge or reorder reviewers.** Each reviewer becomes its own record; a merged
  letter imports as one reviewer and every point is misattributed.
- **Do not paraphrase, spell-correct, or expand abbreviations.** These are someone else's
  words under their name. Typos included.
- **Do not strip the editor's covering letter.** Text before the first reviewer delimiter
  is kept as the preamble and left out of the points on its own.

If the source is a `.docx` or `.pdf`, point the importer at the file rather than pasting
from a preview — the app runs the same extraction either way, and copying out of a viewer
is where hard line-breaks and lost blank lines come from.

## Shapes that segment cleanly

All of these are handled with no model and no network. Reviewer delimiters:

```
Reviewer #1:  The authors present…      ← inline; how editorial systems email it
**Reviewer #2:**                        ← its own line; how a .docx exports
Reviewer #3 (Remarks to the Author):
Referee #1:
```

Section dividers inside a reviewer's block — a point never absorbs one:

```
Major comments / Minor issues / Detailed comments:      ← comment-class headings
Introduction / Methods / Results / Discussion / Figures ← walking the manuscript
### COMMENTS PER SECTION                                ← markdown heading
OVERALL / INDIVIDUALIZED VS. GENERALIZED MODELS         ← ALL-CAPS domain labels
```

Points: numbered (`1.`, `2)`, `(3)`), bulleted (`-`, `*`, `•`), or blank-line-separated
paragraphs. The two coexist — a block that opens with prose, turns into a bullet list and
closes with prose keeps all three parts.

A letter with no reviewer delimiter at all imports as a single reviewer rather than
failing. That is the right answer for a pasted fragment, and the wrong one for a letter
whose delimiters you should have kept.

## Re-importing last round's response

A response document interleaves the reviewer's paragraph with our answer behind an `RE12:`
marker. The importer cuts at the marker: the reviewer's words become the point, the answer
is kept beside it as the reply, and neither is confused for the other. This is how you
recover both sides of a previous round without quoting our own prose back at the reviewer.

It also reads the numbers. **Skipped reply numbers are reported on the import screen** —
a sequence that runs RE57, RE59 says so out loud, which is the check a hand-maintained
numbering cannot perform on itself.

## Reading the review screen

Import is two passes and the first one writes nothing. Look at three things before
committing:

| Signal | Means | Do |
|---|---|---|
| Coverage below 100% | text inside a reviewer block landed in no point | click the highlighted gap; usually a lost blank line in the source |
| A reviewer with 0–1 points | the block could not be split | fix the source's blank lines, or accept and split by hand later |
| Missing reply numbers | the source document skips one | find it in the original before importing |

Fix problems **in the source text**, not by editing points afterwards — the source is what
every verbatim is checked against, and it is retained with the round so any later split or
merge can be re-derived and re-verified.

## Once imported

**Never edit a reviewer's words.** `rounds/<id>/reviewers/*.json` is a transcript, not a
draft. Our side of it — status, assignee, the reply — lives elsewhere: `set_point_status`
for progress, the response document for prose. `check_response` names every unaddressed
point before export.
