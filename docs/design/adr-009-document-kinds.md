# ADR-009 — A project holds a set of typed documents, not one manuscript

**Status:** proposed · 2026-08-19 (user direction: "Academic writing is not just
about writing manuscripts. It is often about writing proposals like R01
NIH/NSF, writing internal documents, letters to editors, etc. I want to expand
SUNA's capability in that direction." Ground truth:
`document-kinds-findings.json`. Spec: `feature-plan-12.md`. The sponsor-package
half is separable and is ADR-010.)

## Decision

A SUNA project holds a **set of typed documents**. `manuscript` becomes the
first entry in a registry rather than a hardcoded singleton, and it becomes
that entry by *describing the layout that already exists on disk* — so the
change is additive and no existing project moves a byte.

Five decisions carry it:

1. **A document kind is a declaration, not an object.** `DOCUMENT_KIND_IDS` is
   a `const` tuple in `@suna/core`, and four exhaustive
   `Record<DocumentKindId, …>` tables — files, checker, export recipe, view —
   turn "add a kind" into "fill in four compiler errors". This is the same
   idiom `SIDEBAR_VIEWS` already drives four tables with
   (`apps/desktop/src/renderer/src/state/ui.ts:5`); a dynamic plugin registry
   would convert those compile errors into runtime `MissingPanel` fallbacks
   and would defeat the doc-drift gate in
   `packages/agent/src/context/context.test.ts`, which pins the shipped agent
   docs against a *static* `TOOLS` array.

2. **Every editable document lives under `manuscript/`, and the directory
   keeps its name.** A cover letter is `manuscript/letters/cover-science.md`,
   not `documents/…`. This is not aesthetics: `EditorTab.tsx:114-118` grants
   the comment gutter, ⌘⇧M and the AI-diff paint to any `.md` whose path
   starts with `${rootDir}/manuscript/`; `state/comments.ts` resolves anchors
   at that prefix in three places (`:112`, `:118`, `:462`);
   `SectionCommentTargetSchema.path` is documented manuscript-relative
   (`packages/core/src/comments.ts:27-33`) and `Revision.path` follows the same
   convention (`packages/core/src/revisions.ts:36`). Keeping the prefix means a
   cover letter inherits anchored comments, three-way merge, live co-editing
   and word-level AI review **on the day it is created**, with zero renderer
   surgery. Moving would cost a comments schema change, a migration of every
   `comments.json` on disk, and five renderer path rewrites, to buy a tidier
   tree.

3. **A round is a first-class noun.** `rounds/<round-id>/` holds a **freeze**
   (an annotated git tag *and* a text snapshot), the deliverables the venue
   requires, the verbatim reviewer reports, the returns that came back, and
   the decision. The user asked for "rounds of development … internally and
   externally"; a bare `versions.json` would answer half of that. `rounds/`
   holds records, snapshots and verbatim received text — none of which a human
   edits. That is the placement rule, stated once: **`manuscript/` is prose you
   edit; `rounds/` is the ledger.**

4. **Profiles grow optional blocks; `schemaVersion` stays 3.**
   `PublisherProfileSchema` (`packages/core/src/profile.ts:304-321`) gains
   `letters?` and `revision?`. All thirteen bundled profiles stay valid
   untouched — `stageSeverity` (`:208`) is the existing precedent for an
   additive optional. Sponsor packages get their **own** registry and their own
   schema; that is ADR-010's business, and the reason is stated there.

5. **A reviewer point is not a comment, and its verbatim text never lives in a
   file the author edits.** Reviewer text sits in `rounds/<id>/reviewers/*.json`;
   the authors' replies sit in `manuscript/reviews/<id>/response.md`.
   Immutability becomes structural rather than a rule someone has to obey —
   editing a reviewer's words is misconduct, and this makes it require
   deliberate JSON surgery.

## The model

Five nouns, and one of them already exists.

**Document.** A typed prose object: a Markdown file plus (usually) a JSON
sidecar, both under `manuscript/`, declared in an additive optional
`documents[]` on `suna.json`.

Filenames are **not** restated here. `DOCUMENT_KIND_FILES` in `feature-plan-12.md`
§1 is the single source of truth for which files each kind owns; this table
carries only the two columns that table does not (recipe, checker) and repeats
the paths for reading convenience. Where the two ever disagree, §1 wins and this
table is the bug.

| kind | prose | metadata | export recipe | checked against |
|---|---|---|---|---|
| `manuscript` | `manuscript.md` (name from `manuscriptFile`) | `manuscript.json` — **unchanged** | `buildExportContent` — unchanged | `profile.manuscript` — unchanged |
| `supplement` | `supplementary.md` | `supplementary.doc.json` | `buildSupplementContent` — unchanged | — |
| `cover-letter` | `letters/<id>.md` | `letters/<id>.json` | `buildProseDocumentContent` | `profile.letters` |
| `response` | `reviews/<round>/response.md` | `reviews/<round>/response.doc.json` | `buildProseDocumentContent` | `profile.revision` |
| `report` | `reports/<id>.md` — a managed derived region inside human prose | `reports/<id>.doc.json` | the `export-notes.ts` pattern | — |
| `package` | none | `packages/<id>/package.json` | ADR-010 | a package profile |
| `component` | `packages/<id>/<slot>.md` | `packages/<id>/<slot>.json` | ADR-010 | a package profile slot |

`ManuscriptSchema` is **not reused** for the new kinds and **not widened**. It
demands a non-empty `abstract.content`, a `.bib`-suffixed `bibliography`, and
required `availability`, `backMatter`, `history`, `doi` and `openAccess`
(`packages/core/src/manuscript.ts:121-147`). A cover letter has none of them.
Making those conditional on a `kind` discriminator turns every consumer's types
optional and forty call sites into `?.` chains; sibling schemas sharing pure
helpers is what `buildSupplementContent` already argues for over a mode flag,
in its own doc comment (`export-content.ts:788-812`).

**Round.** Two tracks (`internal`, `external`) and seven purposes
(`circulate`, `submission`, `review`, `revision`, `appeal`, `resubmission`,
`transfer`). Rounds form a linked list through `previousRoundId` — the
project's history at the granularity a human thinks in, which git's commit
graph is not.

**Freeze.** The immutable head of a round, stored twice on purpose:

- an **annotated git tag** `suna/round/<id>` plus the 40-char sha, so the tree
  is recoverable and `git diff` views work. `git-graph.ts:17` already types
  `GitRefKind` with `'tag'` and `:80-81` already parses `tag: ` out of the
  decoration, and `GitTimeline.tsx` already renders it — the display half
  exists. There is **no create path**: `packages/core/src/ipc.ts` declares 32
  `git:*` channels and none of them creates a tag.
- a **text snapshot** at `rounds/<id>/frozen/`, holding every in-scope prose
  file plus `manuscript.json`, `authors.json`, **`comments.json` and
  `revisions.json`** verbatim, and — for every prose file a deliverable was
  rendered from — the **rendered plain text plus its rendered→source offset
  map** under `frozen/rendered/`. (The round's reviewer records need no copy:
  they already live immutably at `rounds/<id>/reviewers/`.)

  The sidecars are in the snapshot on purpose, and it is a correction to an
  earlier draft of this ADR that left them out. The report's central section
  (*what happened to my comments from round N?*) is a diff of `comments.json`
  between two freezes; deriving it from git would make it computable only when
  a repository exists and only when the file was committed at both ends —
  contradicting both *A round with no git repository still works* and
  `Freeze.dirty`, which records an uncommitted tree as a supported outcome. The
  snapshot is the primary source for that diff and git is the fallback, never
  the reverse.

  The rendered text is in the snapshot for the reason set out in *Returns come
  back through four channels* below: what a co-author marks up is the rendered
  deliverable, not the Markdown.

Both, because each answers what the other cannot. The tag is a tree pointer
with nowhere to put the profile id or the `ExportOptions` a PDF was printed
with — and without the latter, a reviewer's "line 99" is unresolvable forever,
because `ExportOptions.lineNumbers` changes the layout (`export-pdf.ts:52-92`
shifts the whole body right when it injects them). The snapshot makes the round
self-contained: it works with no git, survives a shallow clone, and makes
"quote the text they actually read" a plain file read.
`revisions.json` already set this precedent, storing a whole prose file as a
pre-image and justifying the cost in its own doc comment
(`packages/core/src/revisions.ts:1-24`).

**Bundle.** What a round emits, into `output/rounds/<id>/`. Derived,
gitignored, regenerable, with a manifest carrying per-artifact **measurements**
stamped with a fingerprint of commit + options + figure hashes. This is the one
place the design stores a number that could in principle be re-derived, and it
is a recorded observation with provenance — the same epistemics as a profile's
`lastVerified` — never stored numbering. A measurement whose fingerprint no
longer matches is reported as **stale**, never as truth.

**Return.** Something coming back: a co-author's marked-up DOCX, a reviewer
report, or an editor's decision. Three shapes, one triage surface.

### Two baselines, two questions

`manuscript/revisions.json` stays exactly as it is: AI-scoped, at most one open
pre-image per path, answering *"what has the agent changed since I last
looked?"* The round freeze answers *"what has changed since we submitted?"* — a
months-long baseline spanning many edits and many people. They never compete:
the redline exporter reads the freeze, the review bar reads `revisions.json`.

### Two lifecycles, deliberately different

`Comment.resolved` is private, reversible, and disappears at export. A
`ReviewPoint.status` is a **public claim** inside a document a publisher will
read and — at PLOS, eLife and under Nature's transparent peer review — publish
(`rev.plos.response-published`, `rev.elife.response-published`,
`rev.nature.rebuttal-published`). So it carries the reply prose that justifies
it, and that prose exports. That is why a reviewer point is not a comment, and
the other four reasons hold too: different origin (external, no SUNA author,
opaque identity), different anchoring (zero-to-many anchors assigned after the
fact, versus exactly one fixed at creation by `makeAnchor` from a live
selection), different cardinality (`CommentsRail` lays out one card against one
span; one point produced a new Figure 4, an Extended Data figure, a renamed
section and three prose blocks, while another produced nothing —
`rev.example.cardinality`), and different detachment semantics (an anchorless
point is normal; an anchorless comment is an error state).

### What a round never does

A round never mutates prose. Freezing is a snapshot; closing is bookkeeping.
The working tree is the live truth at every instant, so exports, compliance
checks, word counts and git see clean Markdown mid-round exactly as they do
today — the same ground rule feature-plan-11 §Layer 2 established for
`revisions.json`.

## On disk

```
my-paper/
  suna.json                        # + optional documents[]. schemaVersion stays 1.
  identity.json                    # optional project override of ~/SunaConfig/identities/

  manuscript/                      # the project's PROSE folder. Name unchanged, on purpose.
    manuscript.md                  # kind 'manuscript'   — unchanged
    manuscript.json                #                     — unchanged (ManuscriptSchema untouched)
    authors.json                   # project-wide byline — unchanged, shared by every document
    references.bib                 # project-wide bib    — unchanged, per-document cited-key sets
    comments.json                  # UNCHANGED SCHEMA; target.path already accepts 'letters/x.md'
    revisions.json                 # UNCHANGED SCHEMA; already a per-path array

    supplementary.md               # kind 'supplement' — existed since feature-plan-6 with no
    supplementary.doc.json         #   schema entry at all; now declared

    letters/
      cover-science.md             # kind 'cover-letter'  — ask 1
      cover-science.json           #   assertions, signers, prior submissions
      cover-science.private.json   #   suggested/excluded reviewers — GITIGNORED by default
      appeal-nature.md
      appeal-nature.json

    reviews/
      r03/
        response.md                # kind 'response' — reply prose ONLY, in ::reply blocks
        response.doc.json
        cover-letter.md            #   Cell Press wants a NEW cover letter beside it
        cover-letter.json

    reports/
      r01-internal.md              # kind 'report' — a managed derived region + human prose
      r01-internal.doc.json

    packages/                      # ADR-010
      nih-r01/
        package.json
        specific-aims.md           # kind 'component', 1-page limit
        research-strategy.md       #                   12-page limit
        project-summary.md         #                   30-LINE limit
        project-narrative.md       #                   3-SENTENCE limit

  rounds/                          # THE LEDGER. Text only. Nothing here is hand-edited.
    rounds.json                    # index + activeRoundId
    r01-internal-2026-05-18/
      round.json
      frozen/                      #   the text snapshot at freeze
        manuscript.md
        manuscript.json
        authors.json
        comments.json              #   so the report's comment diff needs no git
        revisions.json
        rendered/
          manuscript.txt           #   the text the co-author actually read
          manuscript.map.json      #   rendered offset -> source offset, or null when derived
      returns/
        2026-05-21-settell.return.json
        _raw/2026-05-21-settell.docx      # GITIGNORED; sha256 recorded in the return
    r03-review-science-2026-08-01/
      round.json
      frozen/…
      decision.md                  #   the editor's letter, verbatim, never edited
      reviewers/
        reviewer-1.json            #   verbatim points, immutable
        reviewer-2.json
        editor.json
                                   #   response-only DISPLAY ITEMS are NOT here — see below

  figures/                         # unchanged layout; response items join it (see below)
    r-osa-timeline/
      figure.json                  #   namespace: 'response' — an ADDITIVE enum member
      figure.svg
      source/
  code/  data/  analysis/  results/               # unchanged

  output/                          # derived, gitignored
    rounds/
      r03-review-science-2026-08-01/
        bundle.json                #   artifacts + MEASURED page counts + fingerprint
        manuscript-clean.pdf
        manuscript-marked.docx
        response.pdf
```

### Response display items live in `figures/`, not in `rounds/`

An earlier draft put hand-drawn response figures at
`rounds/<id>/response-items/R1/item.svg`. That contradicted the placement rule
one page above it — `rounds/` is the ledger, text only, nothing hand-edited —
and it put an authored SVG outside the one pipeline that knows what to do with
one: no canvas tab, no `figure.json` caption schema, no provenance overlay, no
profile-driven figure compliance check (`check/figure.ts`).

So a response-only display item is an **ordinary managed figure** at
`figures/<id>/{figure.json, figure.svg, source/}` with
`namespace: 'response'`. `FigureNamespaceSchema` is
`z.enum(['main','extended-data','box'])` (`packages/core/src/figure.ts:3`);
adding a fourth member is a union **addition**, so every `figure.json` on disk
still parses. Numbering stays derived per namespace at format time, so the
`R1`/`R2` labels come out of the response's own ordered list and never enter
manuscript numbering. Which round an item belongs to is recorded where round
membership belongs — the response document's sidecar
(`reviews/<round>/response.doc.json` → `displayItems: [{ figureId, label }]`) —
so `rounds/` still holds only records, snapshots and received text.

### `rounds/` and `identity.json` are fixed at the project root, deliberately

`projectSubdir(dir, key)` (`apps/desktop/src/main/services/paths.ts:10-19`) is
the invariant that a renamed `manuscript/` or `figures/` keeps working, and
`rounds/` bypasses it. That is a decision, not an oversight:
`SunaProjectManifestSchema.directories` is
`z.record(ProjectDirKeySchema, z.string().min(1))`
(`packages/core/src/project.ts:144`) — an **exhaustive** record over
`PROJECT_DIR_KEYS`, and every shipped manifest lists all seven keys
(`examples/demo-paper/suna.json`). Adding a `rounds` key would invalidate every
`suna.json` on disk. The codebase reaches for `z.partialRecord` when it wants a
partial record (`profile.ts:66`), so making `directories` partial is possible
but is a manifest-schema change this ADR refuses to pay for a directory nobody
has asked to rename.

The invariant that *matters* is preserved anyway: `paths.ts` gains
`roundsDir(dir)` and `roundDir(dir, roundId)` (returning `<dir>/rounds` and
`<dir>/rounds/<id>` unconditionally), so services still resolve through one
file even though that file has nothing to look up.

Institutional identity is **per-user, not per-project** — a lab crest and a
PI's signature are reused across every project, and are neither manuscript data
nor journal data:

```
~/SunaConfig/
  identities/uw-madison-psychiatry.json
  identities/assets/uw-crest.png
  identities/assets/signature-hai.png
```

Referenced by path, embedded only at export — the same boundary a rasterized
`figure.svg` already crosses, so no binary becomes a source of truth.

## Schemas

Full zod sketches are in `feature-plan-12.md` §§1–5. The shape that decides
everything else is the registry entry and its fallback:

```ts
export const DocumentEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: DocumentKindIdSchema,
  /** MANUSCRIPT-DIR-RELATIVE, may nest. The comments.json / revisions.json
   *  namespace, deliberately — that alignment is what makes this cheap. */
  file: z.string().min(1).nullable(),
  meta: z.string().min(1).nullable(),
  title: z.string().min(1),
  /** Per-document profile override, TAGGED with which registry to resolve it
   *  in. ADR-010 puts sponsor profiles in a second registry with a second
   *  schema, and 'nih-r01' and 'science' are indistinguishable by shape
   *  (ProfileIdSchema is a bare regex, packages/core/src/profile.ts:27), so an
   *  untagged string would leave no consumer able to pick a loader.
   *  null inherits suna.json's activeProfileId — which is a JOURNAL id, so
   *  inheritance is defined ONLY for journal-registry kinds. */
  profile: z.object({
    registry: z.enum(['journal', 'sponsor']),
    id: z.string().min(1),
  }).nullable().default(null),
  roundId: z.string().min(1).nullable().default(null),
  archived: z.boolean().default(false),
})

// suna.json gains ONE optional field. schemaVersion stays z.literal(1).
//   documents: z.array(DocumentEntrySchema).optional()

export function resolveDocuments(m: SunaProjectManifest): DocumentEntry[] {
  if (m.documents && m.documents.length > 0) return m.documents
  // Absent = a one-manuscript project, DESCRIBED rather than migrated.
  return [{ id: 'manuscript', kind: 'manuscript', file: null,
            meta: 'manuscript.json', title: m.name,
            profile: null, roundId: null, archived: false }]
}
```

Kinds `package` and `component` set `profile: null` and take their sponsor
profile from `PackageDocumentSchema.packageProfileId` instead, which already
exists and is already unambiguous. `profile: { registry: 'sponsor', … }` is
accepted on those two kinds only, as a same-value mirror; on any other kind it
is a validation error. Inheriting `activeProfileId` into a package document
would be a category error and is refused rather than silently resolved.

`file: null` on the manuscript entry is deliberate: the manuscript is the one
kind whose prose filename is already data, in `manuscript.json`'s
`manuscriptFile` (`packages/core/src/manuscript.ts:141`). The registry does not
duplicate it and cannot drift from it.

## Mechanism

### The manuscript becomes an entry without moving

`projectSubdir(dir, key)` (`apps/desktop/src/main/services/paths.ts:10-19`) is
the one honest resolver in main, and it is immediately narrowed by three
hard-coded filenames at `:21`, `:25` and `:29`. Those three become one-line
wrappers over new `documentDir(dir, docId)` / `documentFile(dir, docId, role)`
helpers that **return byte-identical strings** for the primary document. Every
main service inherits document awareness from that one file.

`CHECKERS.manuscript = checkManuscript` (unchanged),
`RECIPES.manuscript = buildExportContent` (unchanged),
`VIEWS.manuscript = ManuscriptTab` (unchanged). The registry describes what is
already there.

### Numbering stays derived, per document

Each document is its own `buildProseDocumentContent` call, so citation
numbering restarts per document exactly the way the supplement already restarts
at `[1]` (`export-content.ts:813`). That is a direct, unmodified reuse — and it
is also what the sponsor package needs, where the Bibliography attachment runs
past 60 entries while the Vertebrate Animals attachment restarts at 1
(`nih.example.numbering-scope`).

Reply labels are derived too. The response prose carries `::reply{point=r1-2}`,
never `RE12:`. The label — `RE:`, `RE12:`, `Reviewer 1, point 2` — is rendered
at format time from the ordered point list under the round's `labelScheme`.
That is the direct fix for a defect measured in a real submitted document: a
hand-maintained global counter that reached RE83 with **RE58 simply missing**
(`rev.example.numbering-drift`).

### Quotes are transclusions, not pastes

A reply block `::quote{id=q7}` resolves through `anchor.ts` `locate()` at
format time against the *current* manuscript, and renders with citation numbers
renumbered into the response's own scheme. A quote whose anchor no longer
locates is **flagged and blocks the round from closing**; it is never rendered
stale. This kills two measured defect classes at once: the same manuscript
sentence pasted twice into one response with two different citation number sets
(`(54--56)` vs `[8], [9], [10]`), and the same Results sentence quoted twice
with contradictory wording, one version matching nothing in the revision
(`rev.example.stale-quotes`).

`::quote-frozen{round=r02}` resolves against `rounds/r02/frozen/` instead —
which is what makes "see previous Results, lines 315-339" honest.

### The letter checker flags, and never writes

`profile.letters` carries per-assertion `stance` with the venue's own words and
its URL. **Not every one of those words has been read from the page it cites**,
and that is a shipping gate, not a footnote — see *A provenance state for a
quote whose page was never fetched* below. The checks are structural, never
prose heuristics:

- `letter.assertion-missing` — the profile requires it, the sidecar has no
  entry. Severity from stance.
- `letter.assertion-misplaced` — declared in the letter but the profile says
  the vehicle is the submission form (Science, PNAS), or the reverse
  (`cl.conflict.reviewer-vehicle`).
- `letter.journal-name-mismatch` — every bundled profile's `journalName`
  matched against the rendered letter; a hit that is neither the target nor a
  journal declared in `priorSubmissions[]` is an **error**. This catches
  mechanically the defect in the user's own submitted letter, which offers the
  paper "as an article in Science" and then pitches "the broad readership of
  Science Advances" (`cl.defect.stale-journal-name`).
- `letter.summary-over-limit` — Brain's 323 characters *including spaces*,
  counted on the FINAL rendered string, which is why `abbreviatedSummary` is a
  sidecar field rendered into a managed region rather than hand-typed prose.
- `letter.data-location-unspecified` — the sidecar's `dataLocations` array is
  empty or names no repository. **Structural**: SUNA does not judge whether
  free prose "names a repository", because "names a repository" has no stated
  definition and inventing one is exactly the guess ADR-002 forbids. The
  observed defect — "Data and analysis code will be made available upon
  publication" against Science's demand for a named deposit location
  (`cl.defect.availability-vague`) — is caught as an empty array, not as a
  regex.

Nature's "avoid repeating information that is already present in the abstract
and introduction" is a real stated rule with **no stated threshold**. It is
recorded as `stance: 'discouraged'` with a note, surfaced in the Requirements
panel as the measured longest shared run beside Nature's own sentence and URL,
and produces **no Diagnostic**. A similarity cutoff would be SUNA's invented
number, and `DiagnosticSeverity` is `'error' | 'warning'` — there is no
severity that means "here is a measurement, you decide", so it does not go
through the diagnostic channel at all.

### A provenance state for a quote whose page was never fetched

The ground truth records a caveat this ADR previously dropped, and dropping it
was the more serious error because two of the checks above are **errors** driven
by Science's rules (`letter.data-location-unspecified`,
`letter.journal-name-mismatch`):

> PROVENANCE CAVEAT: www.science.org and www.cell.com both return HTTP 403 to
> direct fetch (Cloudflare), so the Science and Cell Press quotes were captured
> from indexed search results rather than a fetched page; the URLs are correct
> and the wording is consistent across sibling journals, but they should be
> re-read from the live pages in a browser session before shipping as profile
> data.
> — `document-kinds-findings.json`, areas `cover-letter` and
> `revision-response`

Both 403s reproduce today (2026-08-19), and the research session's own cached
copy of the Science page is a Cloudflare challenge, not the
Information-for-Authors text. A second caveat is dropped the same way: the
Nature Portfolio cover-letter language was captured from *Communications
Physics* because nature.com sits behind an intermittent IdP redirect, so
**whether the flagship Nature page carries the referee-suggestion sentence
verbatim is unverified.**

The doctrine that made `stance: 'not-requested'` a distinct state from silence
demands a third distinction here, so `ProvenanceBasisSchema`
(`packages/core/src/profile.ts:35-39`, today
`'documented' | 'counted-empirically' | 'inferred'`) gains a fourth member:

- **`documented-indexed`** — the venue states this, but the sentence was
  captured from a search index rather than read from the cited page. The URL is
  correct; the wording is not confirmed against it.

It is a union **addition**, so all thirteen shipped profiles still parse and
`schemaVersion` stays `3`. Every Science, Cell Press and *Neuron* rule carries
it until someone re-reads the live page in a browser session and downgrades it
to `documented` with the date. **No profile ships an assertion whose `quote`
is still `documented-indexed`** — that is the gate on milestone 12b in
`feature-plan-12.md`, and the Requirements panel shows the state for anything
that slips past it.

### Returns come back through four channels, and none is dropped

`returns:import` unzips a marked-up DOCX (`jszip` is already a dependency,
`apps/desktop/package.json:38`) and reads all four channels real files use,
each evidenced by its own rule: `w:comment` + `commentsExtended` for `w15:done`
(the comment markup lives in five sidecar parts, never inline —
`rnd.example.comment-parts`, which is what tells the parser where to look);
`w:ins`/`w:del` with `w:delText` (`rnd.example.deltext`,
`rnd.example.tracked-attrs`); highlight runs (`rev.example.assignment-highlight`);
and instructions written in prose into the body
(`rnd.example.assignment-in-prose`). The last two carry an assignee and an open
state with no schema anywhere, so they are preserved verbatim as
`uninterpreted[]` marks and surfaced — interpreting a colour as a person would
be inventing meaning.

Three guards the evidence demands:

- **Anchor against the RENDERED freeze, not the Markdown.** What the co-author
  marked up is `output/rounds/<id>/manuscript-marked.docx` — a rendered
  artifact in which `[@key]` has become a superscript number
  (`export-docx.ts:246` sets `superScript` from `renderCluster`'s form) and
  `![[fig:x]]` has become "Figure 2". That string is **not** the Markdown, so
  anchoring a return against `frozen/<file>.md` and calling it "guaranteed to
  resolve — it is the text they read" was simply false for every comment
  touching a citation, a cross-reference or a figure label.

  So the freeze stores both sides: `frozen/rendered/<file>.txt` (the plain text
  of the rendered deliverable) and `frozen/rendered/<file>.map.json` (rendered
  offset → source offset, or **null** for a span with no source — a derived
  citation number, a derived figure label, a generated reference list). The
  exporter knows both sides at emit time: `ExportSection` already carries the
  `source` string and the parsed SciMark AST whose nodes carry positions
  (`export-content.ts:530-536`), so the map is produced by the same walk that
  emits the runs. Anchoring is then a three-step compose: locate in the
  rendered text, map rendered → source through the map, map source → HEAD
  through `wordDiff(frozen, current)` (`packages/core/src/word-diff.ts`).
  Nothing in the current model composes anchors across representations *or*
  across a range of commits; this is the piece that does both.
- **A source-less span never becomes a prose anchor.** Comment id 1's entire
  anchor is the single character `3` inside `(See Figure 3)` — a **derived**
  number that does not exist in the Markdown at all
  (`rnd.example.derived-number-anchor`). It maps to a null source offset, which
  is a precise, structural answer rather than a heuristic one: the comment is
  offered a retarget to `kind: 'figure'` on the figure that number resolved to,
  and never a prose anchor. This is the general case for citation and
  cross-reference anchors, not an outlier.
- **A minimum-information floor.** Anchored ranges in the real file run from 1
  to 504 characters. Even inside mapped prose, `locate()`'s tier-1 uniqueness
  check would sail past a one-character quote, score on 32 characters of
  drifted context and return a confident wrong answer. Below the floor the
  return lands `detached` with its frozen quote intact and goes to a human.
  Detaching honestly beats guessing.

Author identity is never trusted: all twelve comments in the real file carry
one `w:author` while five bodies begin "Evan Comment"
(`rnd.example.author-unreliable`). A `claimedAuthor` prefix produces a
**suggested** attribution shown with its reason, in the style
`docx-import.ts` already uses for front-matter fields — never applied silently.

### The internal report is derived, and it is an invention

`reports/<id>.doc.json` declares only `{ from, to, include }`. Every word is
computed at build time: prose changes from `wordDiff` grouped by heading path;
comments closed, still open, and newly `detached`, diffed between the two
freezes (both sides read from `rounds/<id>/frozen/comments.json`, **not** from
git — see *Freeze*, and `feature-plan-12.md` §5); reviewer points
answered versus outstanding; figures whose `figure.svg` hash changed; word- and
page-count deltas.

Be honest about what this is. **No artifact in any of the user's examples is an
internal round report** (`rnd.internal-report`). Nobody produces one by hand,
so there is no shape to imitate. Its justification is that every input already
exists on disk and the whole thing is derived — so, unlike every hand-written
status email, it cannot go stale. The one thing it must answer is the question
a co-author receiving round N+1 actually has: *what happened to my comments
from round N?*

It renders through the `export-notes.ts` pattern (`:18-35`) — its own small
model, three formats, its own `output/` subdir — because a round report is not
a submission and every knob the manuscript pipeline carries (profile,
rasterization, submission options) would be a knob with no meaning.

### Closing a round

Advisory checks in the house posture — they list, they never block
(ADR-002 §Decision 4; `ExportDialog.tsx:470-471` already says so in the UI):

- **internal** — every return triaged or explicitly deferred; report
  regenerated against the current freeze.
- **submission** — every `required` deliverable satisfied by an artifact
  produced from *this* freeze (fingerprint match), not an older one.
- **review** — every point has a non-empty reply or an explicit `declined` with
  a note; no `::quote` whose anchor fails to locate; the marked-up manuscript
  exists in the dialect the profile states; the response exports with no error
  diagnostic. These reproduce exactly the holes visible in the user's
  in-progress draft: four empty reply markers, an `XXXXXXX` quote slot, a
  `$$$` sentinel and an unfinished "Thank for....."
  (`rev.example.in-progress-holes`).
- **`doc.ready-to-send`** — no unresolved comments, no open AI revision
  baseline, no draft markings, clean tree. This turns the observed `-final`
  filename convention into an assertion: the real
  `Findlay-NN-Revision-final.docx` has zero `w:ins`, zero `w:del`, zero
  comments and zero highlights (`rnd.example.final-means-clean`).

Closing stamps the final measurements into the freeze, writes `closedAt`, and
opens the successor with `previousRoundId` set. That successor's freeze diffed
against this one *is* the next round's report — the loop closes on itself.

## What this costs

**Two renderer singletons must be keyed before a second document tab can open
at all**, and both are hard blockers rather than cleanups:

- `state/manuscriptDoc.ts:49-110` holds one `outline`, one
  `activeSectionIndex`, one `tabMounted`/`tabActive` pair, one `scrollRequest`
  and one `citationRender` with no document key. Two structured-document tabs
  would overwrite each other's outline, fight over scroll-spy, and mis-route
  `requestScroll`. It becomes a `Map<documentId, DocState>`.
- `state/comments.ts`'s `draft` / `activeId` / `revealRequest` are single
  global slots, and every mounted `CommentsRail` renders `DraftComposer`
  whenever `draft !== null` — so starting a comment in the manuscript would
  open a composer in the cover letter's rail as well.

**The comment badge counts project-wide, and it must be keyed before a second
kind ships.** `RailToggleButton.tsx:13-15` is
`(s) => s.comments.filter((c) => !c.resolved).length` — no path filter — and it
is rendered by both `ManuscriptTab` and `EditorTab`. Under decision 2 a cover
letter, a response, a report and every grant component write into the one
project-wide `comments.json`, so the manuscript tab's badge would count the
cover letter's open comments. That is precisely the failure this ADR cites when
it rejects modelling reviewer points as comments ("an 83-point round would make
the manuscript badge read 83"), reproduced by its own decision 2 through a
different door. The fix is small — key the count by the active document's path
using the `commentsByPath` map `EditorTab.tsx:11,124` already builds — and it
is a **prerequisite**, listed in `feature-plan-12.md`'s 12-pre beside the two
singleton fixes.

**One suspected landmine is already gated, and the scoping change is cheap
insurance rather than a blocker.** An earlier draft of this ADR said
`migrate-manuscript.ts:202-243` "runs on every project open" and would collapse
every document's comments onto `manuscript.md`. That is wrong about the code.
`migrateOnOpen` (`apps/desktop/src/main/ipc.ts:271`, called at `:303` and
`:315`) does run on every open, but `migrateProject` returns at `:285` —
`if (!hasBody && !hasAuthors && !hasAffiliations) return { migrated: false,
notes: ['project is already flat'] }` — reading those three flags off
`manuscript.json`. `migrateComments`, the only caller of
`migrateCommentTargets`, runs at `:394`, i.e. step 5, after that early return
and after a full successful prose migration. A project holding
`manuscript/letters/*.md` postdates the flat layout by definition and carries
no `body`/`authors`/`affiliations` key, so it hits the early return and no
comment is ever touched.

The collision therefore requires a project that is simultaneously
pre-feature-plan-7 and post-registry, which nothing can produce today. The
retargeting is still scoped to the primary document and gated on the old
`sections/` tree actually existing, because it costs one condition and one
fixture — but it is insurance against a future ordering, not a live
data-destroying path.

**One test is already broken on `main`; one is protected by ADR-010's separate
registry.** `packages/formatter/src/profiles.test.ts:62` asserts "lists exactly
the twelve journal ids, plus the house style". It does not break for letters
(they are optional blocks on existing profiles, and the test asserts the id
list, not the key shape), and it does not break for sponsor profiles either,
because ADR-010 decision 2 puts those in a separate registry precisely so it
stays honest. Nothing in this ADR breaks it. Separately,
`scripts/e2e/smoke.mjs:4786` asserts `probe.tools.length === 19` against a
`TOOLS` array that already has **24** entries
(`packages/agent/src/mcp/verbs.ts:473-550`) — that is a **pre-existing failure
on `main`**, not a cost of this change, and it is listed as a baseline item in
`feature-plan-12.md`'s 12-pre so no new verb is blamed for it. Two shipped docs
are stale the same way and are **not** gated:
`resources/suna-context/README.md:73` and `website/ai/mcp.md:60` both say 23.

**Every new verb is a five-file change.**
`packages/agent/src/context/context.test.ts` pins `MCP.md`'s table equal to
`TOOLS` by sorted names, by the advertised count, and per row by the input
names and their `?` markers read off the zod schema. Adding a verb without
teaching it in the shipped docs fails `pnpm test`; so does editing the source
docs without re-running `node scripts/gen-suna-context.mjs`. That is a feature,
and it is a cost.

**New confidential data lands in a git-tracked project for the first time.**
Excluded reviewers with exclusion reasons, an editor's decision letter, and a
co-author's returned markup are career-sensitive. SUNA writes a `.gitignore`
stanza covering `rounds/**/returns/_raw/` and `manuscript/**/*.private.json`.

**When it writes it is load-bearing and was previously unstated.**
`PROJECT_GITIGNORE` is written only at scaffold
(`apps/desktop/src/main/services/project.ts:143,429`) and at docx-import
(`docx-import.ts:602`), so a project created before this feature would never
gain the stanza. The only additive path is `ensureGitignoreLine`
(`packages/agent/src/context/ensure.ts:349-369`), which is private to that
module and called from exactly one place, for the `.mcp.json` line (`:343`).

So: `ensureGitignoreLine` is **exported**, and `letter:new` and `returns:import`
call it for their own patterns **in the same transaction that first creates the
file, before the write** — the ignore line lands first or the file is not
written. The `.private.json` and `_raw/` writers are the only two paths that
create career-sensitive files, and neither has any other entry point. A project
whose `.gitignore` predates the feature is covered on the first such write, and
that is an acceptance criterion in `feature-plan-12.md` §2 and §4, not an
assumption.

The remaining tradeoff is stated plainly rather than solved: gitignoring makes a
round non-reproducible from the repository alone, and the doctrine has nothing
to say about confidential data in a tracked project.

## Explicitly out of scope

- **The sponsor package.** ADR-010, because it is separable: it needs a
  different profile schema, a different registry, and a rendered-page
  measurement loop that nothing else in this ADR requires.
- **Widening `ManuscriptSchema`.** No `kind`, no `id`, no field made optional.
- **Editing a returned DOCX and sending it back.** DOCX and PDF are
  export-only (CLAUDE.md, architecture.md §Format doctrine). Returns are
  ingested into sidecars and triaged per item; SUNA never writes a co-author's
  file back.
- **Auto-applying returned tracked changes.** They land as reviewable hunks in
  the accept/reject UI feature-plan-11 §11f shipped.
- **An N-way annotation merge.** Three returned files against one freeze
  produce three independent records; a sentence with three comments keeps three
  threads. Per-item triage is honest about the ambiguity instead of silently
  picking a winner. `merge3.ts` handles the prose half with the right policy
  already ("ours never loses", word-grain application, paragraph-grain
  conflicts).
- **A tool-calling loop for API-key users.** "UI and agent are equal clients"
  holds today only for the CLI path — `Provider.chat` has no `tools` parameter
  (`packages/agent/src/types.ts:29-32`), and `architecture.md` §8's streaming
  tool registry was never implemented. New capability reaches agents through
  MCP verbs, as everything else does.
- **Ingesting a reviewer report from PDF layout.** Text paste and `.docx` are
  the ingest paths; a PDF is pasted as text.

## Open decisions

These need the user, not the architect.

1. **Do returned `.docx` binaries belong in git?** Committing makes a round
   auditable and reproducible; gitignoring makes ingestion unreproducible. The
   proposal gitignores the binary and commits its sha256 plus the derived
   comments — conclusions in git, evidence on disk. A user who wants full
   auditability must opt in and accept 7 MB per return per round.
2. **Which identifier is canonical for a co-author?** Word gives a display name
   plus an Active Directory SID; git gives name + email; `authors.json` gives
   given/family/orcid/email. Reconciling them needs a mapping table that does
   not exist, and getting it wrong misattributes review comments in a submitted
   paper.
3. **Should the appeal letter be a supported kind in v1?** It has hard
   eligibility rules SUNA cannot verify without a complete submission history
   (eLife: one appeal per version, ideally within one month) and getting it
   wrong has real cost for the author.
4. **Does the version-label format follow the user's own convention or SUNA's?**
   Three incompatible date formats appear across three of their real filenames
   (`rnd.example.date-formats`). The proposal derives a label and offers a
   format; which default is right is a preference.
5. **Retention for `output/rounds/`.** Every freeze renders artifacts; nothing
   currently deletes them.
6. **Who re-reads the Science and Cell Press pages, and when?** Both 403 to
   direct fetch and their quotes are `documented-indexed` until somebody opens
   them in a browser session and confirms the wording. Milestone 12b is gated on
   it, so this is a scheduling question with a hard dependency on a human with a
   browser — not something the architect can close. The same applies to the
   flagship Nature page's referee-suggestion sentence, captured from
   *Communications Physics*.

## Accepted simplifications

- **A companion-paper reference in a cover letter is hand-entered.** The Nature
  example covers two manuscripts in one letter
  (`cl.example.nature-length`); SUNA has no cross-project reference mechanism
  and inventing one for this is not worth a new mechanism. A `siblingProjectPath`
  is read-only where it is given, and flagged when the path has gone.
- **`references.bib` stays project-wide, with per-document cited-key sets.** A
  per-document bibliography would make it impossible to renumber a transcluded
  manuscript quote into the host document's scheme — which is exactly the
  measured defect.
- **`authors.json` stays the journal-facing byline.** Degrees, chair titles and
  signature images go on the per-user identity record instead; none of them is
  manuscript data.
- **Letter typography is SUNA's own opinion, labelled as such.** No journal
  states cover-letter layout, and the two real letters disagree on font, margin
  and justification (`cl.example.typography-conflict`). The Requirements panel
  says so in those words.
- **A round with no git repository still works**, on the text snapshot alone;
  the tag half is skipped and the skip is reported. This is what forces
  `comments.json` and `revisions.json` into the snapshot: the report's comment
  section must be computable from the two snapshots alone.
- **The freeze stores the rendered text as well as the source, and pays for it
  in disk.** A rendered `.txt` plus its offset map is on the order of the prose
  it came from — a few hundred kilobytes per round for a full manuscript. That
  is the price of anchoring a return against the string the co-author actually
  read; the alternative is a class of silently wrong anchors that the evidence
  says is the common case, not the edge case.

## Rejected

- **A `kind` discriminator on `ManuscriptSchema`.** See *The model*: the
  required fields make it unparseable for a letter, and conditioning them turns
  forty call sites into optional chains.
- **A new top-level `documents/` directory.** Costs a comments-schema change, a
  migration of every `comments.json`, and five renderer path rewrites, to buy a
  tidier tree. `file` already accepts a nested relative path, which recovers
  the grouping at zero cost.
- **One project-wide comments file with a `documentId` field.** Redundant: the
  path already carries the document identity, and adding a field to say it
  again is a migration that buys nothing.
- **Modelling reviewer points as comments.** Five independent reasons, in *Two
  lifecycles*. The badge argument that used to sit here — `RailToggleButton`
  counts unresolved comments project-wide, so an 83-point round would make the
  manuscript badge read 83 — is now handled as a **prerequisite** instead (see
  *What this costs*), because decision 2 reproduces it with letters and package
  components anyway. It is no longer load-bearing for this rejection; the five
  lifecycle reasons are.
- **Putting reviewer verbatim text in `response.md`.** Prose files are
  author-editable; editing a reviewer's words is misconduct. Keeping it in
  `round.json` makes immutability structural instead of aspirational.
- **Storing derived reply labels.** The evidence is decisive: a real
  hand-maintained counter skipped RE58.
- **A fuzzy-similarity check for Nature's "avoid repeating the abstract".** A
  genuinely stated rule with no stated threshold. Any number SUNA picks is the
  guess the profile doctrine exists to prevent, so it is a Requirements-panel
  measurement, not a diagnostic. The refusal is recorded rather than quietly
  omitted.
- **A prose heuristic for "does this sentence name a repository".** Same
  reason; the sidecar makes it a structural fact instead.
- **Git branches as the sharing mechanism.** `git-branch.ts`'s own comment
  already names `revision-2` and `reviewer-3-response` as expected branches,
  but every co-author in the evidence is a Word user with no tooling. A
  branch/PR path is an *optional second channel* for co-authors who also run
  SUNA, never the primary — the hard constraint is that what leaves must open
  in Word and what comes back must be parseable from that same file.
- **Reusing `revisions.json` for co-author returns without widening it.** Its
  `RevisionAuthorSchema.kind` is `z.literal('ai')`
  (`packages/core/src/revisions.ts:26-32`) and its doc says outright that "a
  human revision would be an ordinary edit" — the exact assumption a co-author
  round breaks. Widening the enum reuses the whole accept/reject-hunk UI
  feature-plan-11 shipped, at the cost of one union member.

## Build order

`12a` the registry and the manuscript-as-entry (no new kinds, no behaviour
change) · `12b` cover letters + `profile.letters` + the letter checker ·
`12c` rounds, freeze, `git:tag`, bundle manifests · `12d` returns ingest and
triage · `12e` review rounds, the response document and the redline dialects ·
`12f` the derived internal report. ADR-010's package work (`12g`–`12i`) can
start after `12a` and is otherwise independent.

Every milestone that adds an MCP verb must regenerate
`packages/agent/src/context/docs.gen.ts` and update
`resources/suna-context/MCP.md`'s table and verb count, or two drift gates in
`context.test.ts` fail.
