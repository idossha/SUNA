# Feature plan 14 — what changed since they read it

**Goal (user direction, 2026-08-21):** "When a user works on a peer-review
response they can look at a diff between the submitted version the reviewers
received and commented on against another version (the current version by
default). The user should be able to pull the diff in a full window or in a
split view against the peer-review round. This will be critically important
and useful for the responses to reviewers and for quoting manuscript text plus
showing the diffs."

The job a response letter actually does is quote the paper twice: once as the
reviewer read it, once as it stands, with the difference between them visible.
Until now SUNA held both texts — `manuscript/archive/vX.Y` is a read-only copy
of every logged state, `rounds/<id>/` is the ledger of who read what — and had
no way to put them side by side. This plan closes that, and makes the result a
SOURCE for the letter rather than only a picture of it.

Decided with the user before drafting:

| question | answer |
|---|---|
| how does SUNA know what the reviewers read? | **a round points at a logged version** (`baselineVersionId`), not a second copy of the bytes. The `freeze` field rounds.ts already declares stays unimplemented; a second archive beside the version archive would be two things to keep in step. |
| unified or side-by-side? | **both, toggled** — unified reads better for prose, side-by-side for a wholesale rewrite |
| what is compared? | **prose + title page/back matter + references** — abstract, availability statements and captions are reviewer-facing, and the bibliography is compared by cite key |

---

## The model

`Round.baselineVersionId: string | null` — a `vX.Y` in this project's archive.
Null is the normal state of every round already on disk, so
`baselineVersionFor(round, versions)` falls back to **the newest version
logged at or before the round was created**. The inference is never written
back: it is a reading of the dates, and an explicit pointer must win over it
the moment the author sets one (`round:set-baseline`).

A comparison side is a `CompareRef`, one of:

```
{ kind: 'working' }                    the file you are still typing into
{ kind: 'version', versionId: 'v1.1' } a read-only archive folder
{ kind: 'round',   roundId: 'r2' }     resolves to that round's baseline
```

The third is the one the workflow rests on: a response is written against a
round, so the comparison is addressed by round and keeps pointing at the right
text if the author later corrects which version went out.

## The diff

`@suna/core/doc-diff.ts`, pure and derived — nothing about a comparison is
stored, because one side is a folder that cannot change and the other is a
file that changes constantly.

1. **Split** both texts on their Markdown headings (`splitSections`), fenced
   code excluded. Text before the first heading is a level-0 section, not
   dropped.
2. **Align** the two heading lists by longest common subsequence on the
   heading PATH. An inserted "Limitations" is one addition, not a rewrite of
   every section after it; a section moved elsewhere is one removal and one
   addition, which is what a move is.
3. **Diff** each aligned pair with the existing `wordDiff` — the same
   primitive the AI-revision review bar runs on, so there is one algorithm in
   the app that decides what "changed" means.

A section's compared text is the prose UNDER its heading: the card already
names the section, and a heading repeated inside its own card reads as a
change nobody made. A reworded heading is not lost — it changes the section's
identity, so step 2 reports it as one section out and one in.

`diffHunks` folds ops into changes, where a removal and the addition replacing
it are ONE change. `revisionDiff.ts` in the editor now delegates its own
`hunksFor` to it.

## The view

`documents/CompareTab.tsx`, dock component `compare`, one panel per pair of
sides.

- **Header**: two pickers (defaulting to the round's baseline → working copy),
  a swap, the totals (`7 changes +54 −12 · 3 of 5 sections`), ‹ › change
  navigation, "Changes only", and Unified / Side by side.
- **Side by side stays level.** The columns are cut into grid rows at
  paragraph breaks that fall inside `equal` runs — text in an equal run is by
  definition in both versions, so it is a proven synchronisation point. No
  second alignment pass, and measured at 0.0 px drift across 12 rows in the
  running app.
- **References** are compared by cite key (added / removed / modified), not as
  .bib text, so re-running a formatter over the file reports nothing.

## Quoting

Every change carries a `❝` button, and every card a "Quote section". Both
build the reply markup `reply-markup.ts` already understands:

```
::quote
is removed on roughly a crossing time+++, though the timescale is
sensitive to the assumed ICM density profile+++. In this demo…
::
```

The CURRENT text, with the words this revision added marked — the reviewer
already has the old version. The paragraph, not the sentence, because a
sentence quoted alone loses its referent.

It lands in the reply of the point the round workspace has focused, through
`review:set-point` — the same IPC the workspace writes with, rather than a
handle into its state, because two surfaces owning one reply is how a reply
gets clobbered. `state/roundSync.ts` then tells the workspace to re-read.
With no point focused the block goes to the clipboard and the status bar says
so.

## Ways in

| route | opens |
|---|---|
| round header "Changes since v1.1" | the comparison **beside** the round (split) |
| its ▾ | which version these reviewers read |
| sidebar version row, ⇄ on hover | that version vs the working copy, full window |
| palette "Compare With What the Reviewers Read" | round baseline vs working |
| palette "Compare Versions" | newest logged version vs working |

## Build status — 2026-08-21

| milestone | state |
|---|---|
| **14a** core `doc-diff.ts` — sections, hunks, stats, field and bibliography diffs; `revisionDiff` delegates | **done**, 31 tests |
| **14b** `Round.baselineVersionId` + `baselineVersionFor` + `round:set-baseline` | **done**, 7 tests |
| **14c** `services/compare.ts` + `compare:sides` / `compare:read` | **done**, 12 tests |
| **14d** `CompareTab` + `compareSegments.ts` + `compare.css`, both layouts, nav, filters | **done**, 21 tests |
| **14e** quoting into the focused reply, and the ways in | **done**, verified in the running app |

Verified against a real project (a copy of `examples/demo-paper` with v1.1
logged, the round pointed at it, and the working copy edited): 7 changes
across 3 of 5 sections plus one added reference, deletions and additions in
both layouts, and a `❝` click that put a `+++`-marked quote into the focused
point's reply on disk.

## Not built

- **No MCP verb.** An agent drafting a reply still cannot see the diff. A
  `diff_versions {roundId?, base?, head?}` verb over the same core functions
  is the obvious next step, and would let `ReplyAssistant` say "the manuscript
  now says X" without the author pasting it.
- **Figures are not compared.** The version archive freezes `figures/`, so a
  before/after SVG render is available in principle; the user scoped this
  round to prose, metadata and references.
- **No per-hunk accept/reject.** A comparison is read-only in both
  directions — it never writes to either manuscript. The AI-revision review
  bar is where changes are accepted.
