# Feature plan 10 — study acquisition: from a mention to a PDF-backed citation

**Goal (user direction, 2026-08-18):** "if the user mentions a study it can go
and use our search engines like openalex/rxiv/crossref or the AI to search for
that paper. Then it should search the computer to see if the pdf is found
locally, if so copy it to the project dir. If not, try to download it from the
internet. Otherwise just cite it from the info found."

Four outcomes, in strict preference order, and the agent must always say
**which one happened**:

1. `already-present` — the project already has this PDF.
2. `copied-local` — found on this machine, copied into `references/<key>.pdf`.
3. `downloaded` — fetched from an open-access source (or a publisher page's
   `citation_pdf_url`), byte-verified, saved to `references/<key>.pdf`.
4. `metadata-only` — no PDF anywhere; the reference is still cited correctly
   from the metadata that *was* found.

A fifth outcome is `unresolved` — the mention matched nothing, or matched
several works too closely to choose. That is reported as ambiguity, never
papered over by picking the first hit.

## User decisions (asked and answered, 2026-08-18)

| decision | choice |
| --- | --- |
| local scan strategy | Spotlight (`mdfind`, macOS) **plus** a bounded walk of user-configured roots |
| surface | MCP verbs **and** a Settings pane **and** a References-view action |
| download policy | open access **plus** the publisher landing page's `citation_pdf_url` |

## What already exists (do not rebuild)

- `@suna/bib/providers.ts` — `searchLiterature` / `lookupByDoi` over
  crossref · openalex · biorxiv · arxiv, normalized to `LitResult`, never
  throwing, errors surfaced as strings. Uses global `fetch` only, so it runs
  in the Electron main process and the standalone MCP server alike.
- `@suna/bib/lit-entry.ts` — `litResultToBibEntry`, `generateCiteKey`.
- `@suna/bib/bib-write.ts` — `appendLitResultToBib(bibText, result)`.
- `@suna/bib/pdf.ts` — `resolvePdfPath(entry, listing, opts)`: finds a PDF
  **already inside the project** (file field → `references/<key>.pdf` →
  `Author_Year*` fuzzy).
- MCP verbs `search_literature`, `lookup_doi`, `add_reference`.
- References view: manual "Attach PDF…" (user picks a file, app **copies** it
  to `references/<key>.pdf` — never moves).
- `sunaConfigDir()` → `~/SunaConfig` (`$SUNA_CONFIG_DIR` overrides), the
  machine-level folder both hosts can read.

## What is missing (this plan)

Resolving a *free-text mention* to one work; searching the **computer**;
**downloading**; and one composite verb that runs the whole ladder and reports
honestly.

---

## Layer 1 — `@suna/core` (pure schemas)

New file `packages/core/src/library.ts`, re-exported from `index.ts`.

```ts
export const LIBRARY_CONFIG_FILENAME = 'library.json'   // in sunaConfigDir()

/** Portable, `~`-prefixed; the host expands them. Never store absolutes here. */
export const DEFAULT_LIBRARY_ROOTS = [
  '~/Downloads', '~/Documents', '~/Zotero/storage', '~/Papers',
] as const

export const DOWNLOAD_POLICIES = ['off', 'open-access', 'publisher'] as const
export const DownloadPolicySchema = z.enum(DOWNLOAD_POLICIES)

export const LibraryConfigSchema = z.object({
  schemaVersion: z.literal(1),
  roots: z.array(z.string().min(1)),
  useSpotlight: z.boolean(),          // macOS only; ignored elsewhere
  download: DownloadPolicySchema,     // default 'publisher' (the user's pick)
  maxDepth: z.number().int().min(1).max(12),        // default 6
  maxFilesScanned: z.number().int().min(100).max(200_000), // default 20_000
})
export const DEFAULT_LIBRARY_CONFIG: LibraryConfig = { … }
```

Evidence + confidence vocabulary (both hosts and the UI share it):

```ts
export const PDF_EVIDENCE_IDS = [
  'doi-in-bytes', 'arxiv-id-in-bytes', 'title-in-bytes',
  'filename-doi', 'filename-arxiv-id', 'filename-author-year',
  'filename-title-words', 'spotlight-content-hit',
] as const
export const MATCH_CONFIDENCE = ['high', 'medium', 'low'] as const

export const PdfMatchSchema = z.object({
  /** Absolute path on this machine. Always inside a configured root. */
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  confidence: MatchConfidenceSchema,
  evidence: z.array(PdfEvidenceIdSchema).min(1),
})

export const PDF_ACQUISITIONS = [
  'already-present', 'copied-local', 'downloaded', 'metadata-only',
] as const
```

`StudyResolutionSchema { chosen: LitResult|null, confidence, alternatives:
LitResult[], providersTried: string[], errors: string[] }` — `errors` carries
per-provider failures so a 429 from OpenAlex is never mistaken for "no such
paper".

## Layer 2 — `@suna/bib` (pure; `fetch` allowed, `fs`/`child_process` are NOT)

The existing doctrine: this package is importable unchanged by both hosts.
`providers.ts` already calls `fetch`, so network is in-doctrine here; disk is
not.

### `study-match.ts` — mention → one work

- `parseMention(text)` → `{ doi?, arxivId?, surnames: string[], year?,
  quotedTitle?, freeWords: string[] }`. Recognizes `10.xxxx/…`,
  `arXiv:2401.01234`, `Gunn & Gott 1972`, `Gunn and Gott (1972)`,
  `"quoted title"`, and et-al forms.
- `mergeCandidates(byProvider)` → dedupe across providers on normalized DOI,
  then arXiv id, then folded title. Merging keeps the **richest** record
  (prefer one that has an `openAccessUrl`, an abstract, a DOI).
- `rankCandidates(hints, candidates)` → scored list.
  - An exact DOI or arXiv-id hint is decisive: that candidate wins outright.
  - Otherwise: title similarity (token-set Dice on folded tokens) dominates;
    author-surname overlap and year (exact, then ±1) adjust; `citedByCount`
    breaks ties only — never outranks a better title match.
- `resolveStudy(hints, candidates)` → `StudyResolution`. **Confidence must be
  honest**: `low` when the top two scores are within 10 %, or when the best
  title similarity is under 0.5. A `low` result is still returned, with
  alternatives, so the caller can report ambiguity.

### `pdf-match.ts` — does this file look like that paper?

- `scorePdfCandidate(result, { path, bytesSample? })` → `{ evidence[],
  confidence } | null`.
  - Filename rules: DOI with `/`→`_`, arXiv id, `Author_Year_Word`, Zotero's
    `Author - Year - Title.pdf`, `Author et al. - Year - Title.pdf`.
  - Byte rules (when `bytesSample` is supplied by the host): the DOI string,
    the arXiv id, or ≥ 60 % of the title's significant tokens appearing in the
    sample. Publisher PDFs carry XMP metadata as **uncompressed** XML, so a
    raw-byte search for the DOI is genuinely effective and needs no PDF
    parser.
  - `high` requires at least one byte-level or DOI-level hit. A filename-only
    match never exceeds `medium`; a title-words-only filename match is `low`.
- `rankPdfCandidates(result, candidates)` → sorted, best first.

### `pdf-bytes.ts`

- `isPdfBytes(bytes)` — `%PDF-` magic in the first 1 KB.
- `looksLikeHtml(bytes)` — catches a login/interstitial page saved as a PDF.
- `asciiSample(bytes, limit)` — latin-1 decode for the byte rules above.

### `pdf-fetch.ts` — where the PDF might be, and getting it

Pure URL derivation, then a guarded fetch:

- `pdfUrlCandidates(result)` → ordered `{ url, via }[]`:
  1. `arxiv` → `https://arxiv.org/pdf/<id>`
  2. `biorxiv`/`medrxiv` landing page → `<landing>.full.pdf`
  3. **`openalex-mirror`** → `https://api.openalex.org/works/doi:<doi>`, then
     **every** OA location in `locations[]`, mirrors first (arXiv, Europe PMC,
     repositories) and publishers last. A PMC location usually carries
     `pdf_url: null`, so its id is read from `landing_page_url` and turned
     into `https://europepmc.org/articles/PMC<id>?pdf=render`. Keyless, so
     unlike Unpaywall it runs with or without a mailto. **This rung sits ahead
     of every publisher rung**: measured 2026-08-18, reading only
     `best_oa_location` got 4 of 10 specimens, walking every location got 8.
  4. `result.openAccessUrl` when it already ends `.pdf`
  5. Unpaywall `https://api.unpaywall.org/v2/<doi>?email=<mailto>` →
     `best_oa_location.url_for_pdf` (keyless, **requires** a mailto; skipped
     without one, and that skip is reported)
  6. `result.openAccessUrl` landing page → `citation_pdf_url`
  7. publisher page via `https://doi.org/<doi>` → `citation_pdf_url`
     (**policy `'publisher'` only**)
- `citationPdfUrlFromHtml(html, baseUrl)` — pure; reads
  `<meta name="citation_pdf_url">` (the Google-Scholar tag, near-universal),
  falling back to `<link rel="alternate" type="application/pdf">`. Resolves
  relative URLs against `baseUrl`.
- `downloadPdf(result, { policy, mailto, maxBytes, signal? })` →
  `{ bytes, sourceUrl, via, error, failure, refusedBy }`. `failure` is
  `'refused' | 'no-open-copy' | 'unreachable'`, classified from the HTTP
  **status** rather than the error prose, and `refusedBy` names the hosts that
  turned us away — so a caller can say "open it in a browser" where that is
  the truth and "cite it from metadata" where that is. `describePdfFailure`
  renders the one sentence both hosts lead with. Never throws. Rejects non-PDF bytes and
  HTML, caps at 50 MB enforced *while streaming*, at most 3 redirects, and
  **stops at the first success**. **One 60 s ceiling for the whole call**,
  created once at entry and shared by every rung and every redirect hop; the
  20 s per-hop timeout is a **sub-limit** of it, never a multiplier — six
  candidates × two requests × four hops × 20 s would be twelve minutes of a
  wedged `library:acquire-pdf` call or MCP turn, which a server answering
  every hop at 19 s buys outright. An optional caller `AbortSignal` ends the
  call sooner. Returns an `error` naming every URL tried when all fail, plus
  every rung that was skipped — including the rungs the budget cut off, so
  "Unpaywall was never asked" always comes with its reason — never a silent
  null.
- Every URL is gated before a request is made, and again at every redirect
  hop: `http:`/`https:` only, and never a host that denotes this machine or a
  private network. Each of them — `openAccessUrl`, Unpaywall's `url_for_pdf`,
  a `Location` header, a page's `citation_pdf_url` — was written by somebody
  else, and following one to `http://169.254.169.254/…` would put an internal
  service's answer into `references/<key>.pdf` and turn the per-URL failure
  messages into a port scanner.

**Never** attempt paywall circumvention: no Sci-Hub, no institutional
proxies, no credential replay. A 403 is reported as a 403.

### `bib-write.ts` — extend

Add `appendLitResultToBib(bibText, result, opts?: { filePath?: string })`.
When `filePath` is given, the serialized entry carries
`file = {references/<key>.pdf}` so `resolvePdfPath`'s existing `file-field`
rule finds it immediately. Keep the current 2-arg call byte-identical.

Also add `findExistingKey(bibText, result)` → the cite key already in the file
for this DOI/arXiv id/title, or null — so `cite_study` **updates** rather than
duplicating a reference the bibliography already has.

## Layer 3 — the disk scanner (`packages/agent/src/library/`)

Touches `fs` and `child_process`, so it lives here, not in `@suna/bib`.
`@suna/agent` is already a `@suna/desktop` dependency, so the desktop main
process re-exports it — the same one-implementation-two-hosts pattern
`apps/desktop/src/main/services/lit.ts` already uses for providers.

Export the new surface from `packages/agent/src/index.ts`.

### `config.ts`

- `libraryConfigPath(env?)` → `join(sunaConfigDir(env), 'library.json')`
- `loadLibraryConfig()` — parse, fall back to `DEFAULT_LIBRARY_CONFIG` on any
  error (never throw); expands `~` **only at use time**, keeping the stored
  form portable.
- `saveLibraryConfig(patch)` — atomic tmp+rename, like every other writer here.
- `expandRoots(config)` → absolute, existing, deduped, symlink-resolved roots.
  A configured root that does not exist is **dropped and reported**, not an
  error.
- `quoteExternalPath` / `describeExternalError` — the two escapers the security
  boundary below makes mandatory. They live *here*, in the layer's lowest
  module, because `scan.ts` imports `config.ts` and so cannot own them without
  a cycle; `scan.ts` re-exports **both** and `index.ts` exports both, so
  `index.ts` and the desktop host keep their import path. Do not move them
  back, and do not export one without the other: re-exporting only
  `quoteExternalPath` is what left the desktop host unable to call the error
  escaper, and so outside a rule it was required to follow (ADR-007).

### `scan.ts`

`findLocalPdf(result, config, opts?)` → `{ matches: PdfMatch[], rootsSearched:
string[], rootsMissing: string[], scanned: number, truncated: boolean, notes:
string[] }`.

1. **Spotlight** (darwin && `useSpotlight`): `execFile('mdfind', [...])` —
   argv, never a shell, so a title containing quotes cannot inject. Queries in
   order, each `-onlyin <root>` per configured root:
   - `kMDItemContentType == "com.adobe.pdf" && kMDItemTextContent == "<doi>"`
   - same, with the exact title
   - `kMDItemFSName == "*<surname>*<year>*"cd`
   5 s timeout per query, 200 results kept. Spotlight being off or the binary
   missing is a `note`, not a failure.
2. **Bounded walk** of `expandRoots`: `.pdf` only, `maxDepth`, `maxFilesScanned`
   (sets `truncated` when hit), skipping `node_modules`, `.git`, `Library/Caches`,
   `.Trash`, `.venv`, `__pycache__`.
3. Score filenames with `@suna/bib`'s `scorePdfCandidate` (cheap), then read
   the **first 256 KB** of 12 candidates and re-score with `bytesSample` for
   byte-level evidence. The budget of 12 goes to the filename-ranked
   candidates first and then, while any is left, to candidates whose names
   scored nothing at all — Zotero files everything as
   `storage/<8 chars>/Full Text PDF.pdf`, which matches no filename rule, so
   reading only the top 12 of the *ranked* list would put `doi-in-bytes` out
   of reach for one of the four default roots. Only a regular file is opened.
4. Rank with `rankPdfCandidates`; return matches with their evidence.

**Read-only.** This function copies nothing and executes nothing it finds.

`importPdfIntoProject(sourcePath, projectRoot, citekey)`:
- destination is `resolveInside(projectRoot, 'references', `${citekey}.pdf`)` —
  writes are confined to the project even though reads were not — and then
  re-asserted against the filesystem, because `resolveInside` is a string
  comparison that a symlinked `references/` walks straight through;
- `mkdir -p references/`;
- **copy, never move** — the user's library file is untouched;
- refuse to overwrite an existing destination; return the existing path with
  `already-present` instead.

`savePdfBytes(bytes, projectRoot, citekey)` — same confinement and same
no-overwrite rule for the download path.

## Layer 4 — MCP verbs (`packages/agent/src/mcp/study.ts`)

Four new verbs; the registry goes 19 → 23.

| verb | input | behaviour |
| --- | --- | --- |
| `find_study` | `{mention, providers?, limit?}` | search every provider in parallel, merge, rank; return the chosen work + confidence + up to 4 alternatives **with DOIs**, plus per-provider errors |
| `find_local_pdf` | `{doi?, mention?, citekey?}` | read-only machine search; matches with path, confidence and the evidence for each — or "no match across N roots" naming the roots |
| `fetch_pdf` | `{citekey?, doi?, policy?, accept?}` | acquire into `references/<key>.pdf`: local first, then download; reports the path taken and the source URL. `accept` is a path **the scan itself reported**, copied in deliberately even though its evidence was too thin to copy unasked; any other path is refused |
| `cite_study` | `{mention, download?, pdf?}` | the composite: resolve → dedupe against the bib (existing key reused, never duplicated) → append → local → download → metadata-only; one honest report naming the outcome and the `[@key]` to paste |

Contract notes:

- Ambiguity (`confidence: 'low'`) from `cite_study` **does not write**. It
  returns the alternatives and asks the caller to re-run with an explicit DOI.
  Guessing on the user's behalf is the one thing this feature must not do.
- A local match is copied **unasked** only on `high` confidence, or on
  `medium` corroborated by a second distinct evidence id — a lone
  `filename-author-year` is a `medium` by itself and "Smith 2020" names every
  paper Smith wrote in 2020. Weaker matches ride back as named candidates and
  are copied only through `fetch_pdf`'s `accept`. The rule is one function,
  `isAutoCopyable`, exported from `@suna/agent` because the MCP verb and the
  References view both gate on it.
- Every message states which providers answered and which failed.
- Appending to `references.bib` is additive, so it is automatic — consistent
  with the doctrine in `SunaContext/`. Nothing here overwrites or deletes.

## Layer 5 — desktop surfaces

New IPC in `packages/core/src/ipc.ts` (+ handlers in
`apps/desktop/src/main/ipc.ts`, service in
`apps/desktop/src/main/services/library.ts` re-exporting `@suna/agent`):

- `library:read-config` / `library:write-config`
- `library:find-pdf` `{result, projectRoot}` → matches + roots searched
- `library:acquire-pdf` `{result, citekey, projectRoot, policy}` → outcome.
  The main-process service also takes `acceptPath` and an `AbortSignal`; the
  contract carries neither yet, so the handler passes `acceptPath: null` and
  aborts on the requesting `WebContents` being destroyed — closing the window
  stops an in-flight fetch instead of leaving it to its 60 s deadline. A
  "copy this candidate" button and a real cancel button are both contract
  changes: a new request field, and (for cancel) a `library:cancel` channel
  keyed by an id, the way `lit:cancel` works.

**Settings** (`settings/SettingsTab.tsx`, new "Reference library" section):
roots list with add-via-directory-picker and remove; Spotlight toggle (macOS
only, hidden elsewhere); download-policy select. These persist to
`~/SunaConfig/library.json` — **not** userData/settings.json — because the
standalone MCP server must read the same values.

**References view** (`views/ReferencesView.tsx`): a "Find PDF" action beside
"Attach PDF…" on rows with no PDF badge. Runs `library:acquire-pdf`, rescans,
and sets a status note naming the outcome and, for a local hit, the path it
came from.

## Layer 6 — agent docs (drift-gated — the build fails without this)

- `resources/suna-context/MCP.md`: add all four verbs to the table.
  `context.test.ts` pins the table equal to the `TOOLS` registry, names and
  count.
- `resources/suna-context/WORKFLOW.md`: the "user mentions a study" playbook —
  `find_study` → confirm if `low` → `cite_study`.
- Regenerate `packages/agent/src/context/docs.gen.ts`:
  `node scripts/gen-suna-context.mjs`. The generated module must be
  byte-identical to a fresh regeneration.
- New ADR `docs/design/adr-007-study-acquisition.md` recording the three user
  decisions, the read-outside/write-inside boundary, and what was rejected.

## Tests (all must pass under `pnpm test`)

- `@suna/bib`: mention parsing; ranking incl. the ambiguity rule; DOI-hint
  decisiveness; evidence + confidence tiers; `%PDF-` / HTML rejection;
  `citation_pdf_url` extraction incl. a relative href; URL-candidate ordering
  per policy; `file` field round-tripping through `serializeBibtex`/`parseBibtex`;
  `findExistingKey` dedupe.
- `@suna/agent`: scanner over a temp fixture tree (real fs, **no network**);
  `maxFilesScanned` truncation reported; missing roots dropped and reported;
  `importPdfIntoProject` refuses a path escape and refuses to overwrite;
  MCP verbs with injected fake providers, including the low-confidence
  no-write path; plus a source-level gate (`external-paths.test.ts`) that reads
  the source of every file making the escaping claim — `library/scan.ts`,
  `library/config.ts`, `mcp/lit.ts`, `mcp/study.ts` and the desktop host's
  `apps/desktop/src/main/services/library.ts`, both hosts of the ladder, not
  one package's directory — and fails on a path-ish or URL-ish expression
  reaching a report without an escaper, on a thrown value described by hand,
  on a call to the raw `describeError`, or on a path concatenated onto a
  string literal. The escaping rule above is a spec requirement, so it is
  checked mechanically and not by review. It is a tripwire and not a parser:
  the three shapes it knowingly misses are named in its own header and in
  ADR-007, and the guarded set plus the allow-list — each exemption carrying
  its reason, and itself tested for still matching live code — is where that
  claim is reviewed.
- Renderer: settings coercion for the new keys; refs-view helper for the new
  action.
- `pnpm typecheck` and `pnpm test` workspace-wide.

## Security boundary (state it plainly)

This feature reads files **outside** the project for the first time. The rules:

- Reads happen only inside roots the user configured (defaults are four
  conventional folders, all under `$HOME`), or via Spotlight, which already
  honours the user's own privacy exclusions.
- Writes stay confined to the project root via `resolveInside`, re-asserted
  against the filesystem (see below).
- Nothing found on disk is executed, parsed as code, or treated as
  instructions — a PDF is bytes to be copied and pattern-matched, nothing
  more. That includes its *name*: every outside path is escaped
  (`quoteExternalPath`) before it is interpolated into a note, because a file
  called `Gunn1972\n\nnotes:\n  <directive>.pdf` would otherwise reproduce
  the report's own line structure inside the agent's context. The rule is
  unconditional and stays that way — a thrown error takes
  `describeExternalError`, since an errno message quotes the path it failed on,
  and a provider URL is the same trust class as a file name — and
  `external-paths.test.ts` enforces it over the source rather than leaving it
  to care (see ADR-007).
- `mdfind` is invoked with `execFile` and an argv array; no shell, no
  interpolation.
- Downloads are byte-verified, size-capped, redirect-capped, **time-capped**
  and never attempt to defeat access controls. The time cap is one 60 s
  ceiling for the whole `downloadPdf` call — not 20 s per URL, which
  multiplies by rungs and by redirect hops into minutes of a wedged IPC call
  or MCP turn — and a caller may pass an `AbortSignal` to end it sooner.
- Every URL fetched is gated at the start of every request and at every
  redirect hop: `http:`/`https:` only, never a host denoting this machine or a
  private network. The ladder's job is to follow addresses other people wrote,
  so without the gate a landing page can aim it at the loopback interface or a
  cloud metadata service.
- Only a **regular file** inside a configured root is ever opened, and the
  boundary is tested on the realpath, not the name: a symlink sitting inside a
  root cannot carry the read to a target outside one, and a directory (macOS
  bundles are directories) or a FIFO called `Gunn_1972.pdf` is dropped with a
  note rather than opened — `open()` on a FIFO blocks until a writer appears.
- The write confinement is asserted against the filesystem as well as the
  string: `resolveInside` cannot see a symlink, so `references/` and the
  project root are both realpath-resolved and the prefix re-checked before
  bytes are written, and the `already-present` question is answered on the
  resolved file at both the directory and the file level.
