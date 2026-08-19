# Feature plan 11 — dual authorship: live co-editing + word-level AI diffs

**Goal (user direction, 2026-08-19):** the human and the AI agent both write
into the *same open document at the same time*, and the human can see exactly
what the AI changed — removals in red, additions in green, **at word
resolution, not line resolution**, in the style of a Cursor/VS Code inline
diff. The diff view is a setting resolvable at the **project** and **user**
level, **on by default**.

Two asks, and they are not equally hard:

| ask | verdict |
| --- | --- |
| **live co-editing** (MUST) | ~80% already built. Three concrete gaps, all in `state/docSessions.ts`. |
| **word-level inline diffs** | Doable. One genuinely new algorithm (`wordDiff`), the rest is decorations + a sidecar, both patterns this codebase already uses. |

The two share a primitive: a **multi-hunk word-level diff**. Live co-editing
needs it to merge; the review UI needs it to paint. Build it once.

---

## What already exists (do not rebuild)

The collaborative core is real, it is just not being used for collaboration.

- **`apps/desktop/src/renderer/src/state/docSessions.ts`** — `DocSessionCore`
  is a transport-free OT core: one authoritative `Text`, N attached views,
  `ChangeSet` forwarding with genuine rebasing (`applyLocal` maps a view's
  edit over the changes that view has not seen, `deliver`/`flushPending`
  queue and rebase through IME composition). This is the hard half of
  co-editing, already written and unit-tested.
- **External-change ingestion.** `projectTreeWatch` (150 ms coalesced,
  recursive, main) → `onProjectTreeChanged` → every open session's
  `checkDisk()` → re-read → `minimalDiff` → `applyExternal` → a *mapped*
  ChangeSet. So an agent's `edit_manuscript` **already appears live** in an
  open editor, preserving cursor, scroll anchor and comment marks — whenever
  the buffer is clean.
- **Anchor survival.** `comments/anchorExtension.ts` maps comment anchors
  through every change with `mapPos` in a `StateField`. The diff hunks need
  exactly this pattern; it is proven here.
- **Settings hierarchy.** `packages/core/src/settings-resolve.ts` resolves
  `project ?? global ?? default` and reports the winning level. A new key is
  three small edits, no new machinery.
- **Autosave.** 1 s idle (`AUTOSAVE_IDLE_MS`), serialized saves, refuses to
  run while diverged.
- **Sidecar precedent.** `manuscript/comments.json` — plain JSON, git-tracked,
  read by both the UI and agents, atomic writes (`services/atomic.ts`).
- **AI run lifecycle.** `services/ai-ask.ts` spawns the CLI child and resolves
  on `close`; `ai/directedActions.ts` wraps every directed action with a
  start/finish pair in `state/aiActions`. Both ends of a run are already
  observable — that is where a diff baseline gets captured and closed.

## The three gaps that block live co-editing

**Gap 1 — a dirty buffer is a hard stop, and the escape hatch destroys work.**
`checkDisk()` (docSessions.ts) does:

```
if (this.dirty) { this.divergedDiskText = normalized; setMeta(diverged: true); return }
```

The agent's write is then held behind `DivergenceBanner`'s all-or-nothing
choice. During an AI run the user is *likely* to be typing, so the common case
is the blocked one — and "Reload from disk" silently throws away everything
they typed while "Keep my version" throws away everything the agent wrote.
That is the opposite of co-editing.

We already hold all three texts needed to do better: `diskText` (the last
common ancestor), `core.text()` (ours), `normalized` (theirs). **A three-way
merge is available and cheap.** Non-overlapping hunks — the overwhelmingly
common case, because the agent edits the section it was pointed at while the
user types somewhere else — merge silently. Only genuinely overlapping hunks
need a human.

**Gap 2 — `minimalDiff` is single-span, so a two-place edit nukes everything
between.** `state/minimalDiff.ts` trims a common prefix and suffix and returns
*one* span. If the agent fixes a word in §2 and a word in §7, the returned
span covers §2 through §7: those five sections are deleted and reinserted.
Consequences are concrete — every comment anchor inside collapses
(`if (from < to)` drops it in `anchorsField`), the user's cursor jumps, and
undo bloats. This is not hypothetical; it is the current behaviour for any
multi-place agent edit.

**Gap 3 — the agent's read-modify-write is unsynchronized with the buffer.**
The CLI child reads `manuscript.md` from disk, thinks for tens of seconds,
then writes.
- `edit_manuscript` (exact `find`/`replace`, errors on zero or several
  matches) is **safe by construction**: if the user rewrote that sentence
  meanwhile, it fails loudly instead of corrupting. Good failure mode; keep it.
- `write_manuscript` / `Write` overwrite the whole file and **will** erase
  anything the user typed during the run. This needs a compare-and-swap.
- And an unsaved buffer means the agent reads a stale file to begin with.

---

## Layer 0 — `packages/core/src/word-diff.ts` (the one new algorithm)

Pure, dependency-free, exhaustively testable. This is the piece that does not
exist yet in any form.

```ts
export type DiffOp =
  | { kind: 'equal';  aFrom: number; aTo: number; bFrom: number; bTo: number }
  | { kind: 'delete'; aFrom: number; aTo: number; bAt: number }
  | { kind: 'insert'; aAt: number;   bFrom: number; bTo: number }

/** Offsets are into the ORIGINAL strings, so callers map straight to CM. */
export function wordDiff(a: string, b: string): DiffOp[]
```

Design points that matter:

- **Tokenization is word+whitespace runs**, not characters and not lines: a
  token is a run of `\w`, a run of whitespace, or a single other character.
  This is what makes `hashlib.md5()` → `hashlib.sha256()` highlight only
  `md5`/`sha256` (the screenshot's behaviour) rather than the whole call.
- **Two-stage for speed.** Line-level Myers first to isolate changed regions,
  then word-level Myers *inside* each changed region. A 10 000-word manuscript
  with a three-word edit then diffs in microseconds, and we never run an
  O(N·D) word diff over the whole document.
- **Anchor to paragraph boundaries.** In prose, a blank line is a hard sync
  point; refusing to match equal runs across one keeps hunks local and
  readable.
- **Deterministic.** Same inputs → same ops, always. Snapshot-testable.

`minimalDiff` stays as the fast path (`wordDiff` returning a single hunk is
the same answer); it is not deleted, it is *subsumed* — `applyExternal` starts
calling `wordDiff` and building a multi-span `ChangeSet.of([...])`. That one
change alone fixes Gap 2 for free.

## Layer 1 — three-way merge in `DocSession.checkDisk()` (fixes Gap 1)

New pure module `apps/desktop/src/renderer/src/state/merge3.ts`:

```ts
export interface Merge3Result {
  merged: string
  /** Hunks where both sides touched the same span — nothing applied for these. */
  conflicts: readonly { from: number; to: number; ours: string; theirs: string }[]
}
export function merge3(base: string, ours: string, theirs: string): Merge3Result
```

Implemented on top of `wordDiff(base, ours)` and `wordDiff(base, theirs)`:
walk both op lists against base offsets; disjoint hunks both apply; a span
both sides changed becomes a conflict and neither applies.

`checkDisk()` becomes:

```
if (this.dirty) {
  const { merged, conflicts } = merge3(this.diskText, core.text(), normalized)
  core.applyExternal(merged)          // multi-span, mapped — cursor/anchors survive
  this.diskText = normalized          // theirs is now the shared ancestor
  if (conflicts.length > 0) setMeta(diverged: true)   // banner, scoped to the conflict
  else { this.dirty = true; this.scheduleAutosave() } // our unsaved part is still ours
}
```

`DivergenceBanner` stops being an all-or-nothing document-level prompt and
becomes a *conflict count* with jump-to-conflict — and it now fires only in
the genuinely ambiguous case.

**This is the highest-value change in the plan.** It is what "live
co-editing" actually means, and it is maybe 120 lines on top of Layer 0.

## Layer 2 — `manuscript/revisions.json` (the diff baseline)

We cannot intercept the CLI child's writes — it edits files directly. So the
file on disk always holds the **new** text, and the review data is a sidecar
holding the **pre-image**. That is precisely git-diff semantics (baseline vs
working tree) and it keeps the ground rule intact: *the markdown never
contains diff markers*, so exports, compliance checks, word counts and git all
see clean prose at every instant.

```jsonc
{
  "version": 1,
  "revisions": [
    {
      "id": "rev_01J...",
      "path": "manuscript.md",
      "author": { "kind": "ai", "label": "Comment fix — reviewer 2, §Methods" },
      "at": "2026-08-19T10:29:14Z",
      "base": "…the full pre-image of the file…",
      "acceptedAt": null
    }
  ]
}
```

- **Captured** in `ai/directedActions.ts` `runDirected()`: on `start`, snapshot
  every manuscript file the action may touch; on `settle` with a non-null
  answer, close the revision (drop it if the text is byte-identical).
  `startAiAsk` from the palette gets the same wrapper.
- **`base` is the whole file, not hunks.** Storage is trivial for prose and it
  makes the hunks *derived at render time*, never stored — the same discipline
  the numbering rules follow. Recomputing from `base` also means the hunks
  stay correct after the user edits around them, with no hunk-migration logic
  at all.
- **Accept** = drop the revision (or fold its `base` forward). **Reject a
  hunk** = apply that hunk's inverse as an ordinary `ChangeSet` into the live
  buffer, which flows to disk through the existing save path. **Reject all** =
  restore `base`. Every operation is an ordinary document op through
  machinery that exists.
- Git-tracked and human-readable, like `comments.json`. A revision left open
  across a commit is a legitimate state: "the AI's draft is in, not yet
  reviewed."

## Layer 3 — `editor/revisionDiff.ts` (the paint)

A CodeMirror extension, composed alongside `livePreview` and
`commentHighlightExtension` in `editor/codemirror.ts`.

- A `StateField<DecorationSet>` recomputed when the revision set changes,
  **mapped** through every edit in between — the exact shape of
  `anchorsField`. Same proven pattern, same cost profile.
- **Insertions** — `Decoration.mark` over live text. Two intensities, as in
  the reference screenshot: a muted tint across the whole changed line, a
  saturated background on the changed *words*. Class names
  `cm-sunaDiff-ins` / `cm-sunaDiff-ins-word`.
- **Deletions** — the removed words are not in the document, so they are
  `Decoration.widget`s rendered inline: red, struck through,
  `contenteditable=false`, and **not selectable into a copy** (they must never
  end up in an export or a paste).
- **Colors come from theme tokens**, not literals — `editor/themes.ts` carries
  suna-dark and friends; a hardcoded `#4b1113` would break the light themes.
- **Per-hunk affordances**: a small accept/reject pair on hover, plus
  `Alt-]` / `Alt-[` to walk hunks and `Alt-y` / `Alt-n` to accept/reject the
  one at the cursor.
- **Reading mode** composes: the live-preview replacements and the diff
  decorations are both decoration sets, so precedence is the only real work.
  Deletion widgets inside a region live-preview *replaces* (a rendered figure
  block) are hidden — the hunk is still reachable from the hunk-walk keys.

## Layer 4 — the setting (project + user, on by default)

One new key through the existing `settings-resolve` hierarchy:

```ts
'review.aiDiffs': 'inline' | 'off'      // default: 'inline'
projectPath: ['review', 'aiDiffs']      // suna.json → settings.review.aiDiffs
globalKeys:  ['review.aiDiffs']         // userData/settings.json
```

Read in `EditorTab.tsx` with `useResolved('review.aiDiffs')`, exactly as
`editor.defaultMode` and `editor.vimMotions` already are, so a `suna.json`
override reaches the editor and the Settings pane gets its
"from project / from global / default" label and its Reset-to-global for free.

`'off'` hides the decorations; it does **not** stop revision capture — the
sidecar keeps recording, so turning the view back on shows the history that
accumulated meanwhile.

## Layer 5 — write safety (fixes Gap 3)

1. **Flush before spawn.** `runDirected()` and the palette's ask path call
   `flushAutosave()` on every dirty session under the project before starting
   the child, so the agent reads what the user can see. The seam already
   exists on `DocSession`.
2. **Compare-and-swap on whole-file writes.** `write_manuscript` /
   `write_section` (`packages/agent/src/mcp/`) take the hash the agent last
   read and refuse the write if the file changed underneath. The agent's
   correct response is to re-read and retry — the same contract
   `edit_manuscript` already enforces implicitly. Reword the tool description
   so the model knows this.
3. **Keep `edit_manuscript` as the documented default.** Its exact-match
   contract is what makes concurrent editing survivable; the verb list already
   says "prefer edit_manuscript for routine edits."

---

## Honest risks

- **`wordDiff` quality is the whole feature.** A diff that produces plausible
  but badly-anchored hunks makes the review UI *worse* than no UI. It needs
  fuzz tests (random edits, round-trip: `apply(diff(a,b), a) === b`) and
  snapshot tests on real manuscript edits before anything is wired to it.
- **Attribution when both sides touch the same words.** The honest rule:
  a hunk is recomputed from `base` on every render, so text the user typed
  inside an AI insertion simply stops matching the AI's text and stops being
  highlighted. No cleverness, no "who owns this word" bookkeeping. It will
  occasionally under-report; that is the right direction to fail.
- **Merge is not magic.** `merge3` on prose can produce a technically-clean
  merge that reads badly (two sentences interleaved). The conflict banner
  covers overlap, not incoherence. Mitigation: the diff view *is* the safety
  net — the user sees precisely what landed.
- **Deletion widgets and text extraction.** Any code that reads the document
  for export, word count, or compliance must read the buffer, never the DOM.
  Worth an explicit test, because a leaked deletion widget in an export is a
  correctness bug in a *submitted paper*.

## Milestones

| # | scope | gate |
| --- | --- | --- |
| **11a** ✅ | `@suna/core/word-diff.ts` + fuzz/snapshot tests | round-trip property holds on 10k random edit pairs |
| **11b** ✅ | `applyExternal` uses multi-span `wordDiff` | comment anchors survive a two-place agent edit (currently they do not) |
| **11c** ✅ | `merge3` + `checkDisk` three-way; banner shows conflict count | typing while an agent edits elsewhere loses nothing on either side |
| **11d** ✅ | Layer 5 write safety | a whole-file write during a dirty buffer is refused, not silently destructive |
| **11e** ✅ | `revisions.json` capture around AI runs | a directed action leaves a closed revision with a correct pre-image |
| **11f** ✅ | `revisionDiff.ts` decorations, both themes, both modes | word-level red/green matching the reference; nothing leaks into export |
| **11g** ✅ | `review.aiDiffs` setting + Settings pane row | project override beats global, both beat the `'inline'` default |

11a–11d are the MUST (live co-editing) and are independently valuable —
they fix real current data-loss and anchor-collapse behaviour whether or not
the diff UI is ever built. 11e–11g are the diff view.

## Landed so far

**11a — `packages/core/src/word-diff.ts`.** `wordDiff` (full alignment, for
the review UI) and `diffSpans` (changes only, CodeMirror's change shape).
Line-Myers to localize, word-Myers inside each changed region, then a
left-slide normalization that makes the result independent of Myers'
tie-breaking — which is what will let 11f recompute hunks from the baseline
on every render instead of migrating them. Bounded by MAX_EDIT_DISTANCE and
MAX_REGION_TOKENS; past either it degrades to "replace this region".
Measured: a one-word edit in a 1 MB document diffs in ~5 ms; two unrelated
3000-line documents in ~19 ms.

**11b — `state/docSessions.ts` `applyExternal` / `addView`.** Now multi-span.
`state/minimalDiff.ts` is deleted, its cases absorbed into word-diff's suite.

Gates met: 10 000 randomized round-trip pairs, the full op-tiling contract on
500 more, astral-safe boundaries, and `pnpm typecheck` + 3352 workspace tests
green.

`scripts/e2e/probes/live-coedit.mjs` proves the consequence in the running
app, and was itself verified adversarially: with `applyExternal` temporarily
reverted to the old single-span diff, the comment highlight on the untouched
middle paragraph **vanishes** (its anchor collapsed); with the multi-span
diff it survives intact. `probes/comment-reanchor.mjs` — the existing
agent-edit-into-open-buffer probe — stays green.

**11c — three-way merge.** `packages/core/src/merge3.ts` (not
`state/merge3.ts` as sketched above — it is pure, and it belongs beside
word-diff, which it is built on). `checkDisk` merges instead of blocking:
`diskText` is the ancestor, so an agent edit in a paragraph the human is not
in lands silently and the merged buffer is autosaved.

One design decision changed during the build, and it matters. The plan said
"clash" would be decided at word resolution. **It is decided per paragraph
instead**, while changes still APPLY at word resolution. Word-grain conflict
detection was caught inventing prose: a human rewriting `outside-in` to
`inside-out` and an agent rewriting it to `from the outside in` share no word
token — the human replaced two word tokens, the agent inserted three and
changed a hyphen — so a word-grain merge accepted both and produced
`from the inside out`. Text neither party wrote is worse than an extra prompt,
because nobody catches it by reviewing their own diff. Paragraphs are the
right unit: Markdown already defines them, they are unambiguous to compute
(sentences fracture on `6563.3`, `[@gunn1972]` and inline math), and they
match the case the feature is for. `merge3.test.ts` has a test named for that
case.

Ours always wins a conflict — the human's text is live and possibly
mid-thought. `takeTheirs` re-merges from the ancestor against the CURRENT
buffer, so anything typed since the banner appeared survives that too.

**11d — write safety.** `startAiAsk` flushes dirty buffers under the run's
directory before spawning (skipping conflicted sessions, whose banner is the
human's to answer). `write_manuscript` fingerprints what it reads and refuses
a write when the file moved underneath, naming `edit_manuscript` as the
recovery; its own writes and `edit_manuscript`'s do not count as someone
else's.

`probes/live-coedit.mjs` gained a second scenario — type without saving, then
change a different paragraph on disk — and was verified adversarially again:
with `checkDisk` reverted to the old blocking behaviour the agent's edit never
reaches the dirty buffer and the probe times out.

**11e — `manuscript/revisions.json`.** Schema in `@suna/core/revisions.ts`,
main-process service and `revisions:read`/`revisions:write` mirroring
comments.json exactly, store in `state/revisions.ts`. The baseline is captured
in `startAiAsk` — the single choke point every AI run passes through — right
after the §11d flush, so what the author reviews is a diff against what they
could actually see. A second run before the first is reviewed keeps the OLDER
base, because "everything the AI changed since I last looked" is the question
a reviewer is asking.

**11f — `editor/revisionDiff.ts` + `editor/revisionReview.ts`.** Additions are
mark decorations over live text; removals are inert widgets
(`contenteditable=false`, unselectable, not document text) so nothing they
show can reach an export, a word count or the clipboard. Wired into both prose
surfaces — the raw editor tab and the combined manuscript document.

Accept and reject came out asymmetric, and the asymmetry is the good part:
the document already holds the AI's text, so REJECT edits the prose back (an
ordinary undoable edit that saves normally) while ACCEPT only advances the
baseline and cannot alter the file at all. Either way the hunk stops existing
because base and document then agree there — no hunk bookkeeping anywhere.
`Alt-]`/`Alt-[` walk, `Alt-y`/`Alt-n` take or drop the one at the cursor, and
`ReviewBar` does all-or-nothing with a live count.

The plan sketched a muted whole-line tint under the saturated word. Dropped on
sight: with the line tint a one-word change reads as a whole-line rewrite. The
word alone carries it.

**11g — `review.aiDiffs`.** `'inline' | 'off'`, default `'inline'`, resolved
project ?? global ?? default, with rows on both settings surfaces. `'off'`
hides the paint AND the review bar (an Accept-all for invisible changes would
be a trap), but does not stop capture — turning it back on shows everything
that accumulated.

`probes/ai-diff-review.mjs` drives all of it against the real app: 17 checks
including "removed text is not in the document" and "the manuscript on disk
carries no diff markers".
