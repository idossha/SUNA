# Peer review

Answering referees is its own job, with its own workspace. A **round** in SUNA is the record of one circulation — internal to co-authors, or external to a journal — and the response letter is *derived* from that record rather than typed out separately.

## The placement rule

One rule explains the whole design:

> `manuscript/` is prose you edit. `rounds/` is the ledger.

Nothing under `rounds/` is a file you open and type into. It holds the reviewers' verbatim text, the point states, and the decisions. The sharpest consequence is the reviewer point: a referee's words live in `rounds/<id>/reviewers/*.json` and never in a file you edit, which makes immutability **structural** rather than a rule someone has to remember. Editing a reviewer's words is misconduct; here it requires deliberate JSON surgery instead of a keystroke.

## Importing a report

Reviews arrive as an email body, a PDF, or a `.docx`. Paste the text or point SUNA at the file, and the importer segments it: reviewer blocks, then numbered points inside each.

The parser reads the shapes real reports come in — `**Reviewer #1**:` and `**Reviewer #2:**`, "Reviewer #N (Comments for the Author)", pandoc's `2\.` escaping, hard-break backslashes, sections like "Major comments" and "Minor issues" — and falls back to treating an undelimited report as a single reviewer rather than failing. Nothing is written until you have seen the segmentation and confirmed it.

Each point keeps **offsets into the source text**, not a rewritten copy, so the verbatim quote is a contiguous slice of what the reviewer actually sent.

## The response workspace

Open a round and you get every point with a reply box beside it.

<figure class="shot">
  <img src="/shots/round.webp" alt="A review round open in SUNA: a header reading Round 1, external, returned, with filter chips for All, Unaddressed, Drafted and Done, a Focus and Continuous toggle, a Compare button, a count of three of eleven points addressed, and an Export button. Below, a reviewer's verbatim point in a boxed quote with the author's reply beneath it in blue." />
  <figcaption>The reviewer's words are read-only and marked <em>verbatim</em>; the reply sits directly beneath, with its state on the row of buttons below.</figcaption>
</figure>

**Two modes, because answering eleven points and answering eighty-four are different jobs.** *Focus* is one point at a time, with nothing else on screen — the mode for actually writing. *Continuous* is every point in one scroll, for reading the whole thing the way an editor will.

Each point carries a state, and the header counts them:

| State | Meaning |
| --- | --- |
| `unaddressed` | no reply yet |
| `drafted` | written, not finished |
| `done` | answered |
| `rebutted` | we disagree, and here is why |

`rebutted` is a first-class outcome, not a failure. Every real response letter contains several, and a tool that models only compliance quietly pressures authors into conceding points they should defend.

## Three voices

A response letter is read one way: sentence by sentence, deciding who wrote this. Colour answers that before the sentence is read — and the scheme is not invented, it is what real response documents already use.

| Voice | How it renders |
| --- | --- |
| the reviewer's comment | black, upright |
| our reply | blue `#0432FF` |
| manuscript text quoted unchanged | black italic |
| manuscript text that is **new** | red `#EE0000` italic |

You write the last two with two plain-text marks: `::quote … ::` around a manuscript excerpt, and `+++ … +++` around the part of it that is new. Both are forgiving by construction — a half-typed reply is the normal state of a reply, so an unclosed `::quote` simply runs to the end of the reply and an unpaired `+++` stays literal text. Nothing rewrites your characters.

In the app those roles map onto theme tokens so they stay readable on a dark background; export always uses the values above, because an exported response is read on paper.

## What changed since they read it

The job a response letter does is quote the paper twice: once as the reviewer read it, once as it stands, with the difference visible. **Compare** puts those side by side.

A round points at a logged version (`baselineVersionId`) rather than keeping a second copy of the bytes — so the comparison is against the archive under `manuscript/archive/vX.Y`, and there is only ever one copy of any text. The diff covers prose, title page and back matter, abstract, availability statements and captions, and compares the bibliography by cite key. Unified reads better for prose; side-by-side for a wholesale rewrite; the toggle is in the header.

The comparison is a **source** for the letter, not only a picture of it: a hunk can be pulled into a reply as a `::quote`/`+++` block, already marked.

## Exporting the response

**Export…** builds the document from the ledger. Nothing in it is authored: the reviewer's words come verbatim out of `rounds/<id>/reviewers/*.json`, the replies out of the point states. So the response cannot drift from the workspace you actually worked in.

Two rules make it safe to send:

- **A reviewer's text is quoted, never rewritten.** It is copied out of the immutable record and escaped, and no code path touches it.
- **A point with no reply contributes no reply text.** SUNA does not answer a referee on your behalf, and does not paper over a gap.

Export stops once, by name, if points are still unaddressed — and lets you through on the second attempt. A response circulated to co-authors mid-revision is a normal thing to want, and a half-written one is a normal state to be in. Files land in `output/responses/` as DOCX, PDF or HTML.

## The AI gate

The ✦ button beside a reply box drafts an answer, and it is gated on something the other AI surfaces are not.

A response letter goes to an editor over the authors' names, and several publishers now require authors to disclose how AI was used in preparing one. So before SUNA drafts anything, a person must read the instructions the agent will follow — `context/PEER-REVIEW.md`, covering voice, what a reply must contain, how to quote, and what not to claim — and say in as many words that they accept them. The record goes in `suna.json`: timestamp, who, which route, and a hash of the exact text they approved. Change the instructions and the approval is asked for again.

When a draft comes back it lands in a **proposal panel beside your own text, never in the box**. Prose that arrives while you are looking elsewhere is prose nobody chose; **Use this** is a deliberate act, and discarding is free and leaves no trace.

## What a good reply looks like

The guidance SUNA gives the agent is the same guidance it would give you, and it is worth reading whether or not you use the AI:

- First person plural, addressing the reviewer directly. Thank the reviewers **once**, in the opening paragraph to the editor — per-point thanks read as padding by the third one.
- Courteous and unservile: colleagues answering a colleague, not petitioners. No "we are excited to", "insightful comment", "we sincerely appreciate".
- Say what changed **and where**. "We have revised the Methods" is not a reply; "We now report the split-half reliability (Methods, §2.3) and it is r = 0.91" is.
- For a change too large to quote, name the section and summarize it in one sentence. Do not open a quote block you cannot fill with real manuscript text.
