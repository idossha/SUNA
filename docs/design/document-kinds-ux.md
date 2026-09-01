# Document kinds — the interaction design

> **Historical design note.** The contract is [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the
> decisions are in [`docs/DECISIONS.md`](../DECISIONS.md). This file is kept for the detail and the
> sourcing it carries, but where it disagrees with the contract the contract wins — and
> `ARCHITECTURE.md` §20 lists the places it is known to. Do not treat anything here as current.

Companion to `feature-plan-12.md`, which specifies the schemas, the checks and
the files. This document specifies what the user *does*, and it replaces §11's
table with a design. It sits beside the plan the way
`canvas-editing-suite.md` sits beside `adr-003-editing-suite.md`.

The plan is honest about what it was: a data model. Everything in it is
reachable only through a command palette entry and a file the user has to know
to open. That is not a feature; it is a schema with a keyboard shortcut. What
follows is the half that makes it a product.

---

## The principle: three beats

Every document kind — letter, response, report, package — gets the same three
beats, and nothing is finished until all three exist.

| beat | what it means | the failure it prevents |
|---|---|---|
| **Create** | One visible button. Sensible defaults from the project. AI draft optional, never mandatory, never silent. | "I know SUNA can do cover letters but I can't find where." |
| **Work** | A purpose-built tab, not a raw Markdown file. The thing you are attending to is the thing on screen. | "It imported the reviews into a file. Now what?" |
| **Finish** | A check that names exactly what is missing, by item, not a boolean. | Submitting with reviewer point 3.2 unanswered. |

Two rules hold across all of them.

**The files stay plain and visible.** Every tab is a view over Markdown and
JSON that the Explorer shows and git diffs. A user who hates the letter tab can
edit `manuscript/letters/cover-science.md` by hand and lose nothing. The UI is
never the only door.

**Every button is a verb.** Each action in this document maps to one of the MCP
verbs in plan §10. There is no UI-only capability, which is the existing
doctrine — "UI gestures and AI agent calls are equal clients" (`CLAUDE.md`) —
applied to the new kinds.

---

## §A — Adding a letter (ask 1)

### A.1 The button

The sidebar's `manuscript` view becomes **Documents**. Its header carries a
`+` that opens a menu, exactly where `FiguresView` puts `NewFigureButton`
(`views/FiguresView.tsx:56`):

```
Documents                                    [+]
─────────────────────────────────────────────────
  ▾ Manuscript              Cover letter
      Introduction          Response to reviewers
      Methods               Internal report
      Results               ─────────────────
  ▸ Cover letter (Science)  Grant proposal…
  ▸ Response — round 2
```

`NewFigureButton`'s pattern — a button that becomes an inline field, Enter
commits, Escape cancels, no modal — is right for a figure, which needs only a
name. A letter needs four decisions, so it opens a **sheet**. That is the one
place this design adds a control the codebase does not already have; every
other surface below reuses an existing one.

### A.2 The New Letter sheet

Writes nothing until **Create**. This is the `DocxImportTab` contract
(`import/DocxImportTab.tsx`) — analyse, show what was detected *and why*, let
the user correct it, write on confirm — and it is the strongest UX convention
this codebase has. Every new flow here obeys it.

```
  New letter                                              ✕
 ─────────────────────────────────────────────────────────
  Kind      ( • ) Submission cover letter
            (   ) Cover letter for a revision
            (   ) Appeal                     [not in v1]

  Journal   [ Science                     ▾ ]
            Requirements for this journal ────────────────
            • Statement of significance          required
            • No dual submission                 required
            • Suggested reviewers                optional
            • Competing interests                required
            ⚠ 2 requirements quoted from an indexed
              result — science.org refused a direct fetch

  Signed by [ Aviad Hai (corresponding)    ▾ ]
            From authors.json. Letterhead: Hai Lab ▾

  Start from
            (   ) Empty skeleton
            ( • ) Seeded from the manuscript
            (   ) AI draft   [ matching: my Nature letter ▾ ]

                                    [ Cancel ]  [ Create ]
```

**Journal** defaults to `activeProfileId` from `suna.json`. Changing it
re-renders the requirements list live, off the profile's `letters` block. This
is the moment the user learns Science wants something Nature does not — before
writing, not at submission. Where a profile states nothing the list says so
rather than showing an empty box, and where a quote came from an indexed result
rather than a fetched page the sheet says that too (plan §2c,
`basis: 'documented-indexed'`).

**Signed by** defaults to the corresponding author in `authors.json`.
Letterhead comes from the machine-level identity in `~/SunaConfig` — the same
place `library.json` already lives (`main/services/library.ts:5`) — because a
lab's letterhead belongs to the person, not to one paper.

### A.3 The three start-from modes

| mode | what lands | network |
|---|---|---|
| **Empty skeleton** | Headings and empty paragraphs. Every requirement a `TODO` line. | none |
| **Seeded** (default) | Paragraphs pre-filled from project data — title, journal, article type into the opening; `manuscript.json.significance` into the significance paragraph; `availability` and `backMatter` into the statements. Deterministic, pure, unit-testable. | none |
| **AI draft** | The agent writes real prose. | agent CLI |

Seeded is the default because it is instant, offline, correct, and produces
about 60% of a real letter — the opening, the statements and the sign-off are
mechanical. The AI is for the two paragraphs that actually argue.

### A.4 The AI draft, and what it is not allowed to do

The agent receives: the manuscript outline plus abstract and significance,
`authors.json`, `context/PROJECT.md`, the target profile's `letters` block, and
a **style exemplar**.

**Exemplars are the user's own letters, registered once.** The New Letter
sheet's *matching* picker lists what is in
`~/SunaConfig/Letters/exemplars/*.md`, and offers **Add exemplar…**, which
takes a `.docx` or `.pdf`, converts it to Markdown, strips the letterhead, and
stores it. The two letters in this design's evidence set — the Science cover
letter and the two-paper Nature letter — become the first two entries. SUNA
ships no exemplars of its own: shipping a stranger's real cover letter in an
app is not a thing to do, and a generic one would teach the AI to write like
nobody.

The draft **lands as a reviewable diff, not a write.** `revisions.json`
(`packages/core/src/revisions.ts`) stores the pre-image; the letter opens with
the AI's prose painted as word-level additions, and the standard accept/reject
affordances from feature-plan-11 apply unchanged. The user sees an offer, not a
fait accompli. Progress and a working Cancel come from `ai-ask`, which already
kills its child process on cancel.

**The AI drafts the argument. The human answers the affidavit.**

A cover letter contains factual assertions — that the work is not under
consideration elsewhere, that there are no competing interests, that a named
person has or has not seen the draft. An AI asserting those on a researcher's
behalf, in a document that goes to an editor over their signature, is the one
thing in this whole feature that could do real damage. So the assertions are
not prose at all: they are a **structured form in the Assertions panel**, and
the letter's statement paragraphs are generated from the answers.

An unanswered assertion renders in the editor as a visible marker —

```
⟦ unanswered — dual submission ⟧
```

— shows as an error in the Assertions panel, and **blocks export**. It is not a
warning. This is the existing doctrine (flag, never silently fill) applied
where the stakes are highest, and it is the reason the AI route is safe to
offer at all.

### A.5 The letter tab

`ManuscriptTab` minus the title page, plus an **Assertions** panel in the right
rail beside the comments rail:

```
┌──────────────────────────────────┬─ Assertions ──────┐
│ Dear Editor,                     │ ✓ Significance    │
│                                  │ ✓ No dual submis. │
│ Please find attached our         │ ⨯ Competing int.  │
│ manuscript entitled "…" which    │   [ none ] [ … ]  │
│ we submit for consideration as   │ ○ Suggested revs  │
│ an article in Science.           │   optional        │
│                                  │ ─────────────────  │
│ ⟦ unanswered — competing ⟧       │ Science requires: │
│                                  │ "…"  ↗ source     │
└──────────────────────────────────┴───────────────────┘
```

`RequirementsPanel.tsx` (`export/RequirementsPanel.tsx`, 224 lines) already
renders a profile's requirements with source links for export. The Assertions
panel is that component with editable stances — a fork of a solved problem, not
a new one.

The nine checks in `check/letter.ts` run live, so the Science / Science
Advances mismatch found in the evidence set surfaces as you type, not at
submission.

---

## §B — Importing reviewer comments (ask 3, the front door)

### B.1 One entry, two routes

The user asked for a file attachment **or** a paste box. Those are not two
flows — they are two ways to produce one string. One sheet does both:

```
  Import reviewer comments                                ✕
 ─────────────────────────────────────────────────────────
  Round     [ Round 2 — Nature Neuroscience  ▾ ] [ + New ]

  ┌───────────────────────────────────────────────────┐
  │                                                   │
  │        Drop the decision letter here              │
  │              .docx  ·  .pdf  ·  .txt              │
  │                                                   │
  │            — or paste it below —                  │
  └───────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────┐
  │ Reviewer #1 (Comments for the Author):            │
  │                                                   │
  │ Example A et al., performed continuous cortico-…    │
  └───────────────────────────────────────────────────┘

                                  [ Cancel ]  [ Analyse ]
```

The paste box matters more than it looks. Editorial decisions arrive as email
body text at least as often as attachments, and every tool that demands a file
forces the user to make one.

The file half of this is **already built**. `analyzeDocument(path)`
(`main/services/document-import.ts:188`) already accepts all three formats the
user asked for — `IMPORTABLE_DOCUMENT_EXTENSIONS` is `['docx', 'pdf', 'html',
'htm']` (`:24`), `.docx` through `mammoth` and `.pdf` through pdfjs text items
reassembled into paragraphs (`:153-163`). Reviewer import reuses that
extraction and only adds the segmentation pass on top. No new file-reading code
is needed for any of the three routes.

### B.2 Segmentation: deterministic first, AI only if asked

**Pass 1 runs instantly and offline.** Structure detection over the source:
reviewer delimiters (`Reviewer #1`, `Reviewer 2:`, `Referee #3`), section
headings (`Major comments`, `Main issues`, `Minor points`), and numbered or
bulleted points beneath them. Both real examples in the evidence set match this
grammar — `**Reviewer #1**:` with `Main issues` and numbered points; five
`**Reviewer #N**` blocks in the other — so the common case needs no model at
all.

**Pass 2 is offered, not run.** If a reviewer block came back as one
2,000-word lump, the screen says so and offers *Suggest a split* →
`propose_review_segmentation`, which writes to `reviewers/_proposed/` and never
to the real records. A human confirms, always. Plan §6 already requires this;
this is where it surfaces.

### B.3 The review screen

`DocxImportTab`'s two-column shape, which is the house pattern for "here is
what I found, correct me, nothing is written yet":

```
┌─ source (read-only) ───────┬─ 19 points found ─────────────┐
│ Reviewer #1 (Comments…)    │ ▾ Reviewer 1 · 7 points       │
│ ░░░░░░░░░░░░░░░░░░░░░░░░   │   1.1  Is the main claim …    │
│                            │        numbered point under   │
│ **Main issues**            │        "Main issues"          │
│ ▓1.▓ Is the main claim     │        [split] [merge↑] [✕]   │
│ ▓here that the thalamo-▓   │   1.2  The analysis in Fig 3… │
│ ▓cortical and hippo-  ▓    │ ▾ Reviewer 2 · 5 points       │
│ ░░ (unassigned) ░░░░░░     │ …                             │
│                            │                               │
│ ├──────────────────────────┴───────────────────────────────┤
│ │ 94% of the source is assigned   ⚠ 3 unassigned spans     │
└─┴──────────────────────────────────────────────────────────┘
                                     [ Cancel ]  [ Import 19 ]
```

Three things earn their place here.

**Every card says why.** "numbered point under 'Main issues', Reviewer 1" —
the `Detected: …` hint that `DocxImportTab` puts under every field
(`import/DocxImportTab.tsx:175`). A user who can see the reasoning can correct
it; a user shown a bare list can only accept it.

**The coverage meter is the safety rail.** The real failure mode is not a
mis-split, it is a silently dropped paragraph — which is exactly the defect
found in the evidence set, where a hand-maintained counter reached RE83 with
RE58 missing entirely. Unassigned source text is highlighted in the left column
and counted in the footer. You may import at 94%; you may not import at 94%
without seeing it.

**Nothing is written until Import.**

### B.4 After import, the words are frozen

ADR-009 decides that a reviewer's verbatim text lives in
`rounds/<id>/reviewers/*.json` and is immutable. The UX consequence is worth
stating plainly: **the point text has no edit affordance anywhere in the app.**
Not a disabled field, not a confirm dialog — no control at all. The only
operations are *split* and *merge*, which re-derive from the retained source
and cannot introduce a character that was not in what the reviewer sent.

Editing a reviewer's words is misconduct. Making it require deliberate JSON
surgery is a better guarantee than making it require a click-through.

---

## §C — Attending to points one by one (ask 3, the work)

This is what the user asked for and what the plan had no design for.

### C.1 The response workspace

One tab, three panes, because the task is irreducibly three-sided: the point,
your answer, and the manuscript you changed.

```
┌─ points ────────┬─ point & reply ─────────────┬─ manuscript ──────┐
│ ⌕ filter  ☑ mine│ Reviewer 2 · point 3        │ …the decay        │
│                 │ ┌─────────────────────────┐ │ constant was      │
│ R1  ●●●●○○○ 4/7 │ │ The analysis in Fig. 3  │ │ ▓fitted per-cell▓ │
│  1.1 ✓ done     │ │ pools cells across      │ │ ▓rather than      │
│  1.2 ✓ done     │ │ animals without…        │ │ ▓pooled▓ (n = 14) │
│  1.3 ◐ drafted  │ │           — verbatim ⊘  │ │                   │
│  1.4 ○          │ └─────────────────────────┘ │  ─────────────    │
│ R2  ●●●●●●● 7/7 │                             │  linked here:     │
│  2.1 ✓          │ We agree. We have refit…    │  R2 · point 3     │
│  2.2 ⊘ rebutted │ [ editable reply           ]│                   │
│ R3  ○○○○○ 0/5   │                             │                   │
│                 │ linked edits: 2  [⊕ link]   │                   │
│ 12 of 19 done   │ assignee: [ AT ▾ ]          │                   │
└─────────────────┴─────────────────────────────┴───────────────────┘
```

**Point states** are `unaddressed` · `drafted` · `done` · `rebutted`.
`rebutted` — we disagree and here is why — is a first-class outcome, not a
failure state. Every real response letter contains several, and a tool that
only models compliance quietly pressures authors to concede points they should
defend. It gets its own icon and its own colour, and the completeness check
treats it as addressed.

### C.2 Linking a reply to the edit that answers it

Select text in the manuscript pane → **Link to point 2.3**. Or, from the point,
press `⊕ link` and then select. Either way it records a link between a point
and a span of `manuscript.md`.

Two things fall out of that link, and they are the reason to build it.

**The quoted change writes itself.** The response document's `::quote`
construct renders the linked span's current text at format time. Authors quote
their revised text into responses by hand today and it goes stale the moment
they edit the manuscript again; here it cannot.

**The page and line reference is derived.** "As shown on page 7, lines
212–218" is computed from the export, not typed. This is `CLAUDE.md`'s
numbering rule — derived at format time, never stored — applied to the one
place in academic writing where stale numbers are most embarrassing and most
common.

### C.3 Knowing where you stand

Three surfaces, no new machinery:

- **Per-reviewer dots** in the points pane. `●●●●○○○ 4/7` reads at a glance.
- **Status bar**: `Round 2 — 12 of 19 points addressed`.
- **Problems strip**: every `unaddressed` point at export time is an error,
  named by reviewer and number. This is the check that would have caught the
  missing RE58 in the evidence set.

### C.4 Splitting the work between co-authors

The lab convention in the evidence set is a header reading `COLOR CODED
ATTENTION FOR CO-AUTHORS` and highlighted initials in the prose. That is a
real workflow implemented with the only tool Word offers.

SUNA gives each point an **assignee chip**, a `☑ mine` filter in the points
pane, and an internal report that can be filtered to one co-author — so
"here are your six points" is a generated artifact rather than a colour
someone has to maintain by hand. The colour coding is a workaround for missing
structure; the structure makes it unnecessary.

### C.5 Comparing two points side by side

Reviewers do not coordinate. The same objection arrives twice in different
words — R1's "no error budget" and R2's "the abstract claims quenching without
an uncertainty" are one problem — and the two replies have to agree with each
other. Scrolling between them does not work, because the point being answered
leaves the screen exactly when it is needed.

**Compare** is a toggle in the round header, next to Focus/Continuous. It puts
a second pane on the same round beside the first.

```
[All 14│Unaddr 1│Drafted 2│Done 11]  [Focus│Continuous]  [⧉ Compare]
┌─ A · Reviewer 1, point 1 ────────┬─ B · Reviewer 1, point 6 ───────┬─┐
│  ┌────────────────────────────┐  │  ┌───────────────────────────┐  │×│
│  │ …no error budget…  verbatim│  │  │ …colour scale…   verbatim │  │ │
│  └────────────────────────────┘  │  └───────────────────────────┘  │ │
│  our reply  [ editable ]         │  our reply  [ editable ]        │ │
└──────────────────────────────────┴─────────────────────────────────┴─┘
outline:  1.1 …ram-pressure…  ✓ [A]     1.6 …colour scale…  ✓ [B]
```

The rules that make it one feature rather than two workspaces:

- **Exactly two, always.** The cap is the type `RoundPane = 'a' | 'b'`, not a
  length check — there is no code path that produces a third. A third column
  of reply cards does not fit a laptop, and the task is pairwise anyway.
- **Same round, two selections.** Both panes read the same reports and the
  same header — mode, status filter, progress, export are the round's, not a
  pane's. What is per-pane is the selection, the scroll position and the
  scroll-spy. A reply typed in one pane is the same reply the other shows.
- **One pane is active**, marked in its header strip, and it is where the
  sidebar outline's next click lands. Touching a pane makes it active, so the
  interaction is "click the pane, then click the point". The outline marks
  both panes' points and tags them `A` / `B`, so the split can be read off
  the sidebar without hunting in the panes.
- **Off is as easy as on**: the same header toggle, pane B's own `×`, or
  `⌘⌥\` (`review.compare.toggle` in the palette). Closing keeps pane B's
  point, so reopening returns to the pair you were reading.
- **Not the dock's split.** `⌘\` opens a second dock group for a second
  *file*; a round is one file, and two dock tabs of it would be two copies of
  one header, one export button and one progress count.

---

## §D — Rounds, freezing and sharing (ask 2)

### D.1 The Rounds view

A sidebar view, rounds newest-first. This is the only place the lifecycle is
visible, and it should read like a lab notebook, not a state machine:

```
Rounds                                       [+]
────────────────────────────────────────────────
▾ Round 3 · internal            open
    frozen  6 Aug, 09:39   v3-internal
    out to  Kip, Andrew, Aaron
    back    2 of 3          [ triage 14 items ]
▸ Round 2 · Nature Neuroscience   revise
    19 reviewer points · 12 addressed
▸ Round 1 · Nature Neuroscience   rejected
```

### D.2 Freeze, and what the co-author receives

**Freeze** is one button. It flushes buffers, checks git status, writes an
annotated tag and a text snapshot, and renders the deliverables. The dialog
asks for a label and shows what will be captured — including a visible warning
if the tree is dirty, since a freeze over uncommitted work is a freeze of
something that is not in git.

The co-author does not have SUNA. What they get is a `.docx` with real tracked
changes and real Word comments, plus a change summary. What comes back is the
same `.docx`, marked up. **Import return** reads all four collaboration
channels — comments, threaded replies, tracked insertions and deletions, and
highlight runs — and lands them in the triage queue.

### D.3 Triage

The queue reuses the review screen's shape: the **rendered** quote (what the
co-author actually saw, since the DOCX renders citations as superscript
numbers, not `[@key]`) beside the mapped-forward source context. Accept /
retarget / dismiss-with-reason, per item.

Low-confidence and derived-span items are visually separated rather than mixed
in, because accepting a mis-anchored comment silently is worse than being made
to look at it. Nothing is dropped: anything the parser could not interpret goes
to an `uninterpreted` bucket that is shown, not swallowed.

---

## §E — Grant packages (ask 4)

The package tab is a **slot table**, because a package is a checklist with
documents attached:

```
NIH R01 — PA-25-301                        [ Check package ]
─────────────────────────────────────────────────────────────
 #  component                 limit    measured        state
 1  Project Summary          30 lines  22 lines        ✓
 2  Project Narrative        3 sent.   3 sentences     ✓
 3  Specific Aims            1 page    1 page          ✓
 4  Research Strategy        12 pages  13 pages        ⨯ over
 5  Biosketch — Ludwig       5 pages   4 pages         ✓ stale
 6  Biosketch — Shoffstall   5 pages   —               ○ not measured
 …
 ⚠ Page limits come from the Table of Page Limits. This NOFO's
   Section IV was not checked and supersedes it.
```

**Staleness is shown, never hidden.** A measurement is fingerprinted against
the content that produced it; edit the document and the row goes stale rather
than continuing to display a number that is no longer true. A measured value
SUNA cannot trust — a missing font face changes pagination — displays as `—`
with the reason, never as a guess.

---

## Cross-cutting rules

1. **Nothing is written until confirmed.** `DocxImportTab`'s contract, applied
   to every new flow.
2. **Every automatic decision shows its reasoning.** "Detected: …" under every
   inferred value.
3. **AI output arrives as a diff.** Never a silent write; `revisions.json`
   carries the pre-image and feature-plan-11's paint shows the change.
4. **AI never asserts a fact on the author's behalf.** Prose yes; affidavits
   no.
5. **Completeness checks name items, not counts.** "Reviewer 2, point 3 is
   unaddressed", not "3 problems".
6. **Refuse rather than guess.** An unmeasurable page count is `—` with a
   reason.
7. **The raw files stay visible and editable.** The UI is never the only door.

---

## What this adds to feature-plan-12

§11's table is replaced by this document. The plan's milestones gain UX
acceptance criteria and one new component; nothing in the data model changes.

| milestone | added |
|---|---|
| **12b** | The Documents header `+` menu; the New Letter sheet with live per-journal requirements; the three start-from modes; `~/SunaConfig/Letters/exemplars/` and **Add exemplar…**; the Assertions panel forked from `RequirementsPanel.tsx`; the `⟦ unanswered ⟧` marker and its export block |
| **12c** | The Rounds sidebar view; the Freeze dialog with its dirty-tree warning |
| **12d** | The triage queue; the `uninterpreted` bucket as a visible destination |
| **12e** | The import sheet with drop zone **and** paste box; deterministic pass-1 segmentation; the review screen with per-card reasoning and the coverage meter; the response workspace (three panes, point states, link-to-edit, assignee chips) |
| **12i** | The slot table with staleness markers and the `—` refusal state |

New acceptance criteria worth naming now:

- A letter is created from the Documents `+` in **four clicks or fewer** from a
  project with no letter, and the created file is schema-valid.
- Changing the journal in the New Letter sheet changes the requirements list
  **without writing anything**.
- An AI-drafted letter opens with its prose painted as additions and one
  `⌘Z`-equivalent reject restores the seeded text byte-identically.
- A letter with an unanswered required assertion **cannot be exported**, and
  the error names the assertion.
- Pasting the raw text of `reply-b` into the paste box yields
  **five reviewer blocks** with no AI call.
- The coverage meter's percentage plus the unassigned spans account for
  **100%** of the source, with no double-counting.
- A reviewer point has **no editable text control** anywhere in the app.
- Linking a reply to a manuscript span and then editing that span updates the
  quoted text in the exported response.

---

## Open UX decisions

1. **Does the letter get its own tab kind, or is it a mode of the manuscript
   tab?** This document assumes its own tab. The cost is a second large view to
   maintain; the benefit is that the title page's absence and the Assertions
   panel's presence are structural rather than conditional.
2. **Should the response workspace's third pane be the manuscript or the
   diff?** Showing the manuscript is simpler; showing what changed since the
   frozen submission is what a reviewer actually asks about. A toggle is the
   obvious answer and the obvious way to ship two half-features.
3. **Where does an exemplar come from for a user with no past letters?** The
   AI-draft mode with no exemplar produces competent, generic prose. Whether
   that is offered plainly or discouraged is a judgement about what a first
   letter should look like.
4. **Do points and comments share the rail?** A reviewer point and a co-author
   comment are different objects with different rules, but both want the right
   side of the screen. This document keeps them separate; the alternative is
   one rail with a filter.
