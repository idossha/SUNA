# Feature plan 12 — typed documents: letters, rounds, responses, sponsor packages

**Goal (user direction, 2026-08-19):** "Academic writing is not just about
writing manuscripts. It is often about writing proposals like R01 NIH/NSF,
writing internal documents, letters to editors, etc." Four asks, spelled out by
the user:

1. a **letter to the editor** inside a project, template-able by human or
   agent from the target journal and the manuscript's content;
2. **rounds of development**, internal and external, with real version control
   and a way to share an internal report along the way;
3. **peer review** — reviewer requests in, a revised manuscript and a response
   document out;
4. **export of unconventional schemas** with specific requirements, e.g. a
   grant proposal.

Decisions: `adr-009-document-kinds.md` (the registry, letters, rounds,
responses) and `adr-010-sponsor-assembly.md` (packages and the measured page
count). Ground truth: `document-kinds-findings.json` — 280 rules across five
areas, every one carrying a source URL and a provenance tag.

| ask | verdict |
| --- | --- |
| **1 — letters** | Cheap. A new document kind under `manuscript/` inherits the whole editing surface; the work is a profile block and six structural checks, one of which catches a defect in the user's own submitted letter. |
| **2 — rounds** | Half exists. `wordDiff`, `merge3`, `comments.json`, the git panel and a clean DOCX exporter are all built. What is missing is a freeze primitive (`git:tag` does not exist), a DOCX *return* parser (the import path reads zero collaboration markup), and the report — which nobody produces by hand today. |
| **3 — peer review** | One genuinely new model (`ReviewPoint`, verbatim and immutable) plus two new SciMark reply blocks. The response document reuses `buildSupplementContent`'s independent-numbering shape unchanged. |
| **4 — packages** | Hardest, and the page-count half is smaller than it looks: `pdfjs-dist` is already a main-process dependency already reading `numPages`. The real work is the slot schema and a second profile registry. |

The four share one primitive: **a project holds a set of typed documents.**
Build that once (§1) and asks 1, 3 and 4 all become "a new entry in four
tables".

---

## Build status — 2026-08-19

Nine commits on `feat/document-kinds`. Gates green throughout: `pnpm typecheck`
clean, `pnpm test` 3552 passing (from a 2459 baseline measured on `main` before
any of this landed). The UI was driven in the real app with
`scripts/e2e/drive.mjs`, not only unit-tested.

| milestone | state |
|---|---|
| **12-pre** | **done.** `manuscriptDoc` keyed by document id; comment-rail badge scoped by document path; `migrateCommentTargets` given the other documents' prose paths; stale smoke tool count and stale verb count corrected |
| **12a** | **done.** `packages/core/src/documents.ts` — the registry, `DOCUMENT_KIND_FILES`, `resolveDocuments`/`primaryDocument`/`documentForPath`/`documentPaths`. `suna.json` gains one optional `documents` field; `schemaVersion` stays 1. `paths.ts` registry helpers + `roundsDir`/`roundDir`. `DiagnosticSurface` widened. 45 tests |
| **12b** | **done, minus the AI route and identities.** Schemas, seeded skeleton, `profile.letters`, `ProvenanceBasis: 'documented-indexed'`, nine checks, `createLetter`, `letters` blocks on `science`/`nature`/`pnas`, **and the UI**: the Documents `+` menu, the New Letter sheet with live per-journal requirements, the letter tab with its Assertions panel. **Not built: the AI-draft route, `~/SunaConfig/identities`, letterhead, letter export.** |
| **12c** | **partly done.** `rounds.ts` schemas including `FreezeSchema`; round CRUD on disk; the New Round sheet and the round list in the sidebar. **Not built: the freeze itself — `git:tag` still does not exist — the snapshot, or the bundle manifest.** |
| **12d** | **not started.** No DOCX return parser; no triage queue. |
| **12e** | **done, minus the response document.** Deterministic offline segmentation verified against both real reviewer documents; two-step analyse/commit; four response checks; **and the UI**: the import screen (drop zone + paste box, per-card reasoning, coverage meter, merge/drop), and the response workspace (points list with per-reviewer progress dots, verbatim with no edit control, four statuses, assignee). **Not built: the response document itself, so `::reply`/`::quote` do not exist and `@point:` is only read by the checker.** |
| **12f, 12g, 12h, 12i** | **not started.** No redline dialects, no derived report, no sponsor package model, no rendered-page measurement. |
| **12j** | **partly done.** Ten verbs registered and driven end to end (34 total). **Not built: the four verbs covering freeze, returns and packages.** |

**Where the UI deviates from `document-kinds-ux.md`, and why:**

1. **The response workspace's third pane is "Before you send", not the
   manuscript.** §C.1 specified points / reply / manuscript. What shipped is
   points / point+status / diagnostics, because without a response document
   (12e's remaining half) there is no reply to write and no link to make, and a
   read-only manuscript pane with nothing to connect it to would be decoration.
   The pane is where the manuscript will go once linking lands.
2. **A round tab leaves the sidebar on the manuscript outline.** A round has no
   outline of its own, and the manuscript is what the round is about.
3. **The letter tab's editor is `ManuscriptEditor`.** There is no separate
   editor surface component; reusing it gets live preview, comments, three-way
   merge and the AI-diff bar for free, which is the whole argument for keeping
   letters under `manuscript/`.
4. **Non-letter document kinds open their prose in the ordinary editor**, not in
   a purpose-built tab, since only the cover letter has one so far. An honest
   fallback beats a tab that renders the wrong thing.

**Two decisions taken while building, both departures from the plan as written:**

1. **No shipped profile carries a quote nobody has read.** The plan gated 12b on
   someone re-reading the Science and Cell Press pages in a browser. That has
   not happened, and `nature.com/nature/for-authors/initial-submission` — which
   the plan recorded as re-fetched HTTP 200 — now returns **HTTP 303 to
   `idp.nature.com`**, so the flagship quotes could not be reproduced either.
   Every shipped assertion carries `quote: null` with its source URL and an
   honest basis; a table-driven test enforces the gate, and the New Letter sheet
   tells the user when a requirement came from an index.
2. **`createLetter` reads `manuscript.json` through a narrow schema**, not
   `ManuscriptSchema`, so a mid-edit block elsewhere cannot block making a
   letter.

**One thing to know about the first commit:** `git add -A` swept in the
uncommitted onboarding changes that were already in the working tree when this
work started (`OnboardingTab`, `gating`, `manifest`, `preview`, the step
components, `types`, `GitHubAccount`, `index.html`). They are intact and the
suite is green, but they are not this work and were not authored here.

**Not verified:** none of this has a `pnpm smoke` step. The driver is stale for
the flat layout (roadmap item 0), so the UI evidence above is
`scripts/e2e/drive.mjs` probes recorded during this session, not a suite that
re-runs.

---

## What already exists (do not rebuild)

- **`packages/core/src/anchor.ts`** — W3C-style quote/prefix/suffix anchoring,
  pure, no I/O, shared verbatim by the renderer's comment UI and the MCP
  `add_comment` verb, which is why human- and agent-authored anchors resolve
  identically. Works on any text document today.
- **`packages/core/src/word-diff.ts`** — `wordDiff` and `diffSpans`, fuzz- and
  round-trip-tested by feature-plan-11 §11a, measured at ~5 ms for a one-word
  edit in a 1 MB document. This is the redline engine and the
  return-anchor-mapping engine; nothing consumes it for either yet.
- **`packages/core/src/merge3.ts`** — three-way merge with the right policy
  (word-grain application, paragraph-grain conflict detection, ours never
  loses). The prose half of reconciling a return.
- **`packages/core/src/comments.ts` + `revisions.ts`** — path-keyed sidecars.
  `SectionCommentTargetSchema.path` (`:27-33`) and `Revision.path` (`:36`) are
  already manuscript-dir-relative, and `RevisionsFile.revisions` (`:46-48`) is
  already a per-path array. A new document under `manuscript/` needs **no
  schema change** to be commentable and reviewable.
- **`apps/desktop/src/renderer/src/editor/EditorTab.tsx:114-118`** — the
  comment gutter, ⌘⇧M and the AI-diff paint are granted to any `.md` whose path
  starts with `${rootDir}/manuscript/`. This one rule is why ADR-009 keeps the
  directory name.
- **`apps/desktop/src/renderer/src/state/docSessions.ts`** — one shared
  CodeMirror buffer per absolute path, dirty tracking, 1 s idle autosave,
  word-level external-reload merge, save hooks. Completely document-kind
  agnostic; needs zero changes.
- **`apps/desktop/src/main/services/export-content.ts:813`
  `buildSupplementContent`** — the SIBLING-builder precedent for a second
  document kind: same `ExportContent` shape so the DOCX/HTML/PDF writers work
  unchanged, own section source, **independent citation numbering**. Its doc
  comment (`:788-812`) argues for siblings over a mode flag.
- **`apps/desktop/src/main/services/export-notes.ts:18-35`** — the other
  precedent: a small self-owned document model with its own three writers and
  its own `output/` subdir, deliberately not routed through the manuscript
  pipeline. The template for the round report.
- **`apps/desktop/src/main/services/export-style.ts:165`
  `resolveDocumentStyle`** — the one place typography is decided, shared by all
  three writers. It takes a `PublisherProfile` and returns a scalar
  `page.marginMm`, so it is the *shape* to reuse, not a function a sponsor
  package can call: §8c adds `resolvedStyleForSlot` beside it and widens
  `marginMm` to per-side.
- **`apps/desktop/src/main/services/export-pdf.ts:171-181`** — `printToPDF`
  already produces the finished PDF as a Buffer before `writeFileAtomic`.
- **`apps/desktop/src/main/services/document-import.ts:155,161`** —
  `pdfjs-dist/legacy/build/pdf.mjs` is **already dynamically imported in the
  main process** and `doc.numPages` is **already read**. `pdfjs-dist@^6.2.108`
  is in `apps/desktop/package.json:43`.
- **`apps/desktop/src/main/services/paths.ts:10-19` `projectSubdir`** — the one
  honest directory resolver in main, honouring `suna.json`'s `directories`.
- **`apps/desktop/src/main/services/migrate-manuscript.ts:254`** — the
  migration template: build in memory → validate in memory → atomic write →
  re-read from disk → fix sidecars → only then delete, with rollback.
- **`packages/formatter/src/profiles.ts:114-139`** — `extends` deep-merge with
  cycle detection, resolved *before* validation so a base may be partial.
- **`packages/formatter/src/check/types.ts:10`** — `DiagnosticSurface` already
  includes `'export'`, and **nothing emits it**. The reserved home for
  rendered-artifact diagnostics.
- **`apps/desktop/src/main/services/git-graph.ts:17,80-81`** — `GitRefKind`
  already types `'tag'` and the parser already reads `tag: ` out of the
  decoration; `GitTimeline.tsx` already renders it as a `RefChip`.
- **`docx@9.7.1`** — `InsertedTextRun` and `DeletedTextRun` are in the
  `ParagraphChild` union. A real tracked-changes DOCX redline is possible with
  the installed dependency. `jszip@^3.10.1` is installed too, for reading a
  returned `.docx`.
- **`apps/desktop/src/renderer/src/state/commands.ts:37-42`** — an open Map
  registry read by both the palette and the shortcut dispatcher. New commands
  need no palette edits.

## The gaps

**Gap 1 — there is no way to say a project holds a second document.**
`SunaProjectManifestSchema` (`packages/core/src/project.ts:140-148`) has `name`,
one `activeProfileId`, a closed seven-key `directories` record and `settings`.
No `documents`. `openProject` decides project health by testing for one file
and reports `manuscriptPresent` over IPC (`packages/core/src/ipc.ts:244`).

**Gap 2 — a `git:tag` channel does not exist.** `packages/core/src/ipc.ts`
declares 32 `git:*` channels; none creates, lists or resolves a tag. The
display half is built and the create half is missing.

**Gap 3 — the DOCX import path reads no collaboration markup at all.** Zero
occurrences of `w:comment`, `commentRange`, `w:ins`, `w:del`, `delText`,
`people.xml` or `commentsExtended` across `document-import.ts`, `docx-html.ts`,
`docx-heuristics.ts`, `docx-references.ts` and
`packages/core/src/docx-import.ts`. The exporter emits none either.

**Gap 4 — two renderer stores are singletons.** `state/manuscriptDoc.ts:49-110`
holds one outline/scroll/citation state with no document key;
`state/comments.ts`'s `draft`/`activeId`/`revealRequest` are single global
slots. Two document tabs would corrupt each other. **Hard blockers.**

**Gap 5 — `migrateCommentTargets` is already gated; scope it anyway.**
`migrate-manuscript.ts:202-243` retargets *every* section-kind comment at the
one prose file, which against a multi-document layout would collapse every
document's comments onto `manuscript.md`. An earlier draft called that a live
data-destroying path that "runs on every project open". **That is wrong about
the code and is corrected here.** `migrateOnOpen` (`ipc.ts:271`, called at
`:303` and `:315`) does run on every open, but `migrateProject` returns at
`:285` — `if (!hasBody && !hasAuthors && !hasAffiliations) return { migrated:
false, notes: ['project is already flat'] }`, reading those three flags off
`manuscript.json` at `:280-282`. `migrateComments`, the only caller of
`migrateCommentTargets`, runs at `:394` — step 5, after that early return and
after a full successful prose migration. A project holding
`manuscript/letters/*.md` postdates the flat layout by definition, carries no
`body`/`authors`/`affiliations` key, and therefore never reaches the retarget.

The collision needs a project that is simultaneously pre-feature-plan-7 and
post-registry, which nothing can produce today. The scoping change stays in
12-pre because it costs one condition and one fixture — **cheap insurance
against a future ordering, not a live bug.**

**Gap 5b — the comment badge is a live cross-document defect.**
`RailToggleButton.tsx:13-15` counts unresolved comments project-wide with no
path filter, and every new kind writes into the one `comments.json`. **This one
is a hard blocker** (12-pre item 3).

**Gap 6 — page count is thrown away.** `export-pdf.ts:187` returns `{ path }`
and discards the pagination Chromium just computed. There is no rule class, no
profile field and no diagnostic for a rendered-page limit anywhere.

---

## §1 — The document registry (`packages/core/src/documents.ts`)

The spine. No new document kind ships in this section; the manuscript becomes a
registry entry that describes what is already on disk.

```ts
export const DOCUMENT_KIND_IDS = [
  'manuscript', 'supplement', 'cover-letter',
  'response', 'report', 'package', 'component',
] as const
export const DocumentKindIdSchema = z.enum(DOCUMENT_KIND_IDS)
export type DocumentKindId = z.infer<typeof DocumentKindIdSchema>

export const DocumentEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: DocumentKindIdSchema,
  /** MANUSCRIPT-DIR-RELATIVE prose path; may nest ('letters/cover-science.md').
   *  null on 'manuscript' (its filename lives in manuscript.json:manuscriptFile,
   *  so the registry cannot drift from it) and on kinds with no prose. */
  file: z.string().min(1).nullable(),
  meta: z.string().min(1).nullable(),
  title: z.string().min(1),
  /** TAGGED profile reference. ADR-010 puts sponsor profiles in a second
   *  registry with a second schema, and ProfileIdSchema is a bare regex
   *  (packages/core/src/profile.ts:27) so 'nih-r01' and 'science' are
   *  indistinguishable by shape — an untagged string leaves no consumer able
   *  to pick a loader, and every existing consumer resolves through the
   *  JOURNAL registry and hard-fails on a miss (export-content.ts:641,817
   *  `throw new Error('unknown publisher profile "…"')`).
   *  null inherits suna.json's activeProfileId, which is a journal id — so
   *  inheritance is defined for journal-registry kinds ONLY. Kinds 'package'
   *  and 'component' take their sponsor profile from
   *  PackageDocumentSchema.packageProfileId (§8b) and set this null; a
   *  registry:'journal' value on those two kinds is a validation error, as is
   *  registry:'sponsor' on any other kind. */
  profile: z.object({
    registry: z.enum(['journal', 'sponsor']),
    id: z.string().min(1),
  }).nullable().default(null),
  roundId: z.string().min(1).nullable().default(null),
  archived: z.boolean().default(false),
})

/**
 * Which filenames each kind owns; sidecars are always project-wide files.
 * THE SINGLE SOURCE OF TRUTH for kind→filename. ADR-009's model table cites
 * this and does not restate it; §12's demo registry entries are asserted
 * against it in the §1 unit suite, so the three cannot drift apart again.
 */
export interface KindFiles { meta: string | null; prose: string | null; extra: readonly string[] }
export const DOCUMENT_KIND_FILES = {
  manuscript:     { meta: 'manuscript.json', prose: null,               extra: ['authors.json', 'references.bib'] },
  supplement:     { meta: 'supplementary.doc.json', prose: 'supplementary.md', extra: [] },
  'cover-letter': { meta: '<id>.json',       prose: '<id>.md',          extra: ['<id>.private.json'] },
  response:       { meta: '<id>.doc.json',   prose: '<id>.md',          extra: [] },
  report:         { meta: '<id>.doc.json',   prose: '<id>.md',          extra: [] },
  package:        { meta: 'package.json',    prose: null,               extra: [] },
  component:      { meta: '<slot>.json',     prose: '<slot>.md',        extra: [] },
} as const satisfies Record<DocumentKindId, KindFiles>

export function resolveDocuments(m: SunaProjectManifest): DocumentEntry[]
export function primaryDocument(m: SunaProjectManifest): DocumentEntry
export function documentForPath(m: SunaProjectManifest, relPath: string): DocumentEntry | null
export function documentPaths(root: string, doc: DocumentEntry, proseOverride?: string): {
  dir: string; meta: string | null; prose: string | null
}
```

`suna.json` gains exactly one optional field —
`documents: z.array(DocumentEntrySchema).optional()` — and `schemaVersion`
stays `z.literal(1)`. `settings` (`project.ts:147`) is the precedent for an
additive optional block. **`resolveDocuments` returning a synthesized
one-manuscript registry when the field is absent is what makes this a zero-file
migration**, and it is the single most important function in the plan.

Four exhaustive tables, in four layers, because an import cycle makes one
monolithic registry impossible (the checker needs `@suna/formatter`, the
recipe needs Chromium, the view needs React):

| layer | file | table |
|---|---|---|
| core | `packages/core/src/documents.ts` | `DOCUMENT_KIND_FILES` |
| checker | `packages/formatter/src/check/document.ts` | `CHECKERS: Record<DocumentKindId, (input) => Diagnostic[]>` |
| export | `apps/desktop/src/main/services/export-recipes/index.ts` | `RECIPES: Record<DocumentKindId, ExportRecipe>` |
| renderer | `apps/desktop/src/renderer/src/state/docKinds.ts` | `DOC_KIND_VIEWS`, `DOC_KIND_LABELS` |

`CHECKERS.manuscript = checkManuscript` unchanged;
`RECIPES.manuscript = buildExportContent` unchanged;
`DOC_KIND_VIEWS.manuscript = 'manuscript'` → the existing `ManuscriptTab`.

`paths.ts` gains `documentDir(dir, docId)` / `documentFile(dir, docId, role)`;
`manuscriptJsonPath` (`:21`), `commentsJsonPath` (`:25`) and
`revisionsJsonPath` (`:29`) become one-line wrappers that **return
byte-identical strings** for the primary document.

It also gains `roundsDir(dir)` and `roundDir(dir, roundId)`, which return
`<dir>/rounds` and `<dir>/rounds/<id>` **unconditionally** — `rounds/` is not a
`ProjectDirKey` and is not renameable. That is a decision, argued in ADR-009
(*`rounds/` and `identity.json` are fixed at the project root*):
`SunaProjectManifestSchema.directories` is
`z.record(ProjectDirKeySchema, z.string().min(1))` (`project.ts:144`), an
exhaustive record whose seven keys every shipped `suna.json` lists
(`examples/hello-suna/suna.json`), so widening `PROJECT_DIR_KEYS` would
invalidate every manifest on disk. The helpers exist anyway so that
`paths.ts:5-8`'s invariant — *every service that touches a source of truth
resolves its path through here* — stays literally true, even for the one
directory with nothing to look up.

`packages/formatter/src/check/types.ts` widens:

```ts
export type DiagnosticSurface =
  | 'figure' | 'manuscript' | 'export' | 'letter' | 'response' | 'package'
export interface DiagnosticTarget {
  figureId?: string; elementId?: string; sectionPath?: string
  documentId?: string; slotId?: string; pointId?: string; assertionId?: string
}
```

**Acceptance criteria**
- A project with no `documents` field in `suna.json` opens, checks, edits and
  exports **byte-identically** to today; nothing is written to `suna.json`.
- `documentPaths(root, primaryDocument(m))` returns exactly the strings
  `manuscriptJsonPath` / prose path return today, for a manifest with and
  without a renamed `directories.manuscript`.
- Adding an eighth member to `DOCUMENT_KIND_IDS` produces **four** compiler
  errors, one per table, and no runtime fallback.
- `documentForPath(m, 'letters/x.md')` resolves; `documentForPath(m, 'nope.md')`
  returns null rather than throwing.
- Every `documents[]` entry in `examples/hello-suna` and `examples/demo-grant`
  matches `DOCUMENT_KIND_FILES` for its kind — the assertion that stops the
  table, ADR-009's model table and the demo fixtures drifting apart.
- `profile: { registry: 'sponsor', … }` on a `cover-letter` entry, and
  `{ registry: 'journal', … }` on a `package` entry, both fail validation.
  A `package` entry with `profile: null` resolves its sponsor profile from
  `packageProfileId` and **never** falls back to `activeProfileId`.

---

## §2 — Cover letters (ask 1)

### 2a — the sidecar

`manuscript/letters/<id>.md` (prose, source of truth) plus
`manuscript/letters/<id>.json`. Because it sits under `manuscript/` it gets the
comment gutter, the rail, ⌘⇧M, three-way merge and the AI-diff review bar on
day one — no renderer work.

```ts
export const LetterKindSchema = z.enum([
  'submission', 'revision', 'appeal', 'presubmission-enquiry',
])

export const LETTER_ASSERTION_IDS = [
  'dualPublication', 'relatedManuscripts', 'priorSubmission', 'competingInterests',
  'dataLocation', 'codeLocation', 'humanConsent', 'animalCare', 'authorship',
  'correspondingContact', 'presubmissionDiscussion', 'colleaguesShown',
  'suggestedReviewers', 'excludedReviewers', 'abbreviatedSummary', 'preregistration',
  'extendedFormatJustification', 'acceleratedPublication', 'consortium',
  'journalFit', 'background', 'conceptualAdvance', 'revisionSummary', 'appealGrounds',
] as const
export const LetterAssertionIdSchema = z.enum(LETTER_ASSERTION_IDS)

/** Where the author put this assertion, compared against where the profile
 *  says it belongs. 'inline-prose' means "I wrote it in my own words" and the
 *  checker stops asking; 'not-applicable' requires a reason. */
export const AssertionPlacementSchema = z.enum([
  'directive', 'inline-prose', 'submission-form', 'not-applicable',
])

export const LetterAssertionSchema = z.object({
  id: LetterAssertionIdSchema,
  placement: AssertionPlacementSchema,
  /** The AUTHOR's words. SUNA never writes this; it only flags absence. */
  text: z.string().min(1).nullable(),
  reason: z.string().min(1).nullable(),
})

/** Structural, so "no repository named" is a FACT, not a prose heuristic. */
export const DataLocationSchema = z.object({
  repository: z.string().min(1),
  accession: z.string().min(1).nullable(),
  restrictions: z.string().min(1).nullable(),
  availableAt: z.enum(['now', 'on-publication', 'on-request']),
})

export const CoverLetterMetaSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('cover-letter'),
  letterKind: LetterKindSchema,
  /** The journal this letter addresses. NEVER silently inherited. */
  targetProfileId: z.string().min(1),
  salutation: z.string().min(1).nullable(),
  identityId: z.string().min(1).nullable(),      // ~/SunaConfig/identities/<id>.json
  signerIds: z.array(z.string().min(1)).default([]),
  /** >=1. First is primary; further entries are companion papers. */
  covers: z.array(z.object({
    documentId: z.string().min(1).nullable(),
    siblingProjectPath: z.string().min(1).nullable(),   // read-only, hand-entered
    title: z.string().min(1).nullable(),
    articleType: z.string().min(1).nullable(),
    authorsLine: z.string().min(1).nullable(),
  })).min(1),
  assertions: z.array(LetterAssertionSchema).default([]),
  dataLocations: z.array(DataLocationSchema).default([]),
  /** Brain's 323 chars incl. spaces. Counted on the RENDERED string. */
  abbreviatedSummary: z.string().nullable().default(null),
  priorSubmissions: z.array(z.object({
    journal: z.string().min(1),
    outcome: z.enum(['rejected','transferred','withdrawn','under-appeal','in-press']),
    date: z.iso.date().nullable(), note: z.string().nullable(),
  })).default([]),
  reviewRoundId: z.string().min(1).nullable().default(null),  // letterKind 'revision'
})
```

**No `date` field.** The letter date is derived from the clock at export — which
is exactly what prevents the stale date baked into the user's own filename
(`042826`, `cl.example.filename-is-version` in the rounds area).

Confidential lists live in `manuscript/letters/<id>.private.json`
(`suggestedReviewers`, `excludedReviewers`, `colleaguesShown` with names, emails
and exclusion reasons), **gitignored by default** with a banner in the UI.

*Gitignored by whom, and when.* `PROJECT_GITIGNORE` is written only at scaffold
(`apps/desktop/src/main/services/project.ts:143,429`) and at docx-import
(`docx-import.ts:602`), so a project created before this feature never gains the
stanza on its own; the only additive path is `ensureGitignoreLine`
(`packages/agent/src/context/ensure.ts:349-369`), which is module-private and
called from exactly one place, for `.mcp.json` (`:343`). So: **export
`ensureGitignoreLine`, and have `letter:new` call it for
`manuscript/**/*.private.json` in the same transaction that first creates the
file, before the write.** The ignore line lands first or the file is not
written. `returns:import` does the same for `rounds/**/returns/_raw/` (§4).

### 2b — per-user identity

New global store, because a lab crest and a PI's signature are neither
manuscript data nor journal data and are reused across every project:

```ts
export const IdentitySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['letterhead', 'signer']),
  organization: z.string().min(1).nullable(),
  unit: z.string().min(1).nullable(),
  postal: z.object({ street: z.string(), city: z.string(), region: z.string(),
                     postalCode: z.string(), country: z.string() }).nullable(),
  phone: z.string().nullable(), fax: z.string().nullable(), web: z.url().nullable(),
  /** userData-relative asset paths; embedded ONLY at export. */
  logoPaths: z.array(z.string().min(1)).default([]),
  authorId: z.string().min(1).nullable(),        // join to authors.json
  displayName: z.string().min(1).nullable(),
  postNominals: z.string().min(1).nullable(),    // "MD, PhD" — authors.json has no such field
  titles: z.array(z.string().min(1)).default([]),
  email: z.email().nullable(),
  signatureImagePath: z.string().min(1).nullable(),
})
export const IdentityFileSchema = z.object({
  schemaVersion: z.literal(1), identities: z.array(IdentitySchema),
})
```

`~/SunaConfig/identities/*.json` with `identities/assets/`, overridable per
project by `identity.json`. Referenced by path, embedded only at export — the
boundary a rasterized `figure.svg` already crosses.

### 2c — the profile block

Additive and optional; `PublisherProfileSchema.schemaVersion` stays `3`.

```ts
export const AssertionRequirementSchema = z.object({
  id: LetterAssertionIdSchema,
  stance: z.enum(['required', 'optional', 'discouraged', 'elsewhere']),
  /** Where the journal says it belongs when stance is 'elsewhere'. */
  vehicle: z.enum(['cover-letter','submission-form','manuscript','separate-form']).nullable(),
  limit: z.object({ unit: z.enum(['characters','words']), max: z.number().int().positive() }).nullable(),
  /** The venue's own words. */
  quote: z.string().min(1).nullable(),
  source: z.url().nullable(),
  /** HOW the quote is known. Required whenever `quote` is non-null: a quote
   *  with a URL beside it reads as "read from that page", and for Science and
   *  Cell Press that is not true today (both 403 to direct fetch; the ground
   *  truth records the quotes as captured from a search index). */
  basis: ProvenanceBasisSchema.nullable(),
})

export const LetterRulesSchema = z.object({
  /** 'not-requested' is a REAL, SOURCED answer (PNAS) and must be
   *  distinguishable from silence, which is the block being absent. */
  stance: z.partialRecord(LetterKindSchema,
            z.enum(['required','optional','not-requested'])),
  /** eLife: required for Review Articles and Replication Studies. */
  requiredForArticleTypes: z.array(z.string().min(1)).default([]),
  assertions: z.array(AssertionRequirementSchema).default([]),
  confidentialToEditor: z.boolean().nullable(),
  sources: z.array(z.url()),
  provenance: z.array(ProvenanceEntrySchema).optional(),
})

// PublisherProfileSchema gains:  letters: LetterRulesSchema.optional()
```

Three-state epistemics, extended one step:

| state | means |
|---|---|
| block absent | nobody has researched this journal's letter rules yet |
| `stance` value absent for a kind | researched; the journal says nothing about that kind |
| `{ stance: 'not-requested', quote, source }` | the journal explicitly does not ask for one |

That third state is why PNAS gets a filled-in block: a Compliance panel that
says "PNAS does not request a cover letter; the significance statement goes in
the manuscript instead (≤120 words)" beats silence.

**And a fourth provenance state, for a quote whose page was never fetched.**
`ProvenanceBasisSchema` (`packages/core/src/profile.ts:35-39`) gains
`'documented-indexed'` beside `documented | counted-empirically | inferred`: the
venue states this, but the sentence was captured from a search index rather than
read from the cited page. It is a union **addition**, so all thirteen shipped
profiles parse unchanged and `PublisherProfileSchema.schemaVersion` stays `3`.

This is not hypothetical bookkeeping. `www.science.org` and `www.cell.com` both
return **HTTP 403** to direct fetch (Cloudflare; reproduced 2026-08-19, and the
research session's own cached copy of the Science page is a challenge page, not
the guidelines), and 28 rules in `document-kinds-findings.json` now carry
`documented-indexed` because of it — including every rule behind
`letter.data-location-unspecified` and `letter.journal-name-mismatch`, which are
**error**-severity checks. The gate is in the milestone table: **no
`AssertionRequirementSchema.quote` ships with `basis: 'documented-indexed'`.**
Somebody opens the pages in a browser, confirms the wording, and downgrades them
to `documented` with a date — or the assertion ships with `quote: null` and the
diagnostic cites the URL without claiming to quote it.

The mirror-image case is worth stating because it is how this is supposed to
work: the flagship Nature cover-letter page *was* re-fetched (HTTP 200), its
three quotes reproduce verbatim and stay `documented`, and the one sentence that
did **not** survive the check — "suggested or excluded referees in the cover
letter", which is Communications Physics' wording, not the flagship's — is now
recorded as `cl.nature.reviewers-vehicle: null / not-stated` with a note saying
the source was read in full and is silent. A `nature` profile therefore leaves
the reviewer vehicle unset instead of inheriting the portfolio sentence.

### 2d — the checker (`packages/formatter/src/check/letter.ts`)

| id | severity | fires when |
|---|---|---|
| `letter.assertion-missing` | from stance | the profile requires it; the sidecar has no entry |
| `letter.assertion-misplaced` | warning | declared `directive` where the profile says `vehicle: 'submission-form'`, or the reverse |
| `letter.assertion-not-rendered` | warning | declared `directive` but no `::assert{}` names it |
| `letter.assertion-forbidden` | warning | stated where the profile's stance is `discouraged` — **except** the abstract-overlap case (below) |
| `letter.journal-name-mismatch` | **error** | a bundled profile's `journalName` appears in the rendered letter and is neither the target nor a declared `priorSubmissions[].journal` |
| `letter.summary-over-limit` | error | `abbreviatedSummary` rendered length > the profile's `maxChars`, counted **including spaces** |
| `letter.data-location-unspecified` | error | the profile requires `dataLocation` and `dataLocations[]` is empty or has a null `repository` |
| `letter.contradicts-manuscript` | warning | the letter's competing-interests assertion disagrees with `backMatter.competingInterests` |
| `letter.corresponding-contact-missing` | error | the profile requires it and no `authors.json` entry has `corresponding: true` with a non-null `email` |

Nature's "avoid repeating information that is already present in the abstract
and introduction" (`cl.nature.no-repeat`) is a real stated rule with **no stated
threshold**. It is encoded `stance: 'discouraged'` and surfaced in the
**Requirements panel** as the measured longest shared run beside Nature's own
sentence and URL — **not** as a Diagnostic. `DiagnosticSeverity` is
`'error' | 'warning'`; there is no severity meaning "here is a measurement,
you decide", and inventing a similarity cutoff is exactly what ADR-002 forbids.

### 2e — derivation and the seeded skeleton

`letter:new` writes a Markdown skeleton whose paragraphs are seeded from data
SUNA already holds (title, articleType, `journalName`, `abstract.content`,
`significance`, `availability.*`, `backMatter.competingInterests`, derived
display-item and reference counts, the corresponding author's name/email/
affiliation) and whose assertion set is pre-populated with every assertion the
target profile marks `required`, all with `text: null`.

The abstract seed is inserted as an **agent comment on the paragraph** —
"seeded from the abstract; Nature asks you to rewrite, not repeat" — not as
prose. That reuses the existing comment path and keeps the checker from ever
checking its own output.

**Acceptance criteria**
- A letter created against a `science` profile with an untouched skeleton
  produces exactly the `letter.assertion-missing` set Science's nine items
  imply, each message quoting the journal's own sentence and citing its URL
  through the existing `sourceSuffix` (`packages/formatter/src/check/util.ts:8-13`).
- A letter whose prose contains "Science Advances" while targeting `science`
  produces `letter.journal-name-mismatch` as an **error**. Adding
  `priorSubmissions: [{ journal: 'Science Advances', … }]` clears it.
- A 324-character `abbreviatedSummary` against a Brain profile fails; 323
  passes; the count includes spaces.
- `dataLocations: []` against Science produces
  `letter.data-location-unspecified` **even when the prose says "data will be
  made available upon publication"** — the check never reads that sentence.
- A letter targeting `pnas` produces no `letter.assertion-missing` and the
  Requirements panel shows the not-requested explainer.
- Exporting the letter to PDF and DOCX writes `output/letters/<id>.<ext>`; the
  DOCX contains no diff/comment markup and the rendered letterhead embeds the
  identity's PNG assets. The Requirements panel labels the layout **"SUNA house
  style — no journal states cover-letter typography"**
  (`cl.example.typography-conflict`).
- Creating a letter in a project whose `.gitignore` predates this feature (or
  has none) leaves `manuscript/**/*.private.json` ignored: `git status
  --porcelain` never lists the `.private.json` file, and the `.gitignore` line
  is written **before** it.
- No shipped `letters` block contains an assertion with a non-null `quote` whose
  `basis` is `documented-indexed` — a table-driven test over
  `resources/profiles/*.json`, and the gate on milestone 12b.

---

## §3 — Rounds and the freeze (ask 2, part 1)

### 3a — the schemas

```ts
export const RoundTrackSchema   = z.enum(['internal', 'external'])
export const RoundPurposeSchema = z.enum([
  'circulate', 'submission', 'review', 'revision', 'appeal', 'resubmission', 'transfer',
])
export const RoundStateSchema = z.enum([
  'open', 'frozen', 'circulated', 'awaiting-decision', 'closed',
])

/** An observation with a fingerprint, NOT stored numbering. A measurement whose
 *  fingerprint no longer matches is reported as STALE, never as truth. */
export const PageMeasurementSchema = z.object({
  artifactId: z.string().min(1),                       // documentId | "<packageId>/<slotId>"
  format: z.enum(['pdf', 'docx', 'html']),
  pages: z.number().int().positive().nullable(),       // null = not measurable (DOCX)
  lines: z.number().int().nonnegative().nullable(),
  minBodyPt: z.number().positive().nullable(),
  missingFonts: z.array(z.string()).default([]),       // non-empty ⇒ pages untrustworthy
  measuredAt: z.iso.datetime(),
  /** sha256 over commit + ExportOptions + figure hashes + profileId. */
  fingerprint: z.string().min(1),
})

export const FreezeSchema = z.object({
  at: z.iso.datetime(),
  tag: z.string().min(1).nullable(),                   // "suna/round/<id>"
  commit: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  /** True when the tree was dirty at freeze time. Flagged, never fixed. */
  dirty: z.boolean(),
  /** Manuscript-relative files snapshotted under rounds/<id>/frozen/.
   *  Includes comments.json and revisions.json: `dirty` above and the
   *  no-git case below both make git an unreliable second side for the
   *  report's comment diff, so the snapshot is the primary source. */
  snapshot: z.array(z.string().min(1)),
  /** Rendered text captured at freeze, per prose file a deliverable was cut
   *  from: rounds/<id>/frozen/rendered/<file>.txt plus <file>.map.json.
   *  This is what a returned markup is anchored against (§4) — the DOCX the
   *  co-author read is not the Markdown. Empty when no deliverable was
   *  rendered at freeze time. */
  rendered: z.array(z.object({
    file: z.string().min(1),          // manuscript-relative source path
    text: z.string().min(1),          // frozen/rendered/<file>.txt
    map: z.string().min(1),           // frozen/rendered/<file>.map.json
    format: z.enum(['docx', 'pdf', 'html']),
  })).default([]),
  profileId: z.string().min(1),
  exportOptions: ExportOptionsSchema,                  // incl. lineNumbers — load-bearing
  figureHashes: z.record(z.string(), z.string()),      // sha256 per figure.svg
  measurements: z.array(PageMeasurementSchema).default([]),
})

export const DeliverableSchema = z.object({
  id: z.string().min(1),          // 'response' | 'marked-up' | 'clean' | 'cover-letter'
  label: z.string().min(1),
  requirement: z.enum(['required', 'optional', 'forbidden', 'not-stated']),
  source: z.url().nullable(),     // the venue's own URL; null only for house deliverables
  markingDialect: z.enum(['tracked-changes', 'colored-text']).nullable(),
  satisfiedBy: z.string().min(1).nullable(),           // artifactId in bundle.json
})

export const RoundSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^r\d{2,}-[a-z0-9-]+$/),
  ordinal: z.number().int().positive(),
  track: RoundTrackSchema,
  purpose: RoundPurposeSchema,
  title: z.string().min(1),
  state: RoundStateSchema,
  venue: z.object({ profileId: z.string().min(1), name: z.string().min(1),
                    submissionId: z.string().nullable() }).nullable(),
  documents: z.array(z.string().min(1)).min(1),        // documentIds in scope
  previousRoundId: z.string().min(1).nullable(),
  openedAt: z.iso.datetime(),
  freeze: FreezeSchema.nullable(),
  deliverables: z.array(DeliverableSchema).default([]),
  decision: z.object({
    at: z.iso.date(),
    outcome: z.enum(['major-revision','minor-revision','reject',
                     'reject-with-resubmission','accept','transfer','desk-reject']),
    editor: z.string().nullable(), dueAt: z.iso.date().nullable(),
  }).nullable(),
  reportDocumentId: z.string().min(1).nullable(),
  responseDocumentId: z.string().min(1).nullable(),
  closedAt: z.iso.datetime().nullable(),
  closeNote: z.string().nullable(),
})

export const RoundsIndexSchema = z.object({
  schemaVersion: z.literal(1),
  rounds: z.array(z.object({
    id: z.string(), ordinal: z.number().int(), track: RoundTrackSchema,
    purpose: RoundPurposeSchema, title: z.string(), state: RoundStateSchema,
  })),
  activeRoundId: z.string().min(1).nullable(),
})
```

### 3b — `rounds:freeze`

Four steps, in order:

1. `flushDirtySessions(dir)` — the existing choke point (feature-plan-11 §11d),
   so the freeze snapshots what the author can see.
2. `git rev-parse HEAD` + `gitStatus`. A dirty tree is offered a commit; if
   declined, `dirty: true` is **recorded**, not fixed.
3. **`git:tag`** — a new channel creating an annotated tag `suna/round/<id>`.
   `git-graph.ts:17,80-81` already parses tags and `GitTimeline.tsx` already
   renders them; only creation is missing. Also `git:tags` (list) and
   `git:show-file` (read a path at a ref).
4. Write `rounds/<id>/frozen/` — the verbatim text of every in-scope prose file
   plus `manuscript.json`, `authors.json`, **`comments.json` and
   `revisions.json`** — then `round.json` with the profile id, the exact
   `ExportOptions` and a sha256 per `figure.svg`. (Reviewer records are already
   immutable at `rounds/<id>/reviewers/` and are not copied.)
5. For every deliverable rendered from this freeze, write
   `frozen/rendered/<file>.txt` and `<file>.map.json` (§4). The exporter
   produces both in the same walk that emits the runs, so this is a write, not
   a second render.

The sidecars are in the snapshot because the report (§5) diffs `comments.json`
between two freezes, and deriving that from git would make the report's central
section computable **only** when a repository exists and **only** when the file
was committed at both ends. `FreezeSchema.dirty` records an uncommitted tree as
a supported outcome and step 3 is skipped entirely with no `.git`, so git is the
fallback here and the snapshot is the source.

Both halves are kept because each answers what the other cannot: the tag has
nowhere to put the profile or the export options, and without
`ExportOptions.lineNumbers` a reviewer's "line 99" is unresolvable
(`export-pdf.ts:52-92` shifts the body when line numbers are injected). The
snapshot makes the round work with no git and survive a shallow clone —
`revisions.json` already set the whole-file-pre-image precedent
(`packages/core/src/revisions.ts:1-24`).

Where no git repository exists, step 3 is skipped and the skip is reported.

### 3c — the bundle

`export:package` (§9) and the per-document export channels write into
`output/rounds/<id>/` with a **derived** filename (`<slug>-<roundId>-<date>`).
`bundle.json` records every artifact with its sha256, byte size and
`PageMeasurement`. DOCX exports stamp the commit sha and round id into
`docProps` custom properties, so a file that comes back six weeks later
identifies the freeze it was cut from.

**`outputName` stays.** An earlier draft said the derived filename "replaces the
free-text `outputName` in `export:docx|html|pdf`", which contradicted §12's
promise that those three channels only *gain* an optional field and every
existing renderer call behaves identically, and would have deleted a shipped
user control: `outputName` is `z.string().min(1)` and **required** on all three
(`packages/core/src/ipc.ts:1556,1583,1601`) and is a user-typed field that gates
the Export button (`ExportDialog.tsx:97,248,262`). It would also have moved the
filename out from under §12's byte-identical export gate.

The round path is **additive**: the three channels gain an optional
`roundId: z.string().min(1).nullish()`. When present the output directory
becomes `output/rounds/<id>/` and the derived `<slug>-<roundId>-<date>` becomes
the **default value** of the dialog's name field — which the user may still
overwrite. When absent, everything behaves exactly as today.

**Acceptance criteria**
- `rounds:freeze` on a clean tree creates a tag visible in `GitTimeline` with
  no changes to that component, writes a snapshot whose files are byte-identical
  to the working tree, and records the resolved profile id and options.
- Freezing on a dirty tree with the commit declined records `dirty: true` and
  the UI says so.
- `git show suna/round/<id>:manuscript/manuscript.md` and
  `rounds/<id>/frozen/manuscript.md` are byte-identical.
- Freezing in a project with no `.git` succeeds with `tag: null, commit: null`
  and a reported note.
- Two freezes of the same tree produce identical fingerprints; changing one
  `figure.svg` changes the fingerprint and marks the previous measurement stale.
- `frozen/comments.json` is byte-identical to `manuscript/comments.json` at
  freeze time, in a project with **no** `.git` and in a project frozen dirty.
- Freezing after a DOCX deliverable is cut writes
  `frozen/rendered/manuscript.txt` whose text equals the plain text of that
  `.docx`, and a `.map.json` whose entries are monotone in both coordinates.
- `export:docx` with no `roundId` writes exactly the path it writes today, from
  the same user-supplied `outputName`.

---

## §4 — Returns: ingesting a marked-up DOCX (ask 2, part 2)

The genuinely new parser. `jszip` is already installed
(`apps/desktop/package.json:38`); the import path today reads **zero**
collaboration markup (Gap 3).

```ts
export const ReturnedCommentSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  /** Anchored against rounds/<id>/frozen/rendered/<file>.txt — the RENDERED
   *  text they actually read, not the Markdown. See "Anchor against the
   *  rendered freeze" below. */
  renderedAnchor: CommentAnchorSchema,
  /** The same span mapped back to the frozen SOURCE through <file>.map.json.
   *  null when the span lies entirely in derived text (a citation number, a
   *  figure label, the generated reference list) — a precise structural
   *  answer, not a failure. */
  frozenAnchor: CommentAnchorSchema.nullable(),
  /** 'low' when the quote is under the minimum-information floor or ambiguous. */
  confidence: z.enum(['high', 'low']),
  body: z.string().min(1),
  fileAuthor: z.string().min(1),                 // w:author — demonstrably unreliable
  claimedAuthor: z.string().nullable(),          // parsed "<Name> Comment …" prefix
  authorId: z.string().nullable(),               // confirmed by a human at triage
  doneInFile: z.boolean(),                       // w15:done
  acceptedCommentId: z.string().nullable(),
})

export const ReturnedEditSchema = z.object({
  id: z.string().min(1), documentId: z.string().min(1),
  renderedAnchor: CommentAnchorSchema,
  frozenAnchor: CommentAnchorSchema.nullable(),
  before: z.string(),                             // from w:delText — fully recoverable
  after: z.string(),
  fileAuthor: z.string().min(1),
  status: z.enum(['pending', 'accepted', 'rejected']),
})

/** Nothing in a returned file is ever dropped silently. */
export const UninterpretedMarkSchema = z.object({
  id: z.string().min(1),
  reason: z.enum(['highlight','prose-instruction','unanchored','orphan-part',
                  'field-code','derived-span']),
  detail: z.string().min(1),
})

export const ReturnSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1), roundId: z.string().min(1),
  receivedAt: z.iso.datetime(),
  sourceFile: z.string().nullable(),              // rounds/<id>/returns/_raw/… if kept
  sourceSha256: z.string().nullable(),
  fromAuthorId: z.string().nullable(),
  comments: z.array(ReturnedCommentSchema).default([]),
  edits: z.array(ReturnedEditSchema).default([]),
  uninterpreted: z.array(UninterpretedMarkSchema).default([]),
  triagedAt: z.iso.datetime().nullable(),
})
```

New service `apps/desktop/src/main/services/docx-return.ts` reads all four
channels real files use — comments (`rnd.example.comment-parts`, which is the
evidence that the markup lives in five sidecar parts and never inline, i.e.
where to look), tracked changes (`rnd.example.deltext`,
`rnd.example.tracked-attrs`), highlight runs
(`rev.example.assignment-highlight`) and instructions written into the prose
(`rnd.example.assignment-in-prose`) — and must tolerate what real files actually
contain:

- `word/comments.xml` is **the list**; `commentsExtended.xml` supplies
  `w15:done` and `w15:paraIdParent` keyed on the comment's **LAST** paragraph
  (`rnd.ooxml.paraid-last`, confirmed empirically); `commentsIds.xml` and
  `commentsExtensible.xml` are best-effort enrichment only — the real file has
  12 commentEx entries against 11 commentId entries, and 22 orphan durableIds
  matching none of the live ones (`rnd.example.sideparts-inconsistent`,
  `rnd.example.extensible-orphans`).
- A comment may have a `w:commentReference` with **no range**
  (`rnd.example.point-anchor`) — that is a whole-document target, not an error.
- `w:ins`/`w:del` carry `w:delText`, so a rejected deletion is fully
  recoverable, and an insertion carries run formatting
  (`rnd.example.deltext`, `rnd.example.ins-formatting`).
- `w:highlight` runs and prose instructions become `uninterpreted[]`, preserved
  verbatim and surfaced. Interpreting magenta as a person would be inventing
  meaning — but dropping it loses the lab's actual assignment convention
  (`rev.example.assignment-highlight`).

**Three guards the evidence demands.**

*Anchor against the RENDERED freeze, then map twice.* An earlier draft said
"locate in `rounds/<id>/frozen/<file>` — guaranteed to resolve, it is the text
they read". That premise is false. What the co-author read is
`output/rounds/<id>/manuscript-marked.docx` (ADR-009's on-disk tree), produced
by the manuscript exporter, in which `[@key]` has become a superscript number
(`export-docx.ts:246` sets `superScript` from `renderCluster`'s form, driven by
`ExportContent.numbers`/`citeStyle`) and `![[fig:x]]` / `@fig:x` have become
"Figure 2". The frozen `.md` is SciMark source. They are different strings, so
every comment touching a citation, a cross-reference, a figure label or a
generated reference entry was being anchored against text the reader never saw.

So the freeze stores the rendered side too (§3b step 5) and anchoring is a
three-step compose:

1. **locate in `frozen/rendered/<file>.txt`** — this one really is guaranteed,
   because it is the plain text of the exact artifact that was sent;
2. **map rendered → frozen source through `<file>.map.json`**;
3. **map frozen source → HEAD through `wordDiff(frozen, current)`**, then derive
   a fresh anchor from current text.

If the span was deleted between freeze and HEAD, the comment lands `detached`
with the rendered quote preserved. Nothing in the current model composes anchors
across representations *or* across a range of commits; this is that piece.

The map is cheap to produce because the exporter knows both sides at emit time.
`ExportSection` already carries `source: string` and the parsed SciMark AST
whose mdast nodes carry positions (`export-content.ts:530-536`), so the same
walk that emits runs also emits a monotone segment list
`[{ renderedStart, renderedEnd, sourceStart | null }]`. A run whose text is
**derived** — a citation number from `renderCluster`, a label from
`ExportContent.labels`, a reference-list row — records `sourceStart: null`.

*A source-less span never becomes a prose anchor.* Comment id 1's entire anchor
is the single character `3` inside `(See Figure 3)` — a **derived** number that
does not exist in the Markdown at all (`rnd.example.derived-number-anchor`).
Step 2 maps it to `null`, which is a precise structural answer rather than a
heuristic: `frozenAnchor: null`, an `uninterpreted[]` mark with
`reason: 'derived-span'`, and a retarget offered to `kind: 'figure'` on the
figure that number resolved to (the label map is in the freeze, so the
resolution is exact). This is the **general case** for citation and
cross-reference anchors — not an outlier, and not a length problem.

*A minimum-information floor.* Real ranges run 1 to 504 characters. Even inside
mapped prose, `locate()`'s tier-1 uniqueness check would sail past a
one-character quote, score on 32 characters of drifted context and return a
confident wrong answer. Below the floor → `confidence: 'low'` → the human queue,
never `comments.json`.

Author identity is never trusted: 12/12 comments in the real file carry one
`w:author` while five bodies begin "Evan Comment"
(`rnd.example.author-unreliable`). `claimedAuthor` produces a **suggestion**
shown with its reason, in the style `docx-import.ts` already uses for
front-matter fields.

`CommentAuthorSchema.kind` widens `['human','agent']` → `['human','agent',
'coauthor','reviewer']` and `RevisionAuthorSchema.kind` widens
`z.literal('ai')` → `z.enum(['ai','coauthor'])`. Both are union **additions**,
so every existing `comments.json` and `revisions.json` still parses.

Triage is **per item**, not an N-way merge: accept a comment (it becomes an
ordinary `comments.json` entry with round/return provenance), accept an edit (it
lands as a reviewable hunk through the accept/reject UI feature-plan-11 §11f
shipped), or dismiss with a reason. Three co-authors returning three files
produce three independent records; a sentence with three comments keeps three
threads.

**Acceptance criteria**
- A fixture `.docx` with 12 comments, 5 tracked changes, mixed highlight runs
  and one range-less comment reference yields 12 `ReturnedComment`s (one with a
  whole-document target), 5 `ReturnedEdit`s with recoverable `before` text, and
  a non-empty `uninterpreted[]`.
- A comment anchored to a 1-character quote yields `confidence: 'low'` and is
  **not** written into `comments.json` without a human action.
- A comment whose anchored span was deleted between freeze and HEAD lands
  `detached` with the rendered quote intact.
- **A comment anchored on a rendered citation number** — the superscript `12`
  the DOCX shows where the source says `[@smith2020]` — resolves to
  `frozenAnchor: null`, an `uninterpreted[]` mark with `reason: 'derived-span'`,
  and a retarget offer to the reference. It never lands as a prose anchor on the
  digit `1` or `2` somewhere else in the text.
- **A comment anchored on a rendered figure label** ("Figure 2", or the `3` in
  "(See Figure 3)") resolves to `frozenAnchor: null` and is offered a retarget to
  `kind: 'figure'` on the figure that label resolved to in the freeze.
- A comment anchored on ordinary rendered prose whose source is unchanged maps
  through both steps to the byte-identical span in HEAD.
- A body beginning "Evan Comment" yields `claimedAuthor: 'Evan'` and no
  `authorId` until confirmed.
- The returned `.docx` is never rewritten, and `returns/_raw/` is covered by the
  `.gitignore` stanza — written by `returns:import` through the exported
  `ensureGitignoreLine`, **before** the raw file is saved, including in a
  project whose `.gitignore` predates this feature.

---

## §5 — The derived internal round report (ask 2, part 3)

Document kind `report`. `reports/<id>.doc.json` declares only
`{ from: roundId | null, to: roundId | 'HEAD', include: {…} }`; every word of
the generated content is computed at build time into a **managed region** of
`reports/<id>.md`:

```
<!-- suna:round-report v1 begin -->  …derived…  <!-- suna:round-report v1 end -->
```

Human prose above and below survives regeneration. **This is a new mechanism,
not an inherited one**, and the contract has to be written out rather than
borrowed. `suna:agent-stub v1` (`packages/agent/src/context/templates.ts:18-31`)
is the *opposite* shape: a whole-file ownership flag tested on the first line
only (`isManagedStub`), where the marker's presence licenses SUNA to rewrite the
**entire** file and deleting it hands the whole file to the user forever. There
is no begin/end managed-region precedent anywhere in the codebase
(`rg 'suna:[a-z-]+ v1'` outside docs finds only `templates.ts:23`; there is no
`BEGIN`/`END` pair of any kind). So its edge cases are specified here:

| situation | behaviour |
|---|---|
| both markers present, in order | the region between them is replaced; everything outside is preserved byte for byte |
| a human edited **inside** the region | overwritten without warning — the region is derived, and the report says so in a line inside it |
| **no** markers at all (a hand-made file, or both deleted) | the user owns the file. `report:build` writes **nothing**, reports "no managed region — this file is yours", and offers to write to a new `<id>.report.md` |
| exactly **one** marker, or `end` before `begin` | **fails loudly**: no write, a diagnostic naming the line number of the marker it found. Never "regenerate the whole file" — that is how a half-deleted marker eats a co-author's notes |
| **two** begin markers | same failure, same reason |
| a future `v2` marker | left alone and reported; a newer region is not rewritten by an older builder |

The version in the marker exists for that last row and follows
`STUB_MARKER_RE`'s `v\d+` convention, which is the one thing genuinely inherited
from the stub.

Derived content, every line from data already on disk:

| section | derived from |
|---|---|
| prose changes since the previous freeze | `wordDiff(frozen, current)` grouped by heading path via `outlineFromMarkdown` |
| comments closed, still open, newly `detached` | `comments.json` diffed between the two **snapshots** — `rounds/<from>/frozen/comments.json` against `rounds/<to>/frozen/comments.json` (§3b step 4). `gitShowCommit`/`gitDiffFile` are a **fallback** for `to: 'HEAD'` only |
| reviewer points answered vs outstanding | the round's reviewer records, when the round is `review` |
| figures added or whose `figure.svg` hash changed | `freeze.figureHashes` |
| references added | `references.bib` cited-key sets |
| compliance diagnostics fixed and introduced | the checker at both commits |
| word- and page-count deltas per document | `countWords` + `freeze.measurements` |

Rendered through the `export-notes.ts` pattern (`:18-35`) — own small model,
three formats, own `output/` subdir — because a round report is not a
submission and the manuscript pipeline's knobs would be knobs with no meaning.

**Be honest about what this is.** No artifact in any of the user's examples is
an internal round report (`rnd.internal-report`); nobody produces one by hand,
so there is no shape to imitate. Its justification is that it is entirely
derived and therefore cannot go stale, and that it answers the one question a
co-author receiving round N+1 actually has.

Reading the snapshot rather than git is what makes the report's central section
— ADR-009 names it as the one question the report exists to answer, *what
happened to my comments from round N?* — computable in the two configurations
this plan explicitly supports and an earlier draft would have broken: a project
with **no `.git`** (§3b step 3 skipped; ADR-009 *A round with no git repository
still works*) and a freeze recorded **dirty** (`FreezeSchema.dirty`), where the
committed `comments.json` is not the one the author saw.

**Acceptance criteria**
- Regenerating a report twice with no intervening edits is byte-identical.
- Human prose outside the managed markers survives regeneration verbatim; a
  file with one marker, reversed markers or two `begin` markers is **not
  written** and produces a diagnostic naming the offending line.
- A comment closed between the two freezes appears in the closed list with the
  reply that closed it; a comment whose anchored text was rewritten appears in
  the detached list.
- **The same report is produced between two freezes in a project with no
  `.git`**, and across a freeze recorded `dirty: true` — in both cases from the
  snapshots alone, with git never consulted.
- The report exports to HTML, DOCX and PDF into `output/rounds/<id>/`.

---

## §6 — Review rounds and the response document (ask 3)

### 6a — reviewer points, verbatim and immutable

`rounds/<id>/reviewers/<reviewer>.json`. The reviewer's words are **not in any
file the author edits** — immutability becomes structural.

```ts
export const ReviewPointLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prose'), documentId: z.string(), quoteId: z.string() }),
  z.object({ kind: z.literal('figure'), figureId: z.string() }),
  z.object({ kind: z.literal('table'),  tableId: z.string() }),
  z.object({ kind: z.literal('response-item'), itemId: z.string() }),
  /** Legitimately unanchorable. A NORMAL state, not the error `detached` means. */
  z.object({ kind: z.literal('none'), reason: z.string().min(1) }),
])

export const ReviewPointSchema = z.object({
  id: z.string().min(1),                          // stable opaque, e.g. "r1.main.2"
  /** 'assessment' = the reviewer's unnumbered opening block: takes a reply,
   *  carries NO ordinal, so it cannot throw off numbering. */
  kind: z.enum(['assessment', 'request']),
  verbatim: z.string().min(1),                    // never edited, never reflowed
  ordinalVerbatim: z.string().nullable(),         // "2." / "1- " — evidence, not identity
  assigneeAuthorId: z.string().nullable(),
  status: z.enum(['open','assigned','drafting','answered','declined']),
  declineReason: z.string().nullable().default(null),
  links: z.array(ReviewPointLinkSchema).default([]),   // ZERO, one, or many
})

export const ReviewGroupSchema = z.object({
  id: z.string().min(1),
  /** "Main issues" / "Minor issues/questions" — the reviewer's own words,
   *  preserved verbatim including stray markdown. */
  headingVerbatim: z.string().min(1).nullable(),
  points: z.array(ReviewPointSchema),
})

export const ReviewerReportSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),                          // 'reviewer-1' | 'editor'
  labelVerbatim: z.string().min(1),               // "Reviewer #1 (Comments for the Author):"
  role: z.enum(['reviewer', 'editor']),
  receivedAt: z.iso.date(),
  /** true ⇒ SUNA split it and a human MUST confirm before the round can close. */
  segmentedAutomatically: z.boolean(),
  groups: z.array(ReviewGroupSchema),
})
```

Point identity is `(reviewer, group, ordinal)` behind an opaque `id`, never a
single integer: one real report restarts numbering inside each reviewer **and**
each group, forcing "Reviewer 1, point 2"; the other runs one global counter
that has already skipped RE58 (`rev.example.numbering-drift`).

### 6b — ingestion

`review:import` takes pasted text or an emailed `.docx` and offers two
segmentation routes: **automated** (numbered-list detection with the
`Reviewer #N` header pattern) and **manual**. Automated detection would have
handled one real report's mixed `1.` / `1- ` styles and would have failed
**completely** on the other, which numbers reviewer points not at all. So
`segmentedAutomatically: true` forces human confirmation, and the whole report
is retained verbatim beside the split so re-segmentation is always possible.

An earlier draft offered a third "agent-assisted" route with no verb, no
channel and no acceptance criterion, against a rule three sections away that
reviewer verbatim text must never be agent-writable (`§10`: *no verb can edit a
`verbatim` reviewer point*; ADR-009 decision 5 makes that structural). It is
**specified, not deleted**, because a mixed-format report is exactly where a
model helps:

- The verb is **`propose_review_segmentation` `{roundId, sourceText}`**. It
  writes `rounds/<id>/reviewers/_proposed/<reviewer>.json` — a **proposal
  file**, never `reviewers/*.json` — and returns the proposed split.
- `reviewers/*.json` is written by exactly one code path: the human-confirmation
  step in the Rounds view, which reads a proposal (agent-written or
  automated-detector-written; the schema is identical) and commits it. That path
  sets `segmentedAutomatically: true`.
- The round cannot close while any reviewer record still has
  `segmentedAutomatically: true` — the existing rule, now covering both
  automated routes identically.
- Every point's `verbatim` in a committed record must be a **contiguous
  substring of the retained source text**. That is checkable, it is checked, and
  it is what stops a model paraphrasing a reviewer.

If that verb is not in the 12e milestone, the route is not offered: the enum in
the UI has two members, not a greyed-out third.

### 6c — the response document

`manuscript/reviews/<round>/response.md`, kind `response`, built by a
`buildProseDocumentContent` sibling of `buildSupplementContent`. Reply prose is
Markdown in `::reply{point=<id>}` blocks — which is what makes the editor, the
comments rail, the AI-diff review bar and `edit_manuscript {documentId}` work on
it for free.

Three new SciMark constructs, in the family `![[fig:id]]` already established:

| construct | renders |
|---|---|
| `::reply{point=r1.main.2}` | the reviewer's verbatim text plus the **derived** reply label (`RE:` / `RE12:` / `Reviewer 1, point 2`, per the round's `labelScheme`), in the black/blue/red role styling both real documents use |
| `::quote{id=q7}` | the CURRENT text at that anchor, resolved through `anchor.ts locate()` at format time, citations renumbered into the response's own scheme |
| `::quote-frozen{round=r02, id=q7}` | the text as SUBMITTED, from `rounds/r02/frozen/` — what makes "see previous Results, lines 315-339" honest |
| `@point:r1.main.2` | a cross-reference, joining `@fig:`/`@tbl:`/`@eq:`/`@sec:` |

**Labels are never stored.** That is the direct fix for the measured RE58 gap.
Quotes are never pasted. That kills both measured stale-quote defects: the same
sentence quoted with `(54--56)` in one place and `[8], [9], [10]` in another,
and one Results sentence quoted twice with contradictory wording
(`rev.example.stale-quotes`).

Response-only display items are **ordinary managed figures**, at
`figures/<id>/{figure.json, figure.svg, source/}` with `namespace: 'response'`.
An earlier draft put them at `rounds/<id>/response-items/R1/item.svg`, which
contradicted ADR-009's own placement rule (`rounds/` is the ledger: text only,
nothing hand-edited) and put a hand-drawn SVG outside the only pipeline that
knows what to do with one — no canvas tab, no `figure.json` caption schema, no
provenance overlay, no `check/figure.ts` compliance run.

`FigureNamespaceSchema` is `z.enum(['main','extended-data','box'])`
(`packages/core/src/figure.ts:3`); `'response'` is a union **addition**, so
every `figure.json` on disk still parses. Numbering stays derived per namespace
at format time, so `R1`/`R2` come out of the response's own ordered list and
never enter manuscript numbering. Membership is recorded where round membership
belongs — `reviews/<round>/response.doc.json` gains
`displayItems: [{ figureId, label }]` — so `rounds/` keeps holding only records,
snapshots and received text. A reproduced manuscript figure references the
managed asset and inherits its **derived** number, which removes the drift
measured between the reply's and the revision's media (1 of 8 images
byte-identical, `rev.example.figure-drift`). The response's bibliography is
`references.bib` filtered to the keys the response cites, numbered independently
— the same shape the supplement already proves.

### 6d — the revision profile block

```ts
export const RevisionRulesSchema = z.object({
  requires: z.object({
    pointByPointResponse: z.enum(['required','optional','not-stated']),
    markedUpManuscript: z.enum(['required','recommended','optional','not-stated']),
    cleanManuscript: z.enum(['required','optional','not-stated']),
    coverLetter: z.enum(['required','optional','forbidden','not-stated']),
  }),
  /** THE recorded conflict. Science: colored-text. PLOS/Elsevier/eLife:
   *  tracked-changes. Nature and Cell Press: NOTHING — and null stays null. */
  markup: z.enum(['tracked-changes', 'colored-text']).nullable(),
  /** eLife's "happy for the editors to assess … without involving the
   *  reviewers again" sentence, at the START of the Author Response. */
  requiredResponseBlocks: z.array(z.object({
    id: z.string().min(1), label: z.string().min(1),
    position: z.enum(['start', 'anywhere']),
    quote: z.string().min(1), source: z.url(),
  })).default([]),
  responsePublished: z.boolean().nullable(),
  maxRounds: z.number().int().positive().nullable(),
  deadlineDays: z.number().int().positive().nullable(),
  sources: z.array(z.url()),
  provenance: z.array(ProvenanceEntrySchema).optional(),
})
// PublisherProfileSchema gains:  revision: RevisionRulesSchema.optional()
```

### 6e — pre-flight checks (`check/response.ts`)

`resp.point-unanswered` (the four empty `RE34:`/`RE36:`/`RE64:`/`RE82:` stubs),
`resp.placeholder` (`XXXXXXX`, `Thank for.....`, `$$$`, `TODO`),
`resp.point-unassigned`, `resp.quote-detached` (**blocks round close**),
`resp.required-file-missing` from `profile.revision.requires`,
`resp.required-block-missing` (eLife's opening sentence),
`resp.working-markup-present` (assignment highlights must never reach a
submission export — the finished real reply retains only empty highlight
residue).

`ExportOptions` gains `draftMarkings: z.boolean().default(false)`: a working
export paints assignee highlights, a submission export forces it false.

**Acceptance criteria**
- Importing a two-reviewer report with mixed `1.` and `1- ` numbering produces
  the right point count and `segmentedAutomatically: true`; the round refuses
  to close until a human confirms.
- `propose_review_segmentation` writes only under `reviewers/_proposed/` — a
  test asserts `reviewers/*.json` is unchanged on disk after the call — and the
  round still refuses to close until a human commits the proposal.
- Committing a proposal whose `verbatim` is not a contiguous substring of the
  retained source text is refused.
- Editing `verbatim` is impossible from the UI and from `edit_manuscript` at any
  `documentId` — reviewer records are not a registered document.
- A response display item opens in the canvas tab, is checked by
  `check/figure.ts` against the active profile, and carries `R1` in the
  response while contributing nothing to manuscript figure numbering.
- Inserting a point before an existing one renumbers every rendered label and
  every `@point:` cross-reference, and changes nothing stored.
- A `::quote` whose anchor no longer locates produces `resp.quote-detached` and
  blocks close; the export refuses rather than emitting stale text.
- The response's reference list numbers independently of the manuscript's, and
  a transcluded manuscript quote's citation numbers are renumbered into it.
- A profile with `markup: null` (Nature, Cell) offers both dialects in the
  export dialog, labelled "this journal does not state how changes must be
  marked", and invents no requirement.

---

## §7 — Redline dialects (ask 3, part 2)

`export:docx` gains `markup: z.enum(['none','tracked-changes','color']).default('none')`
and `redlineFrom: z.string().min(1).nullish()` (a round id). The op list comes
from `wordDiff(rounds/<id>/frozen/manuscript.md, current)` — the **freeze**, not
`revisions.json`, because the question is "what changed since we submitted",
not "what did the AI just do".

- `tracked-changes` → `InsertedTextRun` / `DeletedTextRun`, both present in the
  installed `docx@9.7.1` `ParagraphChild` union.
- `color` → red runs, which is what both real `.docx` files actually do (847
  runs at `#EE0000`, zero `w:ins`, zero `w:del` —
  `rev.example.no-track-changes`).

`rev.marking-dialect` warns when the produced dialect disagrees with the
profile's stated one. Where the profile is null the dialog offers both.

**Acceptance criteria**
- A `tracked-changes` export produces a `.docx` whose `word/document.xml`
  contains `w:ins` and `w:del` with recoverable `w:delText`, and which Word
  accepts.
- A `color` export produces the same op list as coloured runs and zero
  `w:ins`/`w:del`.
- Both are byte-stable for an unchanged input.
- A clean export from the same freeze contains neither.

---

## §8 — Sponsor packages: the model and the profile (ask 4, part 1)

Decision and rationale: `adr-010-sponsor-assembly.md`.

### 8a — the package profile, in its own registry

`resources/package-profiles/*.json`, loaded by
`packages/formatter/src/package-profiles.ts`. **Not** `PublisherProfileSchema`:
that is `z.literal(3)` with no version-tolerant loader, and
`packages/formatter/src/profiles.test.ts:62` hard-asserts "exactly the twelve
journal ids, plus the house style".

```ts
export const LimitUnitSchema = z.enum(['pages','lines','sentences','words','characters'])

export const SlotLimitSchema = z.object({
  unit: LimitUnitSchema,
  max: z.number().positive(),
  /** 'hard' = the agency withdraws; 'recommended' = "should not exceed"
   *  (NIH's DMS Plan). Never flatten one into the other. */
  enforcement: z.enum(['hard', 'recommended']),
  quote: z.string().min(1).nullable(),
  source: z.url().nullable(),
})

export const PACKAGE_FACT_IDS = [
  'vertebrateAnimals','humanSubjects','selectAgents','multiplePi','consortium',
  'resubmission','renewal','postdocsOrStudents','clinicalTrial','embryonicStemCells',
  /** Added because the conditional example depends on it: a non-empty
   *  subrecipient list fires the Consortium narrative AND the R&R Subaward
   *  Budget form. It was cited in ADR-010 without existing here. */
  'subrecipients',
] as const

/** A fact is not always a boolean — `nonEmpty` and `gt` need something to
 *  operate on, and `partialRecord(enum, boolean)` gave them nothing. */
export const PackageFactValueSchema = z.union([
  z.boolean(), z.string(), z.number(), z.array(z.string()),
])

/** Five operators. No expression language — every condition stays auditable.
 *  `nonEmpty` is defined only over string / array / number values and is a
 *  profile-validation error against a boolean fact; `gt` only over numbers and
 *  array lengths. The loader checks operator/value compatibility once, at
 *  profile load, so a bad condition fails loudly instead of silently never
 *  firing. */
export const SlotConditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('always') }),
  z.object({ op: z.literal('never') }),
  z.object({ op: z.literal('is'), fact: z.enum(PACKAGE_FACT_IDS),
             value: z.union([z.boolean(), z.string()]) }),
  z.object({ op: z.literal('nonEmpty'), fact: z.enum(PACKAGE_FACT_IDS) }),
  z.object({ op: z.literal('gt'), fact: z.enum(PACKAGE_FACT_IDS), value: z.number() }),
])

export const PackageSlotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),                       // the agency's own name
  /** The agency's ordinal. Empty slots KEEP their number — the real form
   *  does not renumber. */
  ordinal: z.number().int().nonnegative(),
  kind: z.enum([
    'form',        // the agency generates the pages; SUNA does not author it
    'authored',    // free prose SUNA writes, renders and measures
    'per-person',  // one artifact per senior/key person, adjacent, in roster order
    'merge',       // N PROSE documents concatenated, then rendered ONCE — see below
    'external',    // a PDF SUNA staples in but did not author
    'agency',      // TOC, page numbers — the applicant must NOT supply these
  ]),
  required: SlotConditionSchema,
  limit: SlotLimitSchema.nullable(),              // null = the sponsor states none
  requiredHeadings: z.array(RequiredSectionSchema).default([]),
  /** Per-attachment numbering: the Bibliography runs past 60 while
   *  Vertebrate Animals restarts at 1. */
  referenceScope: z.enum(['slot', 'package', 'none']),
  forbids: z.array(z.enum([
    'figures','tables','hyperlinks','citations','headers-footers','page-numbers',
  ])).default([]),
  /** Recorded provenance for seeded content. NO auto-sync, NO drift threshold. */
  seedFrom: z.string().min(1).nullable().default(null),
  /** Slot-level typography delta, in the SPONSOR vocabulary. NOT
   *  DocumentStyleSchema: its page.marginMm is a scalar
   *  (packages/core/src/profile.ts:244) and cannot express the per-side rule
   *  PackageFormattingSchema states five lines below. See §8c. */
  formatOverride: PackageFormattingSchema.partial().optional(),
  /** A superseded format is its own rule class, not a length violation. */
  effectiveFrom: z.iso.date().nullable(),
  effectiveUntil: z.iso.date().nullable(),
  notes: z.array(z.string()).default([]),
  sources: z.array(z.url()).default([]),
})

export const PackageFormattingSchema = z.object({
  pageWidthMm: z.number().positive(), pageHeightMm: z.number().positive(),
  /** PER-SIDE. ResolvedDocumentStyle's single scalar cannot express an
   *  asymmetric sponsor rule; NIH's 0.5in and NSF's 1in fit a scalar by luck. */
  marginMm: z.object({ top: z.number(), right: z.number(),
                       bottom: z.number(), left: z.number() }),
  minBodyPt: z.number().positive().nullable(),
  fontFamilies: z.array(z.object({ name: z.string().min(1), minPt: z.number().positive() })),
  maxCharsPerInch: z.number().positive().nullable(),
  maxLinesPerInch: z.number().positive().nullable(),
  /** Both agencies paginate; the applicant must NOT. */
  applicantMayPaginate: z.literal(false),
  applicantMayUseHeadersFooters: z.literal(false),
  urlsAllowed: z.enum(['never', 'where-stated', 'allowed']),
  filename: z.object({
    maxChars: z.number().int().positive().nullable(),
    allowedPattern: z.string().nullable(),
  }),
  fileTypes: z.array(z.string().min(1)),
  sources: z.array(z.url()),
})

export const PackageProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),                          // 'nih-r01' | 'nsf-pappg-24-1'
  kind: z.literal('sponsor'),
  sponsor: z.string().min(1),                     // "National Institutes of Health"
  program: z.string().min(1),                     // "SF424 (R&R) + PHS 398 — R01"
  opportunity: z.object({ id: z.string().min(1), url: z.url() }).nullable(),
  effectiveFrom: z.iso.date(),
  effectiveUntil: z.iso.date().nullable(),
  lastVerified: z.iso.date(),
  format: PackageFormattingSchema,
  slots: z.array(PackageSlotSchema).min(1),
  citations: CitationRulesSchema,
  notes: z.array(z.string()).default([]),
  provenance: z.array(ProvenanceEntrySchema).optional(),
})
```

The `nih-r01.json` slot list is transcribed directly from
`document-kinds-findings.json` → `sponsor-package-nih` → `slots[]`, which is
itself the real submission's own form page (`nih.example.slot-list`). No
`extends` in v1: the journal loader replaces arrays wholesale
(`packages/formatter/src/extends.test.ts:49-64`), a twenty-slot package cannot
restate its whole `slots` array to change one limit, and two merge semantics in
one codebase is a real hazard.

`nsf-pappg-24-1.json`'s `notes[]` states, in the file, that the two live
supplements (NSF 26-200 and NSF 26-202) have **not** been checked against
Chapter II — `https://www.nsf.gov/policies/document/nsf26202` returns HTTP 404,
which reproduces today — so the profile cannot imply the base document is
current. ADR-010 open decision 2 carries the reasoning; the Compliance panel
prints the note rather than showing a clean green, exactly as it does for the
un-encoded NOFO Section IV on the NIH side.

**What `kind: 'merge'` means, precisely.** ADR-010 decides SUNA never merges
PDFs and defers `pdf-lib` by name; `merge` is the different, cheaper operation
and the two are easy to confuse, so:

- It concatenates **prose documents only** — `source.kind: 'merge'` carries
  `documentIds`, never an `external-pdf` member. A slot mixing the two fails
  validation, because that would be the PDF merge ADR-010 refuses.
- Members are concatenated **in declared order, before rendering**, with an H1
  per member from its `ComponentDocument.title`, then rendered **once**. This is
  the real submission's "Letters of Support → `ALL COMBINED.pdf`" slot
  (`nih.example.cardinality`).
- The limit is measured on **the single rendered file**, once — one page count,
  not a sum of per-member counts, which is the whole point of measuring after
  layout.
- `referenceScope` applies to the merged whole: `'slot'` gives the concatenated
  document one cited-key set and one `assignNumbers` run (so a citation used by
  two members gets one number); `'package'` and `'none'` behave as elsewhere.
  There is never a per-member bibliography inside a merged slot.
- `seedFrom`, `requiredHeadings` and `forbids` are evaluated against the merged
  text, for the same reason.

### 8b — the package instance

```ts
export const PackageDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('package'),
  packageProfileId: z.string().min(1),
  dueAt: z.iso.date().nullable(),                 // checked against effectiveFrom/Until
  /** Not boolean-only: `subrecipients` is a string[] of organisation names,
   *  and `nonEmpty`/`gt` need a value with extent. An absent fact is UNKNOWN,
   *  not false — a conditional slot over an absent fact reports
   *  `pkg.fact-unanswered` rather than quietly not firing. */
  facts: z.partialRecord(z.enum(PACKAGE_FACT_IDS), PackageFactValueSchema),
  /** Values that must AGREE across every component: activity code, NOFO
   *  number, project title. The real submission disagreed with itself on all
   *  three. */
  declaredTerms: z.record(z.string().min(1), z.string().min(1)),
  people: z.array(z.object({
    id: z.string().min(1), authorId: z.string().min(1).nullable(),
    role: z.enum(['pd-pi','senior-key','co-investigator','other-significant-contributor']),
    name: z.string().min(1), organization: z.string().min(1).nullable(),
  })).default([]),
  bindings: z.array(z.object({
    slotId: z.string().min(1),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('document'), documentId: z.string().min(1) }),
      z.object({ kind: z.literal('merge'), documentIds: z.array(z.string()).min(1) }),
      z.object({ kind: z.literal('external-pdf'), path: z.string().min(1),
                 sha256: z.string().length(64), provider: z.string().nullable() }),
      z.object({ kind: z.literal('per-person'),
                 pdfByPersonId: z.record(z.string(), z.string()) }),
      z.object({ kind: z.literal('form') }),
    ]),
    /** null ⇒ the exporter derives a rule-compliant filename (it owns this). */
    filename: z.string().nullable().default(null),
    notApplicable: z.string().min(1).nullable().default(null),   // explicit, with a reason
  })).default([]),
})

export const ComponentDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('component'),
  packageDocumentId: z.string().min(1),
  slotId: z.string().min(1),
  title: z.string().min(1),
  personId: z.string().min(1).nullable(),
  /** Own bibliography when the slot's referenceScope is 'slot'. */
  bibliography: z.string().regex(/\.bib$/).nullable(),
  derivedFrom: z.string().min(1).nullable().default(null),   // recorded, never synced
})
```

### 8c — how sponsor typography reaches the writers

Named explicitly, because the seam ADR-010 originally pointed at cannot carry
this: `resolveDocumentStyle`'s signature is
`resolveDocumentStyle(profile: PublisherProfile)` (`export-style.ts:165`) and a
package has no `PublisherProfile`; `ResolvedDocumentStyle.page.marginMm` is a
scalar (`export-style.ts:23`), and `export-pdf.ts:173-175` collapses even that to
one `marginIn` and **zeroes left/right** on the themed path. "A second
`override?` parameter" would have been a `DocumentStyle` — the wrong type.

```ts
// apps/desktop/src/main/services/export-style.ts
export function resolvedStyleForSlot(
  profile: PackageProfile, slot: PackageSlot,
): ResolvedDocumentStyle
```

Sponsor geometry never travels as a `DocumentStyle`; the two registries share
the resolved *output* type and nothing else. Alongside it,
`ResolvedDocumentStyle.page.marginMm` widens from `number` to
`{ top, right, bottom, left }` — NIH's uniform 0.5 in and NSF's uniform 1 in fit
a scalar by luck, and `PackageFormattingSchema.marginMm` is already per-side.
The call sites are enumerable: `export-pdf.ts:144` and `:173-175`;
`export-html.ts:442,449`; `export-docx.ts:649-650, 1238-1241, 1432-1435`;
`SUNA_DEFAULT_STYLE` at `export-style.ts:127`; and
`export-style.test.ts:34,89-97`.

**Acceptance criteria**
- `facts.vertebrateAnimals = true` makes the Vertebrate Animals slot required;
  `false` makes it not-required and neither state renumbers any slot; **absent**
  produces `pkg.fact-unanswered` rather than silently not firing.
- A non-empty `subrecipients: string[]` fires the Consortium narrative **and**
  the R&R Subaward Budget form slot — one fact, two components. (It does **not**
  add a performance site: that was an inference, not a rule. `nih.example.cardinality`
  counts "2 performance sites; 1 subrecipient" and states no relation between
  them.)
- A `nonEmpty` condition over a boolean-valued fact fails **profile load**, not
  silently at evaluation time.
- `resolvedStyleForSlot(nihR01, researchStrategySlot)` yields 0.5 in on all four
  sides and 11 pt body; `resolvedStyleForSlot(nsf241, projectDescriptionSlot)`
  yields 1 in and 10 pt Arial — from the same component prose, and the rendered
  PDF's page box matches on all four sides.
- A `merge` slot with two prose members renders **one** file with one page count
  and one reference list; adding an `external-pdf` member to it fails validation.
- A slot bound `notApplicable` without a reason fails schema validation.

---

## §9 — Rendered measurement and assembly export (ask 4, part 2)

**No new dependency.** `pdfjs-dist@^6.2.108` is in
`apps/desktop/package.json:43` and its legacy Node build is already dynamically
imported in the main process, already reading `doc.numPages`
(`document-import.ts:155,161`).

### 9a — split the printer

```ts
// apps/desktop/src/main/services/export-pdf.ts
export async function renderPdfBytes(
  html: string, style: ResolvedDocumentStyle, opts: PdfPrintOptions,
): Promise<{ pdf: Uint8Array; measured: RenderMeasurement }>

// apps/desktop/src/main/services/pdf-measure.ts   (new, ~40 lines)
export interface RenderMeasurement {
  pages: number                 // from pdfjs over the BYTES, before they hit disk
  lines: number                 // rendered line boxes in #ms-body
  minBodyPt: number             // smallest computed body font size
  missingFonts: string[]        // non-empty ⇒ `pages` is NOT trustworthy
  resolvedFonts: string[]
}
export async function pdfPageCount(bytes: Uint8Array): Promise<number>
```

`exportPdf` becomes `renderPdfBytes` + `writeFileAtomic(target, pdf)` at
`export-pdf.ts:181`, and its response gains `pages`.

Line counting and font resolution ride the **same** pre-print
`executeJavaScript` pass that `LINE_NUMBER_SCRIPT` (`export-pdf.ts:52-92`)
already uses: `await document.fonts.ready`, `document.fonts.check()` per
declared family, smallest computed `font-size` over body text nodes, and
distinct rounded `rect.top` values from `Range.getClientRects()` over every
`p`/`li`.

**When `missingFonts` is non-empty, SUNA reports "page count unreliable —
`<family>` was substituted" INSTEAD OF a number.** A wrong page count on a
grant application is worse than no page count.

The package printer follows `export-pdf.ts:172` (**inches**), never
`figure-export.ts:84` (microns, inert only because it also sets
`preferCSSPageSize: true`) — a latent unit hazard worth fixing while in the
area.

### 9b — `export:package`

One hidden `BrowserWindow` reused across components (`loadFile` per component,
not a window each). Figures are rasterized **once** in the renderer before the
loop — `rasterizeManuscriptFigures` (`rasterizeFigures.ts:120`) — because
`figure-export.ts:119-122` throws for PNG in main by design.

Response shape, the first export result in the codebase that is not a single
`{ path }`:

```ts
{ dir: string
  components: { slotId: string; file: string; pages: number | null
                limit: SlotLimit | null; over: boolean }[]
  diagnostics: Diagnostic[] }
```

Filenames are **generated** by the exporter, so NIH's 50-character and
character-set rules are a guarantee for what SUNA authors and a *check* for
stapled external PDFs. Naked attachments: no header, no footer, no page number,
no TOC.

### 9c — the checks (`check/component.ts`, `check/package.ts`)

Pre-render, live: `pkg.font-min`, `pkg.font-not-allowed`, `pkg.margin-min`,
`pkg.line-density`, `pkg.char-density`, `pkg.word-limit`, `pkg.char-limit`,
`pkg.sentence-limit` (heuristic, and the message says so),
`pkg.url-forbidden`, `pkg.heading-missing`, `pkg.slot-missing`,
`pkg.forbidden-content`, `pkg.filename` (external only),
`pkg.fact-unanswered` (a conditional slot whose gating fact is absent — unknown
is not false), `pkg.schema-superseded` (`dueAt` outside a slot's effective
window),
`pkg.term-inconsistent` (`declaredTerms` scanned across every component — the
same engine as `letter.journal-name-mismatch`).

Post-render, on the measured bytes: `pkg.page-limit`, `pkg.line-limit`,
`pkg.font-substituted`, `pkg.page-unmeasured`, `pkg.pdf-security` (as far as
pdf.js reports it; where it does not expose a fact the message says **"not
verified"**, never "passes").

All carry `surface: 'export'` or `'package'` and flow into the same diagnostics
list the export dialog already renders (`ExportDialog.tsx:465-480`).

**Acceptance criteria**
- A one-page fixture component reports `pages: 1`; padding it past a page
  reports 2 and produces `pkg.page-limit` with the measured value, the limit,
  the sponsor's quote and its URL.
- The reported count equals `pdfinfo`/`pdftk` on the written file, byte for
  byte the same artifact.
- A component requesting a font absent from the machine reports
  `missingFonts` non-empty, produces `pkg.font-substituted`, and reports **no**
  page number.
- A 31-line Project Summary fails `pkg.line-limit`; 30 passes.
- A DOCX target reports `pages: null` and `pkg.page-unmeasured`, never a guess.
- `export:package` for a ten-slot package writes ten files, none containing a
  page number, header or footer, all with generated compliant filenames.
- A `dueAt` of 2026-06-05 against a slot with
  `effectiveUntil: '2026-05-24'` produces `pkg.schema-superseded` — the real
  submission's DMS-format defect.

---

## §10 — MCP verbs

**One family, widened — not a second family beside the first.** An earlier draft
added `read_document`, `write_document`, `edit_document`, `read_document_meta`
and `check_document` alongside the five verbs that already do exactly those jobs
(`read_manuscript`, `write_manuscript`, `edit_manuscript`,
`read_manuscript_meta`, `check_manuscript` — `verbs.ts:475-513`), kept both
live, and cited `read_section`/`write_section` as the precedent. That citation
is backwards: both of those descriptions literally begin **"DEPRECATED alias
for …"** (`verbs.ts:489-497`), which is the opposite posture from two coequal
surfaces. Keeping both would take a 24-verb registry to 38 with five ambiguous
pairs, two compare-and-swap implementations, and no answer to "which one should
a model call for the manuscript?".

So the five existing verbs each gain an **optional `documentId`** on their zod
input schema, defaulting to the primary document. An optional field breaks no
caller, every existing call keeps its exact behaviour, and there is exactly one
implementation of the compare-and-swap. The names keep saying "manuscript"
because renaming them would be the churn this avoids; `MCP.md` says in one line
that `*_manuscript` takes any registered document and that `documentId:
'manuscript'` is the default.

| verb | inputs | purpose |
|---|---|---|
| `read_manuscript` | `{documentId?}` | **widened.** the prose of any document |
| `write_manuscript` | `{documentId?, content}` | **widened.** whole-file, one compare-and-swap |
| `edit_manuscript` | `{documentId?, find, replace}` | **widened.** the anchored-edit primitive |
| `read_manuscript_meta` | `{documentId?}` | **widened.** the kind's metadata sidecar |
| `check_manuscript` | `{documentId?}` | **widened.** diagnostics for one document or all |
| `list_documents` | `{}` | **new.** id, kind, title, file, profile, roundId for every registered document |
| `propose_review_segmentation` | `{roundId, sourceText}` | **new.** writes `reviewers/_proposed/` only; never `reviewers/*.json` (§6b) |
| `list_rounds` | `{}` | id, purpose, state, decision, deliverable satisfaction |
| `read_round` | `{roundId}` | the round record plus its reviewer labels |
| `list_review_points` | `{roundId, status?, assignee?}` | verbatim points with status and links |
| `answer_review_point` | `{roundId, pointId, reply}` | write reply prose into `response.md`'s block |
| `link_review_point` | `{roundId, pointId, link}` | attach a prose anchor / figure / table / `none` with a reason |
| `set_letter_assertion` | `{documentId, assertionId, placement, text?, reason?}` | record an assertion; never invents prose |
| `list_package_slots` | `{documentId}` | slot, required?, bound?, limit, last measurement (with staleness) |
| `check_package` | `{documentId}` | package diagnostics; page/line values only where a fresh measurement exists |

No verb can edit a `verbatim` reviewer point — `answer_review_point` writes only
the reply, and `propose_review_segmentation` writes only a proposal file that a
human must commit (§6b). `check_package` reports `"not measured"` rather than a
stale number.

Registry arithmetic, so the doc gate is not a surprise: **24 today + 10 new
names = 34**, with zero ambiguous pairs. The ten are `list_documents`,
`propose_review_segmentation`, `list_rounds`, `read_round`,
`list_review_points`, `answer_review_point`, `link_review_point`,
`set_letter_assertion`, `list_package_slots` and `check_package`. The five
widened verbs add inputs, not names — which is the whole point.

**The mandatory non-code work per verb**, or `pnpm test` fails
(`packages/agent/src/context/context.test.ts`): a row in
`resources/suna-context/MCP.md`'s table listing every accepted input with its
`?` marker; the `## The N verbs` heading bumped (the gate asserts the literal
`${TOOLS.length} verbs` string, currently `## The 24 verbs` at `MCP.md:49`);
`node scripts/gen-suna-context.mjs` re-run so `docs.gen.ts` and its hash
regenerate; teaching in `WORKFLOW.md` and the relevant area doc. And two
**ungated** stale counts fixed by hand: `resources/suna-context/README.md:73`
and `website/ai/mcp.md:60` both say 23 against a registry of 24 — worth
extending the gate to scan every context file for `\d+ verbs` while in there.

---

## §11 — UI surfaces

**The interaction design lives in `docs/design/document-kinds-ux.md`** — the
new-document button and sheet, the AI-draft rules, the reviewer-import screen,
the point-by-point response workspace, and the cross-cutting UX rules. That
document also carries the UX acceptance criteria, which are additions to the
milestones below, not replacements.

What follows is only the file-level wiring those surfaces need.

| surface | change |
|---|---|
| **Sidebar** | The `manuscript` view becomes **Documents**: the registry at the top, the selected document's outline below. `SIDEBAR_VIEWS` (`state/ui.ts:5`) keeps its length, so the four exhaustive `Record<SidebarView, …>` tables are untouched. |
| **Dock** | `openManuscriptTab(rootDir)` (`state/dock.ts:164-178`) becomes `openDocumentTab(rootDir, documentId)` with panel id `document:<rootDir>:<docId>`; `openManuscriptTab` stays a thin alias resolving `'manuscript'`, so the three unconditional callers (`state/project.ts:89,133,146`) and `state/ui.ts:205-208` do not change. Two hard-coded `contentComponent === 'manuscript'` checks widen to a component set: `syncOpenTabs` (`dock.ts:18-30`, explorer open/active marks) and `closeProjectTabs` (`:204-207`, which is what stops a rootDir-keyed tab surviving a project switch showing the previous project's content). |
| **Letter tab** | `ManuscriptTab`'s shape minus the title page: toolbar, editor, comments rail, plus an **Assertions** panel listing the profile's requirements with stance, the venue's quote and its source link. |
| **Rounds view** | A new sidebar view: rounds newest-first with state and decision; a round detail showing the freeze (tag, commit, dirty flag, options), the deliverables checklist with satisfied/missing, returns and their triage state, and reviewer points grouped by reviewer with status and assignee. |
| **Triage** | A per-item queue over one return: accept / retarget / dismiss-with-reason, with the **rendered** quote (what the co-author saw) and the mapped-forward source context side by side. `confidence: 'low'` items and derived-span items (`frozenAnchor: null`, offered a figure/reference retarget) are visibly separated. |
| **Package tab** | The slot table — ordinal, label, required?, bound to what, limit, last measured value with a **staleness** marker — plus a "Check package" action that runs the render loop with per-component progress. |
| **Export dialog** | The document `<select>` is driven by the registry instead of the two-value `ExportTarget` union (`ExportDialog.tsx:17`); `markup` and `redlineFrom` appear for a revision round; the page-limit diagnostics land in the existing list, which already says "nothing here blocks it". |
| **Command palette** | New commands through `registerCommand` (`state/commands.ts:37`) — `document.open`, `letter.new`, `round.new`, `round.freeze`, `round.import-return`, `review.import`, `package.check`. No palette edits. |
| **Help** | `sectionForSurface` (`shell/help/sections.ts:245-261`) gains cases for the new dock components, or they fall through to `'global'`. |

---

## §12 — Migration

**Existing projects: nothing moves and nothing is written on open.**

`documents` is optional on `SunaProjectManifestSchema`; `schemaVersion` stays
`1`. `resolveDocuments` synthesizes a one-manuscript registry when the field is
absent, so **every `suna.json` on disk today is already a valid registry
project** pointing at the exact files it already has. The field is written once,
atomically, on the action that creates a second document.

`manuscript.json`, `authors.json`, `references.bib`, `comments.json` and
`revisions.json` keep their current schemas byte for byte. The two widenings
(`CommentAuthorSchema.kind`, `RevisionAuthorSchema.kind`) are union
**additions**, so every file still parses.

**Prerequisites, in this order, before any new kind ships:**

1. **Key `state/manuscriptDoc.ts`** by `documentId` (Gap 4) — a `Map`, four
   consumers.
2. **Give `state/comments.ts`'s `draft`/`activeId`/`revealRequest` a
   `docPath`** (Gap 4).
3. **Key the unresolved-comment badge by document.**
   `RailToggleButton.tsx:13-15` is
   `(s) => s.comments.filter((c) => !c.resolved).length` — no path filter — and
   it is rendered by both `ManuscriptTab` and `EditorTab`. Under ADR-009
   decision 2 every new kind writes into the one project-wide `comments.json`,
   so the manuscript tab's badge would count the cover letter's and the
   package's open comments. That is the exact failure ADR-008 was written to
   prevent, and the one ADR-009 cites when it rejects reviewer-points-as-comments
   — reproduced through a different door. The fix is the `commentsByPath` map
   `EditorTab.tsx:11,124` already builds.
4. **Scope `migrateCommentTargets`** (Gap 5) to the primary document, gated on
   the old `sections/` tree actually existing, with a regression test whose
   fixture contains a `letters/…` comment. Cheap insurance, **not** a live data
   loss: see Gap 5.
5. **Land the in-flight onboarding refactor** already in the working tree
   (Step2Profile deleted, Step3–7 renamed Step2–6, `LAST_STEP = 6`). A new
   wizard step now conflicts on every renumbered line of `gating.ts`'s numeric
   switch — and no new step is needed anyway: a document kind is a new entry in
   `SCAFFOLD_OPTIONS` (`steps/Step2Scaffold.tsx:8-29`) plus a widened `z.enum`
   on `project:scaffold` (`packages/core/src/ipc.ts:343`).
6. **Establish the smoke baseline.** `scripts/e2e/smoke.mjs:4786` asserts
   `probe.tools.length === 19` against a `TOOLS` array with **24** entries — it
   is broken on `main` today.

**IPC, widened compatibly.** `manuscript:update`, `comments:read|write`,
`revisions:read|write` and `export:docx|html|pdf` each gain an **optional**
`documentId`, defaulting to the primary — every existing renderer call compiles
and behaves identically. `target: z.enum(['manuscript','supplement'])`
(`ipc.ts:1559,1583,1601`) keeps working through a shim: `'supplement'` resolves
the declared supplement document, or synthesizes one when `supplementary.md`
exists. `project:open` keeps `manuscriptPresent` (`ipc.ts:244`) and gains
`documents[]` beside it. New channels: `documents:read|write`,
`rounds:list|read|open|freeze|close`, `returns:import|read|triage`,
`review:import|read|write`, `report:build`, `package:read|write`,
`export:package`, `git:tag|tags|show-file`, `identities:read|write`.

**`examples/hello-suna`** — also the e2e fixture, copied by
`ensureExampleProjectCopy` (`apps/desktop/src/main/ipc.ts:193`) — gains:

- an explicit `documents[]` **describing what is already there**:
  `{id:'manuscript', kind:'manuscript', file:null, meta:'manuscript.json'}` plus
  `{id:'supplement', kind:'supplement', file:'supplementary.md',
  meta:'supplementary.doc.json'}` — both matching `DOCUMENT_KIND_FILES` for
  their kind, which the §1 unit suite asserts, and which finally gives
  `supplementary.md` a schema entry after living as a bare filename constant in
  `export-content.ts:734` and a duplicate in `ExportDialog.tsx:22`;
- one genuinely new document: `manuscript/letters/cover-nature.md` + `.json`,
  a real submission letter targeting `nature-astronomy`, so a second kind is
  exercised end to end (open the tab, edit prose, add a comment, run the letter
  checker, export);
- one closed internal round in `rounds/` with a freeze, a snapshot, one triaged
  return and a generated report; and one open review round with two short
  reviewer records, one answered point carrying a live `::quote`, and one open
  point.

The absent-registry path stays covered because
`apps/desktop/src/main/services/export-fixture.ts` keeps writing **no**
`documents.json` — one fixture per branch, both exercised. A separate
**`examples/demo-grant`** ships three components only (Specific Aims, Project
Summary, Project Narrative) against `nih-r01`, because those three exercise all
four measuring instruments and render in about a second, where a full R01 would
swamp the demo.

`apps/desktop/src/renderer/src/onboarding/preview.ts:20-30` hard-lists the
project tree and is documented as mirroring `writeManuscriptDir`'s write order,
so it moves in the same change as any wizard-scaffolded second document. In v1
the wizard scaffolds none.

---

## Milestones

| # | scope | size | gate |
| --- | --- | --- | --- |
| **12-pre** | Gaps 4, 5 and 5b — key `manuscriptDoc`, scope the comment draft, **key the comment badge by document**, scope `migrateCommentTargets`. Land the onboarding refactor. Fix the smoke tool count. | S | two document tabs do not share an outline; **a manuscript tab shows no badge for a cover letter's open comments**; a `letters/x.md` comment survives a project open |
| **12a** | §1 registry: `documents.ts`, four tables, `paths.ts` helpers (incl. `roundsDir`), `DiagnosticSurface` widening, optional `documentId` on five IPC channels and on the five widened MCP verbs | M | a registry-less project is byte-identical; an eighth kind produces four compiler errors; every demo `documents[]` entry matches `DOCUMENT_KIND_FILES` |
| **12b** | §2 cover letters: schemas, identities, `profile.letters` on ≥6 journals, `check/letter.ts`, the letter tab | L | the Science/Science Advances defect is caught as an error, **and no shipped assertion quote is still `basis: 'documented-indexed'`** — the Science and Cell Press pages must be re-read in a browser first (ADR-009 open decision 6) |
| **12c** | §3 rounds: schemas, `git:tag`, `rounds:freeze` (incl. the sidecar and rendered-text snapshot), the bundle manifest, the Rounds view | M | tag + snapshot agree byte for byte; a dirty freeze is recorded; `frozen/comments.json` and `frozen/rendered/*.map.json` are written |
| **12d** | §4 returns: `docx-return.ts`, rendered→source→HEAD anchor compose, the floor, triage | L | a comment on a rendered citation number or figure label never becomes a prose anchor; a 1-character anchor never lands silently; nothing in the file is dropped |
| **12e** | §6 review rounds: reviewer records, ingestion (automated + `propose_review_segmentation`), response display items under `figures/` with `namespace: 'response'`, `::reply`/`::quote`/`@point:`, `profile.revision`, `check/response.ts` | L | inserting a point renumbers every label; a detached quote blocks close; an agent proposal never lands in `reviewers/*.json` |
| **12f** | §7 redline dialects | S | both dialects from one op list; Word accepts the tracked one |
| **12g** | §5 the derived report | M | regeneration is byte-identical, preserves human prose, fails loudly on an unpaired marker, and works in a project with no `.git` |
| **12h** | §8 package model + `nih-r01.json` + `nsf-pappg-24-1.json` + `resolvedStyleForSlot` and the per-side `marginMm` widening | L | conditional slots fire from facts (incl. `subrecipients`); empty slots keep ordinals; the NSF profile's `notes[]` names both unchecked supplements |
| **12i** | §9 `renderPdfBytes` + `pdf-measure.ts` + `export:package` + the checks | L | the reported count equals an external tool's on the same file |
| **12j** | §10 MCP verbs + doc gates | M | `pnpm test` green with the regenerated context; `MCP.md` reads `## The 34 verbs` and no two verbs do the same job |

12-pre through 12b is the smallest independently valuable slice: it delivers
ask 1 whole and fixes two live data-loss paths on the way. 12h–12i (ADR-010)
depend only on 12a and can run in parallel with 12c–12g.

---

## Test and verification gates

**Every milestone:** `pnpm typecheck` and `pnpm test` green workspace-wide, and
`pnpm --filter @suna/desktop build`.

**Unit, per section:**

- §1 — `resolveDocuments` on a registry-less manifest returns paths byte-equal
  to `manuscriptJsonPath`/`commentsJsonPath`/`revisionsJsonPath` today, with and
  without a renamed `directories.manuscript`.
- §2 — a table-driven suite over the shipped `letters` blocks: each stance
  produces the expected diagnostic id and severity, and each message ends with
  the journal's URL through `sourceSuffix`. Plus the four defect fixtures drawn
  from the user's own letter.
- §4 — a fixture `.docx` built with the installed `docx` library carrying 12
  comments (one range-less), 5 tracked changes, mixed highlights and an
  inconsistent `commentsIds.xml`, asserted down to `ReturnedComment` counts and
  `uninterpreted[]`. Plus the rendered→source map on its own: a round-trip over
  a fixture containing a citation cluster, a figure cross-reference and plain
  prose, asserting the segment list is monotone in both coordinates, that
  derived spans carry `sourceStart: null`, and that mapping a rendered offset in
  plain prose lands on the byte-identical source offset.
- §6 — label derivation over both real numbering conventions, including
  inserting a point mid-list; `::quote` renumbering into the response's own
  scheme.
- §7 — `word/document.xml` asserted for `w:ins`/`w:del`/`w:delText` in the
  tracked dialect and for zero of them in the colour dialect.
- §9 — `pdfPageCount` over a fixture PDF of known length; `renderPdfBytes`
  measurement against a fixture whose rendered length is asserted three ways.

**Node-driven fixture round-trips** — the same posture feature-plan-6 and
feature-plan-7 used, and the one that actually applies here, because
`pnpm smoke`'s driver is stale for the flat layout (`roadmap.md` §Outstanding
item 0: it still clicks the removed `.ms__open` button and still reads and
writes `manuscript/sections/*.md`, so it would fail if run):

1. **Registry equivalence** — export `examples/hello-suna` before and after
   12a; the DOCX, HTML and PDF must be byte-identical.
2. **Letter round-trip** — scaffold a letter into a copy of the demo, run the
   checker against six shipped profiles, assert the diagnostic sets, export and
   re-read the DOCX for the letterhead and the absence of any markup.
3. **Freeze/thaw** — freeze, edit, then assert `git show <tag>:…` and
   `rounds/<id>/frozen/…` still agree and that `wordDiff` between them equals
   the edit.
4. **Return round-trip** — export a round deliverable from a freeze, mark the
   **exported** `.docx` up (comments on plain prose, on a rendered citation
   number and on a rendered figure label), ingest it, and assert the
   `ReturnedComment`/`ReturnedEdit` sets, the `frozenAnchor: null` results for
   the two derived anchors, the low-confidence quarantine and the
   `uninterpreted[]` survival. Marking up the *exported* file rather than a
   hand-built one is the point: it is the only way the rendered/source mismatch
   is exercised at all.
5. **Response render** — build a two-reviewer round, answer three points,
   render, and assert the derived labels, the renumbered transcluded quote and
   the independently numbered reference list.
6. **Package measurement** — render `examples/demo-grant` and assert per-slot
   page counts against an external tool over the same files, plus one
   deliberately-over component producing `pkg.page-limit`.

**Where automation cannot reach, and it is stated rather than implied:**
`printToPDF` needs a running Electron process, which is exactly the gap
`roadmap.md` records for feature-plan-6 ("the exported `.pdf` has never been
produced under automation"). §9's gates therefore run under
`node scripts/e2e/drive.mjs --boot --example` plus a probe, in a **hidden**
window, never a visible one (CLAUDE.md). A probe
`scripts/e2e/probes/package-measure.mjs` drives the render loop and asserts the
counts; until it runs, §9 is *unverified in the real app* and must be recorded
that way in `roadmap.md`.

**Smoke steps to add once the driver is brought up to the flat layout**
(roadmap item 0, a prerequisite not owned by this plan): open a second document
tab and assert the two outlines are independent; create a letter and assert the
Assertions panel lists the target profile's required set; freeze a round and
assert the tag appears in `GitTimeline`.

---

## Honest risks

- **Figure floats are the credibility risk for the page check.** SUNA renders
  figures inline at full width; the real Research Strategy wraps text around
  them (`nih.example.float-layout`), so a 12-page-compliant component can
  report 13. `documentStyle.figureFloat` must ship in the same release as the
  page check, or the number is systematically pessimistic and nobody will trust
  it.
- **Font substitution silently changes pagination.** Mitigated by refusing to
  report a number when `missingFonts` is non-empty — but that means the feature
  is unavailable on a machine lacking Arial or Palatino Linotype, and the UI
  must say why.
- **`Diagnostic` has nowhere to put doubt.** A diagnostic today is a
  hand-formatted string plus the first source URL when it is ≤64 characters
  (`check/util.ts:8-13`); the profile's rich `provenance[]` never reaches the
  user. When SUNA says "13 pages, over the 12-page limit" and the author's Word
  file says 12, they need to see what was measured, what the rule is, and how
  confident SUNA is that the rule applies. Widening `Diagnostic` with a
  structured `{measured, limit, unit, basis}` is worth doing **before** this
  ships, not after.
- **NOFO overrides mean a static NIH profile is wrong more often than it is
  right** (`nih.nofo-supersedes`). Until an overlay layer exists the Compliance
  panel must name which document it believed.
- **Reviewer-report segmentation is a wrong-answer machine on unnumbered
  reports.** The human-confirms step is the correctness mechanism, not UX
  polish; any temptation to auto-commit a parse should be resisted, because
  `verbatim` is immutable afterwards.
- **A twenty-component package export is a 10–30 s multi-artifact job** with
  per-component progress and partial failure. Nothing in the current export UI
  is built for that.
- **Confidential data lands in a git-tracked project for the first time.** The
  `.gitignore` stanza is a mitigation, not a solution; a user who commits `-A`
  or publishes through `github.ts` can still leak an excluded-reviewer list.
- **Two shipped docs and one smoke assertion are already stale** against the
  24-verb registry. Fix the baseline first or every new verb looks like the
  thing that broke it.
- **28 shipped-quote candidates are `documented-indexed`.** Every Science and
  Cell Press rule was captured from a search index, because both hosts 403 to
  direct fetch. Two **error**-severity letter checks rest on them. 12b is gated
  on somebody re-reading those pages in a browser; if that does not happen, the
  honest fallback is `quote: null` with the URL cited and the assertion demoted
  from `error` to `warning`, not shipping a sentence SUNA has not read.
- **The rendered→source map is the newest mechanism in the plan and has no
  precedent to copy.** It is small (a segment list emitted by a walk that
  already happens), but if it is wrong the failure mode is quiet: returns land
  on plausible-looking wrong spans. The monotonicity and derived-span assertions
  in the §4 unit suite are the only thing standing between it and that failure.

## Open decisions

Carried from ADR-009 and ADR-010; they need the user.

1. Do returned `.docx` binaries belong in git (auditable, 7 MB per return) or
   gitignored (unreproducible ingestion)?
2. Which identifier is canonical for a co-author across Word's AD SID, git's
   name+email and `authors.json`?
3. Ship the appeal letter kind in v1, given SUNA cannot verify eligibility?
4. Does the version-label format follow the user's own convention (three
   incompatible date formats appear across their real filenames) or SUNA's?
5. Retention policy for `output/rounds/`.
6. NOFO overlay profiles — worth building, or is naming the gap enough for v1?
7. Does the user want a merged preview PDF (costs a new `pdf-lib` dependency,
   and must be labelled non-authoritative for limits)?
8. Ship `pkg.sentence-limit` at all, given sentence segmentation on prose
   containing `Fig. 2`, `e.g.` and `0.5 s^-1` is a heuristic?
9. Who re-reads the Science and Cell Press author-guideline pages in a browser,
   and when? Both 403 to direct fetch; 28 rules are `documented-indexed` until
   somebody does, and milestone 12b is gated on it.
10. Are the two NSF PAPPG supplements (26-200, 26-202) worth chasing for v1?
    `nsf26202` 404s at the URL the base PAPPG points to. The profile ships
    naming them as unchecked either way; the question is whether v1 blocks on
    finding them.
