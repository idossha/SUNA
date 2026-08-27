# ADR-010 — Sponsor packages: slots, four measuring instruments, and a measured page count

**Status:** proposed · 2026-08-19 (user direction: "we need to develop a method
where we can export unconventional schemas that follow specific requirements —
e.g. a grant proposal." Ground truth:
`document-kinds-findings.json` areas `sponsor-package-nih` and
`sponsor-package-nsf`. Depends on ADR-009's document registry. Spec:
`feature-plan-12.md` §§6–9.)

## Context

An NIH application is not a document. The real assembled submission the user
supplied makes the schema literally visible: one page of it (lines 4244-4269 of
the 5,715-line text extraction — `pdftext` over
`private-examples/proposals/assembled-proposal.pdf`; the
extraction command is recorded in `document-kinds-findings.json`) is the PHS 398
Research Plan form printing
its **thirteen numbered slots** with the attached filename beside each used
one — six left empty and **never renumbered**.

Slots come in three incompatible kinds. Some are **forms** whose pages the
agency generates from structured data (SF424 face page, performance sites,
fifteen budget pages across five periods, nine Senior/Key Person profiles).
Some are **free prose PDFs** the applicant authors and attaches. Some are
**per-person**: nine senior/key persons produced nine Common Form + Supplement
pairs, eighteen documents that must appear adjacent, paired, and in profile
order.

And each slot carries its limit **in its own unit**. A single R01 package needs
four different measuring instruments:

| slot | limit | unit | source |
|---|---|---|---|
| Research Strategy (R01) | 12 | **pages** | `nih.strategy.pages.r01` |
| Specific Aims | 1 | **pages** | `nih.aims.pages` |
| Project Summary/Abstract | 30 | **lines** | `nih.summary.lines` |
| Project Narrative | 3 | **sentences** | `nih.narrative.sentences` |
| Biosketch Personal Statement | 3,500 | **characters** | `nih.biosketch.supplement.personal` |
| each Contribution to Science | 2,000 | **characters** | `nih.biosketch.supplement.contributions` |

Two of those bind in practice, and both can only be checked **after layout** —
which is precisely what a word count cannot do. That is the whole problem this
ADR exists to solve.

NSF is the second schema and it conflicts with NIH almost everywhere the two
overlap: 15 pages against 12, one-inch margins against half an inch, Arial 10 pt
legal at NSF and illegal at NIH, a three-part named Project Summary against an
unstructured 30-line abstract, and a flat prohibition on URLs in the Project
Description (`xa.conflict.*`). That conflict is the argument for sponsor rules
being swappable profile data over one shared substrate of aims prose, figures,
`references.bib` and a person roster — never a global setting.

## Decision

1. **A package is two document kinds from ADR-009's registry.** `package` (the
   instance: which slots this application fills, plus the project facts that
   gate the conditional ones) and `component` (each authored slot, a
   first-class prose document that inherits the editor, the comments rail and
   the AI-diff review from ADR-009 decision 2).

2. **The slot schema is profile data, in its OWN registry.**
   `resources/package-profiles/nih-r01.json` and `nsf-pappg-24-1.json`, loaded
   by `packages/formatter/src/package-profiles.ts`, validated by a new
   `PackageProfileSchema`. NOT `PublisherProfileSchema`: slots, per-slot
   measurement units, conditional triggers and *enforced* typography have no
   counterpart in an author-guideline profile;
   `PublisherProfileSchema.schemaVersion` is `z.literal(3)`
   (`packages/core/src/profile.ts:305`) with no version-tolerant loader, so a
   new required field forces a v4 and a simultaneous rewrite of all thirteen
   JSONs; and `packages/formatter/src/profiles.test.ts:62` hard-asserts the
   journal registry is "exactly the twelve journal ids, plus the house style".
   Separate registry, separate invariants, that test left honest.

3. **The applicant never paginates, and SUNA measures what it did not
   number.** Both agencies forbid applicant-supplied headers, footers, page
   numbers and tables of contents, because both assemble and paginate
   themselves (`nih.format.no-page-furniture`, `nsf.format.pagination`,
   `xa.agreement.pagination`). So the component recipe emits **naked**
   attachments — and then reads the page count out of the bytes it just
   produced. That inversion is the trick.

4. **Page and line limits are measured on the rendered PDF, never estimated.**
   The mechanism is named and costed below. No word-count proxy.

5. **SUNA never merges PDFs — but it does concatenate prose before
   rendering.** `export:package` writes N separate files into
   `output/rounds/<id>/`, which is exactly what both agencies take. Merging
   *rendered PDFs* would need a new dependency and would produce a number
   nobody should check against. Slot kind `merge` is the different, cheaper
   thing and the two must not be confused: it concatenates N **prose
   documents** into one component *before* a single render, which is how the
   real submission's three letters of support arrive as one attachment
   (`nih.example.cardinality`). Its semantics are pinned in
   `feature-plan-12.md` §8a — one rendered file, one page count measured on
   that file, one bibliography under the slot's own `referenceScope`, members
   in declared order — and it is `documentIds` only: a `merge` slot may not
   mix in an `external-pdf` member, because that would be the PDF merge this
   decision refuses.

## The page-count problem, honestly

This is the requirement most likely to be hand-waved, so here is exactly what
works, exactly what does not, and exactly what it costs.

### What works, and it needs no new dependency

`exportPdf` already holds the finished PDF **as a `Buffer` in the main
process** before it touches disk:

```
apps/desktop/src/main/services/export-pdf.ts:171   const pdf = await win.webContents.printToPDF({ … })
apps/desktop/src/main/services/export-pdf.ts:181   await writeFileAtomic(target, pdf)
apps/desktop/src/main/services/export-pdf.ts:187   return { path: target }
```

Line 187 throws away the pagination Chromium just computed.

And `pdfjs-dist@^6.2.108` is **already a dependency of `apps/desktop`**
(`apps/desktop/package.json:43`), and its legacy Node build is **already
dynamically imported in the main process**, where `doc.numPages` is **already
read**:

```
apps/desktop/src/main/services/document-import.ts:155   const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as { … }
apps/desktop/src/main/services/document-import.ts:161   for (let n = 1; n <= doc.numPages; n += 1) {
```

So the whole mechanism is: split `exportPdf` into
`renderPdfBytes(html, style, opts) → Uint8Array` and a thin writer, and between
render and write call a new eight-line
`apps/desktop/src/main/services/pdf-measure.ts::pdfPageCount(bytes)` doing
`getDocument({ data }).promise.then(d => d.numPages)`.

**No new dependency. No new process. No disk round-trip. No estimation.** The
count is read from the exact bytes the sponsor receives, under the same
resolved style and the same `ExportOptions` that produce the submitted file.

Line count comes from the same render, and reuses code that already ships:
`LINE_NUMBER_SCRIPT` (`export-pdf.ts:52-92`) already groups rendered line boxes
by measuring `Range.getClientRects()` and rounding `rect.top`, in the print
window, before printing. Factoring that grouping out gives NIH's 30-line
Project Summary an exact rendered count. Sentences (NIH's three-sentence
Project Narrative), words and characters are pre-render text counts through the
existing `countWords` (`packages/formatter/src/check/manuscript.ts:46`).

`export:pdf`'s response gains `pages`. `export:package`'s response is
`{ dir, components: [{ slotId, file, pages, limit, over }], diagnostics }` —
the first export response in the codebase that is not a single `{ path }`.
Page-limit violations are `surface: 'export'` diagnostics, a surface
`packages/formatter/src/check/types.ts:10` already declares and **nothing
currently emits**.

### What does NOT work, and must be said in the UI

**1. Parity with a Word-laid-out document is not guaranteed, and one known
cause is ours.** In the user's real submitted Research Strategy the figures are
**text-wrapped floats sitting beside body copy** — caption text is interleaved
mid-sentence in the extraction (`nih.example.float-layout`). SUNA's HTML export
places figures inline at full width, which uses strictly more pages. A Research
Strategy that fits 12 pages in Word can therefore report 13 in SUNA.

That is the single biggest threat to this feature's credibility and it must be
fixed rather than disclaimed: `documentStyle.figureFloat: 'none' |
'wrap-left' | 'wrap-right'`, implemented as CSS `float` in `pageCss`
(`export-html.ts:429`), which Chromium paginates correctly in print. Until it
ships, the diagnostic message must say it measures SUNA's inline layout.

For NIH specifically this risk is bounded: NIH accepts **PDF only**
(`nih.format.filetype`), so the measured PDF *is* the submitted artifact and
the number is the truth about what NIH will receive. The risk is that the
author's Word draft disagrees, not that SUNA's answer is wrong about SUNA's
own output.

**2. DOCX page counts are unmeasurable in-process.** The bundled `docx` library
writes no pagination and Word paginates at open time. NIH and NSF are PDF-only,
so the package feature is unaffected — but the honest answer for any
DOCX target is `pages: null` and "not measured (DOCX target)", never a guess.

**3. Font substitution silently changes pagination.** The print window sets no
font preferences (`export-pdf.ts:131` — `show: false`, `sandbox: true`,
`contextIsolation: true`, nothing else). On a machine without Arial or Palatino
Linotype, Chromium substitutes and the count shifts. So the same pre-print
`executeJavaScript` pass that measures lines must also `await
document.fonts.ready`, run `document.fonts.check()` per declared family, and
report `missingFonts[]`. **When that array is non-empty, SUNA reports "page
count unreliable — <family> was substituted" INSTEAD OF a number.** A wrong
page count on a grant application is worse than no page count.

Electron also exposes `webPreferences.minimumFontSize` / `defaultFontFamily` /
`defaultFontSize`, which would let the print window *enforce* a sponsor minimum
rather than merely emit it in CSS. Nothing does that today, and `pageCss`
itself hardcodes sub-minimum sizes for its own furniture (the line-number
gutter at 8 pt, `export-pdf.ts:79`; the header/footer bands at 9 px,
`:165-169`) — harmless for a manuscript, illegal in an NIH attachment, which is
one more reason the package recipe emits no page furniture at all.

**4. Measurement costs a Chromium print per component.** Roughly 0.3–1.5 s
each; a ten-component package is 5–15 s. Mitigations: reuse **one** hidden
`BrowserWindow` across components with a `loadFile` per component rather than a
window each; cache by a content fingerprint (source + profile + options +
figure hashes) so only changed components re-measure; and run page/line checks
on demand behind an explicit "Check package" action and on export, never on
keystroke. Sentence, character, word, URL, heading and structural checks stay
live.

**5. It cannot run headlessly today.** Figures are rasterized in the
**renderer** because main has no canvas — `figure-export.ts:119-122` throws for
PNG/TIFF by design, and `rasterizeFigures.ts:120` produces the `figurePngPaths`
every export channel requires. So a package export cannot be driven from main
or from an agent without a renderer window. A persisted
`output/.raster-cache/` keyed by `figure.svg` sha256 is the fix; until it
exists, `measure_package` as an MCP verb can only report cached measurements.

**6. A latent unit hazard sits next door.** `figure-export.ts:84` passes
`printToPDF` a `pageSize` in **microns** with the comment saying so, while
`export-pdf.ts:172` passes **inches** (`style.page.widthMm / 25.4`) — which is
what Electron's `PrintToPDFOptions` documents. The microns call is inert only
because it also sets `preferCSSPageSize: true` so the CSS `@page` rule wins.
Anyone copying `figure-export.ts` as the model for a component printer gets a
silently wrong page size. The package printer must follow `export-pdf.ts`.

### Why not merge into one PDF

Merging would need a **new dependency** — `pdf-lib` (MIT, pure JS, not
currently in any `package.json`; `pdf.js` can re-serialize a single document
via `saveDocument()`, as `viewer/embedRunner.ts:200` does, but cannot compose
two). It is deferred, and the dependency is named here so the decision is not
re-litigated from scratch.

More importantly it is not what the sponsor wants: NIH and NSF both take N
separate uploads and assemble, paginate and index them themselves
(`nih.assembly.agency-owns`, `nsf.format.pagination`). The only thing a merge
would buy is a single-file preview for circulation — and that preview must
never be used for the limit check, because re-rendering everything into one
document changes pagination.

## Mechanism

### Slots are data, and conditionals are five operators

`SlotConditionSchema` is deliberately tiny — `always` | `never` | `is` |
`nonEmpty` | `gt` over `package.json`'s `facts` — so every condition stays
auditable and no expression language enters the codebase. `vertebrateAnimals:
true` fires the Vertebrate Animals slot (`nih.animals.trigger`).

The "one fact, several components" example used to be written against a
`subrecipients` fact that does not exist. It is corrected here rather than
softened: `PACKAGE_FACT_IDS` (`feature-plan-12.md` §8a) has no `subrecipients`
member, and `facts` was typed `partialRecord(enum, boolean)`, over which
`nonEmpty` and `gt` can never mean anything. Two changes make the mechanism
expressible: `subrecipients` joins `PACKAGE_FACT_IDS`, and a fact value widens
to `boolean | string | number | string[]` so the five operators have something
to operate on. A non-empty `subrecipients: string[]` then fires **both** the
Consortium/Subaward narrative slot and the R&R Subaward Budget form slot — one
project fact, two components, declared once.

The third consequence that used to be in this sentence — "and adds a
performance site" — is **removed as an inference presented as a rule**. The
cited evidence is a cardinality count: "9 senior/key person profiles; …
2 performance sites; 1 subrecipient" (`nih.example.cardinality`). It does not
say a subrecipient adds a performance site, and no source consulted states
that it does. Performance sites stay a `form` slot the agency generates from
data SUNA does not model.

Empty slots keep their ordinals. The real form does not renumber
(`nih.example.empty-slots-keep-numbers`), so neither does the profile.

### Numbering scope is per-slot

`referenceScope: 'slot' | 'package'`. A `'slot'` component gets its own cited-key
set and its own `assignNumbers` run — which is exactly what the real package
needs, where the Bibliography attachment runs past 60 entries while the
Vertebrate Animals attachment restarts at 1 (`nih.example.numbering-scope`).
This is the same independent-numbering shape `buildSupplementContent`
(`export-content.ts:813`) already proves, applied N times.

Figure and citation numbers are derived at format time as everywhere else — and
here there is direct field evidence for why: between the Word draft and the
submitted Research Strategy, "Figure 3. Hypoglossal Comparison Across Species"
became "Figure 2", "See Figure 2" became "Figure 5: Relevant OSA Neuroanatomy",
and superscript `40--42` became `33-35`
(`nih.example.figure-number-drift`, `nih.example.citation-number-drift`).

### Sponsor profiles legitimately carry typography

ADR-005 fixed the rule that a profile carries no `documentStyle` delta without
a guideline statement behind it. Journals almost never state page geometry for
a submitted manuscript, so their profiles carry none. **NIH and NSF state
theirs precisely**, so a sponsor `documentStyle` is sourced, not invented — and
it is *enforced*, not house style.

The seam this ADR previously named cannot carry it, and saying so is the point
of this paragraph. `resolveDocumentStyle`'s signature is
`resolveDocumentStyle(profile: PublisherProfile)` (`export-style.ts:165`) and a
sponsor package has no `PublisherProfile`; `ResolvedDocumentStyle.page.marginMm`
is a single scalar (`export-style.ts:23`) resolved from
`DocumentStyleSchema.page.marginMm`, also a scalar
(`packages/core/src/profile.ts:244`), while `PackageFormattingSchema.marginMm`
is per-side. "Gains a second `override?` parameter" would have been a
`DocumentStyle` — the wrong type, unable to express the rules stated three
lines above it. So:

- **A named conversion, not an override parameter.**
  `resolvedStyleForSlot(packageProfile, slot): ResolvedDocumentStyle` lives
  beside `resolveDocumentStyle` and builds the resolved object from
  `PackageFormattingSchema` plus the slot's own `formatOverride`. Sponsor
  geometry never travels as a `DocumentStyle`, so the two registries never
  need a common profile type. `PackageSlotSchema.documentStyle:
  DocumentStyleSchema.optional()` is **removed** and replaced by
  `formatOverride: PackageFormattingSchema.partial().optional()`.
- **`ResolvedDocumentStyle.page.marginMm` widens to
  `{ top, right, bottom, left }`.** NIH's uniform 0.5 in and NSF's uniform 1 in
  both fit a scalar by luck; the type should not depend on luck, and the
  package profile already declares per-side. The call sites are enumerable and
  small: `export-pdf.ts:144` (`marginIn`) and `:173-175`, which today collapses
  to one number and zeroes left/right on the themed path;
  `export-html.ts:442,449`; `export-docx.ts:649-650, 1238-1241, 1432-1435`.
  Each becomes four values instead of one. `SUNA_DEFAULT_STYLE`
  (`export-style.ts:127`) and `export-style.test.ts:34,89-97` move with it.

Both writers therefore still resolve typography through one place; that place
now has two entry points, one per registry, returning the same resolved type.

### What is checked

Pre-render, from `resolvedStyleForSlot` and the text — deterministic, live:
`pkg.font-min`, `pkg.font-not-allowed`, `pkg.margin-min`, `pkg.line-density`,
`pkg.char-density`, `pkg.word-limit`, `pkg.char-limit`, `pkg.sentence-limit`
(heuristic, and its message says so), `pkg.url-forbidden` (NSF prohibits URLs
in the Project Description outright, `nsf.description.no-urls`),
`pkg.heading-missing`, `pkg.slot-missing`, `pkg.forbidden-content` (the
biosketch Supplement bans figures, tables and hyperlinks,
`nih.biosketch.supplement.no-graphics`).

Post-render, on the measured bytes: `pkg.page-limit`, `pkg.line-limit`,
`pkg.font-substituted`, `pkg.page-unmeasured`.

Three checks earn their place because the real submission fails them:

- **`pkg.heading-missing`** — the submitted Research Strategy uses
  "Background/Significance of Obstructive Sleep Apnea (OSA):", "INNOVATION:"
  and "APPROACH:" where NIH prescribes Significance / Innovation / Approach
  (`nih.defect.headings`). Flagged, never rewritten.
- **`pkg.schema-superseded`** — its own rule class, not a length violation.
  Every slot may carry `effectiveFrom`/`effectiveUntil`, compared against the
  package's `dueAt`. The real DMS Plan used the six-element narrative format
  for a 06/05/2026 deadline, after NOT-OD-26-046 replaced it on 25 May 2026
  (`nih.defect.superseded-format`).
- **`pkg.term-inconsistent`** — `declaredTerms` (activity code, NOFO number,
  project title) scanned across every component. The real package says
  "UG3/UH3 … under the PA-25-301" in its cover letter, "Parent R01" on the
  institutional form and "R01 proposal" in a letter of support, where PA-25-301
  *is* the Parent R01 NOFO (`nih.defect.activity-code`). Same engine as
  ADR-009's `letter.journal-name-mismatch` — one implementation, two asks.

### Filenames are guaranteed, not checked

SUNA's exporter names every attachment it produces, so NIH's 50-character limit
and character set (`nih.format.filename-length`, `nih.format.filename-charset`)
are a **guarantee**. The rule still exists in the profile because it must be
*checked* for stapled external PDFs the user supplies. All nine biosketch
filenames in the real submission pass, and no two follow the same convention
(`nih.example.filenames`) — filename generation is a step the tool should own
outright.

### The boundary between rendering and stapling

`kind: 'external'` slots are byte-copied through under a compliant name, with
their sha256 recorded. Their page count is still read with `pdfPageCount`, so
their limit is still checked. NIH's flattened / no-security / no-portfolio
rules are checked as far as pdf.js reports them — a load failure or an
encryption flag becomes `pkg.pdf-security`, and where pdf.js does not expose a
fact the diagnostic says **"not verified"**, never "passes".

This is the honest boundary: **SUNA renders what it authors, staples what it
does not, and never claims to have validated the inside of a stapled PDF beyond
its page count and its filename.**

## Explicitly out of scope

- **Biosketches.** NIH states outright that SciENcv must be used and that there
  is no downloadable blank template (`nih.biosketch.sciencv`). SUNA's only
  correct role is to accept the PDF as an external slot, name it compliantly,
  and count its pages. `cardinality: 'per-person'` exists so the *ordering* and
  *pairing* rule (`nih.biosketch.pairing`) is representable and checkable.
- **Budgets, the SF424 face page, and every other `kind: 'form'` slot.** They
  are structured data submitted through eRA/Research.gov, not documents. The
  manifest records them as `source: 'form'` so the completeness checklist is
  honest about what SUNA did and did not produce.
- **The institutional routing layer.** The real assembled file ends with two
  pages of a institutional Proposal Summary that NIH never receives —
  and which carries the only copy of the deadline
  (`nih.example.institutional-pages`). Useful metadata, wrong schema. The
  package may carry a `dueAt` so `effectiveFrom` is evaluable; SUNA does not
  model the routing form.
- **PDF merging.** See above; `pdf-lib` named, deferred.
- **NOFO overlays.** See *Open decisions*.
- **LaTeX/Tectonic for grant components.** Attractive for typographic control
  and rejected for now: the PDF path is already Chromium, the measurement loop
  is one refactor away, and a second layout engine means two page counts that
  can disagree — the worst possible outcome for a check whose entire value is
  that it is authoritative.

## Open decisions

1. **NOFO overlays.** NIH states plainly that NOFO Section IV supersedes the
   Table of Page Limits (`nih.nofo-supersedes`), and the real submission's own
   activity code disagreed across three of its components. A single static
   `nih-r01.json` will confidently apply a 12-page limit to an application
   governed by something else. The natural shape is a per-NOFO overlay profile,
   but PA-25-301 Section IV was never fetched, so how much it overrides in
   practice is unknown. Until an overlay exists the Compliance panel must say
   "checked against the parent R01 table; this NOFO's Section IV has not been
   encoded" rather than showing a clean green.
2. **The two live PAPPG supplements are unchecked against Chapter II.** Every
   NSF rule here is recorded against **base PAPPG NSF 24-1 only**. Two
   supplements have been issued — NSF 26-200 (awards on or after 8 December
   2025) and NSF 26-202 (awards on or after 22 January 2026) — and their effect
   on Chapter II could not be verified:
   `https://www.nsf.gov/policies/document/nsf26202` returns HTTP 404, which
   reproduces today. PAPPG 24-1 is confirmed still in force, so the base rules
   are current; whether either supplement changes a proposal-preparation rule is
   **unknown**. This is the NSF twin of the NOFO gap in item 1 and gets the same
   treatment: `nsf-pappg-24-1.json`'s `notes[]` names both supplements as
   unchecked, and the Compliance panel says "checked against base PAPPG 24-1;
   supplements NSF 26-200 and NSF 26-202 have not been encoded" rather than
   showing a clean green. The profile id keeps the base document's name so the
   file cannot silently imply it covers more than it does.
3. **Does the user want a merged preview PDF at all?** It costs `pdf-lib` and
   must be labelled as non-authoritative for limits.
4. **Which NIH mechanisms beyond R01, and which NSF programme solicitations?**
   Each is a profile someone has to read a guideline page to write.
5. **Should `pkg.sentence-limit` ship at all?** Sentence segmentation is a
   heuristic on prose containing `Fig. 2`, `e.g.` and `0.5 s^-1`. It can be
   honest ("heuristic count: 4 sentences against a 3-sentence limit") or it can
   be omitted; a wrong sentence count on a two-sentence narrative is noise.

## Accepted simplifications

- **No `extends` for package profiles in v1.** The journal loader's `extends`
  replaces arrays wholesale, asserted by
  `packages/formatter/src/extends.test.ts:49-64`; a twenty-slot package cannot
  restate its whole `slots` array to change one limit, so it would need
  merge-by-id — two different merge semantics in one codebase is a real hazard.
  NIH R01 and NSF are two standalone files. When a third NIH mechanism arrives,
  revisit.
- **One package document per project.** Nothing prevents two, but no evidence
  asks for it.
- **Provenance carries a fetch date, not a content hash.** Sponsor rules move
  faster than journal rules — NIH changed the DMS format by Guide Notice
  mid-cycle — but a content hash over a page that is fetched through an
  intermittent IdP redirect would report false staleness. `lastVerified` plus
  `effectiveFrom`/`effectiveUntil` per slot is the compromise. Both sponsor
  profiles do inherit ADR-009's fourth `ProvenanceBasis` value,
  `documented-indexed`, but neither needs it today: every NIH and NSF rule here
  was read from a page that returned 200, and re-fetching the cited grants.nih.gov
  and nsf.gov URLs confirms it. The gap on the NSF side is a *missing* document
  (open decision 2), not an unread quote.

## Rejected

- **Estimating pages from word counts.** This is the shape
  `docs/design/author-guidelines-profiles.md:405` sketched as MAN-015
  ("Estimated typeset length exceeds page limit … warning (estimate-based)")
  and never implemented. It is exactly the invented threshold ADR-002 forbids,
  and it is no longer necessary: the real render is one in-memory `pdfjs` parse
  away from a buffer the pipeline already holds.
- **A `pageLimit` field on `ArticleTypeRulesSchema`.** One number per article
  type cannot express four measuring instruments over twenty slots. It belongs
  on a slot, with its unit.
- **Folding sponsor rules into `PublisherProfileSchema`.** See decision 2.
- **A generic expression language for slot conditions.** Five operators cover
  every observed trigger and stay readable in a JSON file a human must audit.
- **Auto-syncing content reused across slots.** The Project Summary is a
  lightly edited derivative of the Specific Aims, and the divergences look
  deliberate — the lay abstract dropped the FDA pre-market-approval detail on
  purpose (`nih.example.reuse-drift`). Any drift threshold would be an invented
  number. Record `derivedFrom`, offer a diff on demand, propagate nothing.
- **Trusting a stapled PDF's internals.** See *The boundary*.
