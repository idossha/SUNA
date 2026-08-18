# ADR-007 — Study acquisition: from a mention to a PDF-backed citation

**Status:** accepted · 2026-08-18 (user direction: "if the user mentions a
study it can go and use our search engines like openalex/rxiv/crossref or the
AI to search for that paper. Then it should search the computer to see if the
pdf is found locally, if so copy it to the project dir. If not, try to
download it from the internet. Otherwise just cite it from the info found."
Spec: `feature-plan-10.md`)

## Decision

A free-text *mention* becomes a correctly-cited, PDF-backed reference through
one ladder, and the agent must always say **which rung it landed on**:

1. `already-present` — the project already has this PDF.
2. `copied-local` — found on this machine, **copied** into
   `references/<key>.pdf`. Unasked only when the evidence names the *work* and
   not merely an author in a year; a weaker match is reported as a candidate
   the user can accept by path (*Why a `medium` local match needs
   corroboration*).
3. `downloaded` — fetched from an open-access source (or the publisher landing
   page's `citation_pdf_url`), byte-verified, saved to `references/<key>.pdf`.
4. `metadata-only` — no PDF anywhere; the reference is still cited correctly
   from the metadata that *was* found.

A fifth result, `unresolved`, is reported as ambiguity and never papered over
by picking the first hit.

The three questions the user was asked, and answered (2026-08-18):

| decision | choice | consequence here |
|---|---|---|
| local scan strategy | Spotlight (`mdfind`, macOS) **plus** a bounded walk of user-configured roots | `scan.ts` runs both and merges; Spotlight off, absent or non-darwin is a `note`, never a failure — the walk still answers |
| surface | MCP verbs **and** a Settings pane **and** a References-view action | one implementation in `@suna/agent`, three callers: the MCP verbs, `library:*` IPC for the Settings pane, and the References row's "Find PDF" |
| download policy | open access **plus** the publisher landing page's `citation_pdf_url` | `DOWNLOAD_POLICIES = ['off', 'open-access', 'publisher']`, default `publisher`; the `citation_pdf_url` rung exists **only** under `publisher` |

Four verbs carry it (19 → 23 tools): `find_study` resolves a mention,
`find_local_pdf` searches this machine read-only, `fetch_pdf` acquires the PDF
for a reference the bibliography already has, and `cite_study` runs the whole
ladder and reports once.

## Mechanism

- **Layers by capability, not by convenience.** `@suna/core` holds the schemas
  (`LibraryConfig`, `PdfMatch`, `StudyResolution`, the evidence and confidence
  vocabularies). `@suna/bib` stays pure-plus-`fetch`: mention parsing,
  candidate merging and ranking, PDF-evidence scoring, URL derivation, the
  guarded download. Anything touching `fs` or `child_process` lives in
  `@suna/agent/library/` — so `@suna/bib` remains importable unchanged by both
  hosts, exactly as `providers.ts` already is.
- **Resolution is parallel and honest.** `find_study` asks all four keyless
  providers at once, merges on normalized DOI → arXiv id → folded title
  (keeping the richest record), and ranks: an exact DOI or arXiv-id hint is
  decisive, otherwise title similarity dominates and `citedByCount` breaks
  ties only. `confidence` is `low` when the top two scores are within 10 % or
  the best title similarity is under 0.5. Per-provider failures ride along in
  `errors`, so OpenAlex's metered 429 can never reach the user as "no such
  paper".
- **The scan is cheap first, expensive last.** Filenames are scored for every
  `.pdf` the walk and Spotlight turn up; a budget of 12 candidates then has its
  first 256 KB read and re-scored for byte-level evidence. The budget goes to
  the filename-ranked candidates first and, while any of it is left, to
  candidates whose names scored nothing at all — Zotero, one of the four
  default roots, files everything as `storage/<8 chars>/Full Text PDF.pdf`, a
  name no filename rule matches, so reading only the *top 12 of the ranked
  list* left `doi-in-bytes`, the strongest evidence there is, unreachable for
  exactly the layout that most needs it. Only a regular file is ever opened
  (see the boundary below). Publisher PDFs carry XMP metadata as uncompressed
  XML, so a raw-byte search for the DOI works without a PDF parser. `high`
  confidence requires a byte- or DOI-level hit; a filename-only match never
  exceeds `medium`.
- **`mdfind` is invoked with `execFile` and an argv array** — no shell, so a
  title containing quotes cannot inject.
- **Ordering inside `cite_study`.** The cite key is decided from the
  pre-ladder bib text by a dry-run `appendLitResultToBib`; the ladder then
  runs (a download can take up to 60 s); the file is **re-read fresh**
  immediately before the single append. A slow download therefore cannot
  clobber what the app wrote meanwhile, and the entry's `file` field always
  names the PDF that was actually written. An entry the bibliography already
  has is reused, never duplicated (`findExistingKey`), and left byte-identical.
- **Mirrors before publishers.** Ordered candidates: arXiv, the
  bioRxiv/medRxiv `.full.pdf`, **every open-access location OpenAlex lists for
  the DOI**, a `.pdf` `openAccessUrl`, Unpaywall when a mailto exists, then
  `citation_pdf_url`. First success wins; non-PDF and HTML bytes rejected;
  50 MB cap enforced *while streaming*; at most 3 redirects.

  The OpenAlex rung sits ahead of every publisher rung deliberately, and it
  reads the whole `locations[]` array rather than `best_oa_location` alone.
  Measured 2026-08-18 against ten specimens: reading only `best_oa_location`
  downloaded **4 of 10**, because that field names the *publisher* for most
  works and the publisher is the host most likely to refuse a script. Walking
  every location downloads **8 of 10**. Three concrete cases —
  - MDPI `10.3390/e23010081`: `best_oa_location` is mdpi.com (403), while
    `locations[]` also carries `arxiv.org/pdf/2012.11763` (200, 377 KB).
  - eLife `10.7554/eLife.00013` and Cell `10.1016/j.cell.2020.02.052`: every
    location has `pdf_url: null`, but each lists a PubMed Central landing page
    whose id yields a working PDF.
  - Springer `10.1038/s41586-020-2649-2`: nature.com bounces through an
    identity provider that answers our `fetch` with HTML where it answers curl
    with a redirect; the arXiv mirror sidesteps the question entirely.

  PMC ids are fetched through **europepmc.org**, not ncbi.nlm.nih.gov, which
  serves HTML to a script at the equivalent `/pdf/` path.
- **A failed download says WHY, as a value.** `PdfDownloadOutcome.failure` is
  `'refused'` (a host answered 401/403, or served an interstitial where the
  PDF should be), `'no-open-copy'` (nothing to try), or `'unreachable'`
  (transport, timeout, budget), with `refusedBy` naming the hosts. Both hosts
  render it through one shared `describePdfFailure`, so they cannot drift.
  This exists because a single "download failed" made an honest report look
  like a broken feature: a bronze-OA paper behind Cloudflare is one click away
  in a browser, while a 1972 paper with no open copy is not, and those need
  different sentences. The classification comes from the HTTP **status**, not
  from matching the prose of the error — a substring search for '403' would
  silently reclassify the day someone rewords a sentence.
- **One clock for the whole download, not one per URL.** `downloadPdf` returns
  within `TOTAL_BUDGET_MS` (60 s), full stop: the deadline is created once at
  entry and honoured by both the candidate loop and the redirect loop inside
  `httpGet`. The 20 s hop timeout is a **sub-limit** of that, not a
  multiplier — six candidates × two requests × four redirect hops × 20 s is
  twelve minutes of a wedged `library:acquire-pdf` call or a wedged MCP turn,
  which is precisely what a server answering every hop at 19 s buys. A caller
  may pass an `AbortSignal` to end the call sooner still; the desktop host
  aborts on the requesting window being destroyed, so closing the window stops
  an in-flight fetch. Running out is an ordinary failure string. When every URL
  fails the error names every URL tried **and** every rung that was skipped,
  including the rungs the budget cut off — "Unpaywall was never asked" always
  arrives with its reason.
- **`$SUNA_CONTACT_EMAIL`** joins `SUNA_AGENT_NAME` / `SUNA_AGENT_MODEL` as
  server environment: Crossref's polite pool prefers it and Unpaywall's
  keyless API requires it. Absent, that rung is skipped and the skip is
  *reported* rather than silently dropped.

## The read-outside / write-inside boundary

This is the first SUNA feature that reads files outside the project, so the
boundary is stated where it is enforced, not only here:

- **Reads** may leave the project, but only into roots the user configured
  (defaults are four conventional folders, all under `$HOME`), or through
  Spotlight — which already honours the user's own privacy exclusions. A
  configured root that does not exist is dropped and **reported**, not an
  error.
- **The read boundary is checked against what `open` will reach, not against
  the name.** Roots are realpath-resolved by `expandRoots`, and so is every
  candidate before the containment test (`normalizeCandidate`): `resolve` folds
  away `.` and `..` but never touches a symlink, so `~/Papers/Gunn_1972.pdf`
  → `~/.ssh/id_rsa` passed the test under its own name and was then opened at
  its target. The walk refuses a link outright, a Spotlight hit is replaced by
  its target and must pass the boundary on its own, and a candidate that fails
  is dropped with a note naming both spellings. **Only a regular file is
  opened**: Spotlight indexes bundles, which are directories, and anyone who
  can write into a root can leave a FIFO called `Gunn_1972.pdf` there — a
  directory came back as a `PdfMatch` whose path was a directory, and `open()`
  on a FIFO blocks until a writer appears, which would hang the scan, the IPC
  call and the agent turn behind it.
- **Writes never leave the project.** Every destination goes through
  `resolveInside(projectRoot, …)`: `references/<key>.pdf` and the manuscript
  directory's `references.bib`, nothing else. A path escape is refused, and an
  existing destination is never overwritten — the existing file is returned as
  `already-present` instead.
- **`resolveInside` is a string, so the filesystem is asked as well.** It
  normalizes `..` and rejects an absolute segment and that is all it can do,
  because it never touches disk; a `references/` symlinked out of the project
  passes the lexical test and `mkdir -p` then `copyFile` follow the link. So
  after the directory exists, both it and the project root are
  realpath-resolved and the prefix re-asserted (`prepareReferencesDir`). The
  desktop ladder asks rung 1's question the same way, at **both** levels:
  `already-present` is answered on the resolved file, so a
  `references/<key>.pdf` that is itself a link to `~/Downloads/whatever.pdf`
  comes back as the escape it is instead of stopping the ladder with a claim
  that the project holds a file it does not. (The MCP host answers rung 1 from
  a `references/` listing through `resolvePdfPath` and does not resolve the
  entry — the writes are safe either way, but that report can still name a
  link's own path.)
- **Every URL is gated too, and at every hop.** The ladder exists to follow
  addresses other people wrote — a provider's `openAccessUrl`, Unpaywall's
  `url_for_pdf`, a `Location` header, a `citation_pdf_url` on whatever page
  `https://doi.org/<doi>` reaches — so `httpGet` admits only `http:`/`https:`
  and refuses any host denoting this machine or a private network, on the first
  request and on every redirect. Without it a landing page could aim SUNA at
  `http://169.254.169.254/latest/meta-data/` and, if the answer began `%PDF-`,
  have an internal service's response written into `references/<key>.pdf` —
  and the per-URL failure sentences would report internal ports to the agent.
- **Copy, never move.** The user's library file is left exactly where they put
  it.
- **Nothing found on disk is executed, parsed as code, or treated as
  instructions.** A PDF is bytes to copy and pattern-match, nothing more; the
  shipped agent docs say so in the same words. Its *name* is data too: a tool
  result is the one channel by which third-party disk content reaches a model,
  and a filesystem allows every byte but `/` and NUL in a name, so every
  outside value that `library/scan.ts`, `library/config.ts`, `mcp/lit.ts`,
  `mcp/study.ts` and the desktop host's `services/library.ts`
  put in a note goes through `quoteExternalPath` — `JSON.stringify`, which
  keeps one path on one line and makes where it begins and ends visible — or,
  when the value is a thrown error, through `describeExternalError`, because an
  errno message quotes the path it failed on and so smuggles the same bytes in
  by a second door. A **URL is the same trust class as a file name** and is
  treated the same way: Unpaywall's `url_for_pdf` reaches `sourceUrl` as the
  raw JSON string it arrived as, and `new URL()` — the thing that would have
  dropped a CR or LF — is only ever applied to a copy of it, so a newline in a
  provider's URL survives to the report unless the report quotes it. The
  library roots are quoted too, individually and then joined, even though they
  come from the user's own library.json, and so is `~/SunaConfig/library.json`
  itself, even though `$SUNA_CONFIG_DIR` is this process's own setting — so the
  rule has no exception a later reader has to remember.
- **This ADR keeps no exception list, and the reason it keeps none is worth
  more than any list was.** Three drafts carried one and all three were wrong,
  each in a different direction. The first **under-counted**: "two files still
  interpolate raw, at five sites", when it was three files and six. The second
  went **stale** — those sites were closed and the sentence went on claiming
  raw interpolation that no longer existed. The third named **the wrong
  file**: "the one thing still outside the rule is the desktop `library.ts`",
  written while `packages/agent/src/mcp/lit.ts` — inside the very package the
  rule governs — was outside it too. A sentence that has been false in three
  directions is not one to maintain more carefully; it is one prose should
  stop making. The gate below carries the claim instead, and its guarded set
  *is* the list, reread from the source on every `pnpm test` run, which is the
  one thing a paragraph cannot do. What remains stated here is not an
  exception but a **limit**, and it is the gate's, not the rule's: see the
  three misses named below.
- **The exceptions ended because the rule became followable — not because
  they were argued away.** Both files were outside it for a reason that reads
  as carelessness and was not. The desktop `library.ts` quoted the paths it
  reported but kept a local `describeError` and interpolated
  `outcome.sourceUrl` raw, because `@suna/agent` exported `quoteExternalPath`
  and never `describeExternalError` — `library/scan.ts` re-exported one of the
  pair, `index.ts` passed on what it was given — so the second host, which can
  only import from the package boundary, **physically could not call the
  escaper it was required to use**. Exporting it (both names now leave
  `library/scan.ts` and `index.ts`, and scan.ts's comment says why) removed
  the reason, and the file came under the rule in a few lines. `mcp/lit.ts` was reachable all along — it imports `library/config`
  directly — and was outside for the neighbouring reason: it predates this
  feature, which reused it, so no rule sentence named it and no gate read it.
  The durable lesson from the first and the check against the second: **an
  invariant that some callers cannot satisfy will be violated by exactly those
  callers**, and their violations will look like local sloppiness right up
  until somebody asks whether the tool was reachable. So when exceptions
  cluster on one side of an import boundary, suspect the boundary before the
  authors; and when a rule is written as a list of files, expect to be wrong
  about the file nobody thought of.
- **A test holds the escaping rule, because people demonstrably did not.**
  `packages/agent/src/external-paths.test.ts` reads the source of those five
  files and fails on four things: (1) an interpolated expression whose
  spelling contains a path-ish word — `path`, `dir`, `root`, `file`, `name`,
  `target`, `relative`, `absolute`, `configured`, `claimant`, `url`, `source` —
  and is not wrapped in an escaper; (2) any hand-rolled description of a thrown
  value — `instanceof Error`, `String(error)`, `error.message`; (3) any call
  to the raw `describeError`, save the lines where `describeExternalError`
  wraps it; (4) a path-ish value concatenated onto a string literal, since a
  report line built with `+` reaches the same reader as one built with a
  template. Rules 2, 3 and 4 are checked per call site rather than per
  interpolation, because rule 1's shape is one hoist away from silence —
  `const why = describeError(e)` on one line and `${why}` on the next was
  exactly the live shape in `expandRoots`, and mutation-testing the gate showed
  rule 2 had the identical hole while it matched only the full ternary inside a
  template. It lexes rather than greps: comments, strings and regex literals
  are skipped and nested templates are recursed into, so an escaped outer
  expression cannot hide an unescaped inner one.

  **What the gate does not catch** — recorded here as well as in the file's own
  header, so it is read rather than rediscovered. It is a tripwire over source
  text, not a parser: it knows no types, and it decides both "this is a path"
  and "this is a thrown value" from the *spelling* of an identifier. Three
  misses follow from that, and each is left open deliberately because closing
  it needs a parser:

  1. **A concatenation split across lines.** Rule 4 reads one line at a time,
     so `` `…` + `` with its second operand on the next line is never
     examined — a live shape in `scan.ts`, not a hypothetical. The single-line
     form (`lines.push('skipped ' + filePath)`) is covered.
  2. **A thrown value bound to a name without `err` in it.** `catch (e) { …
     e.message … }` reads as clean to rules 2 and 3.
  3. **A value laundered through a variable.** Rules 2, 3 and 4 are call-site-
     wide precisely because that hoist was a live shape here, but rule 1 is
     still interpolation-shaped: `const note = filePath` on one line and
     `${note}` on the next passes.

  Each was found by mutating the gate and watching it stay green, and each is
  a miss rather than a false pass on the code as it stands — the five guarded
  files are clean under a hand read too. A gate whose blind spots are written
  down can be trusted for what it does cover; one that implies total coverage
  invites exactly the three wrong sentences above.

  **The allow-list is the review surface.** Not every path-ish expression needs
  escaping — `REFERENCES_DIR` is our own constant — so the gate carries a short
  list of named exemptions, each with a one-line reason and optionally scoped
  by the surrounding template text. That scoping is what lets
  `outcome.relativePath` stay exempt in the `copied-local` and `downloaded`
  arms, where the value is ours, while the `already-present` arm — the one fed
  by a `references/` readdir entry — stays guarded. Two further tests keep the
  list itself honest: one fails when an entry stops matching anything, so a
  stale exemption cannot sit there unread, and one fails when an entry names a
  file the gate does not read, since an exemption from nothing reads as a
  decision without holding one.

  An exemption can also be **true and still not worth keeping**, and the
  config path is that case. `libraryConfigPath(env)` really is this process's
  own location, but `$SUNA_CONFIG_DIR` is an environment variable and a home
  directory is a directory name, and the library roots two lines away are
  quoted though the user typed them; one call to `quoteExternalPath` buys a
  rule with one reading. The entry came off — and the gate immediately
  reported two raw `${path}` sites in the same file that the exemption had
  been covering, which is the argument in one move.

  **Why it exists**, for the reader who arrives later and wants to delete a
  crude regex test: five review passes over this feature, already finished and
  already green, each found unescaped sites — 6, then 5, then 2, then 6, then
  4. That is not a sequence that converges, and not one of those sites was
  exotic. Each was somebody writing a helpful error message about a value that
  happened to be a name somebody else chose. The fifth pass's four were all in
  the two files the gate did not yet read, which is why the guarded set now
  names both hosts of the ladder rather than one package's directory. The gate
  is openly a tripwire and not a parser — see the three misses above — and is
  worth keeping anyway, because the ordinary way of getting this wrong,
  writing `${somePath}`, can no longer reach main unnoticed. Deleting it
  restores precisely the condition that produced twenty-three unescaped sites
  in five passes.
- **No paywall circumvention** — see *Rejected*.

That combination is what makes the widened read surface safe: the search is
bounded by user consent (the roots), the write surface did not widen at all,
and nothing crosses from data into behaviour.

## Why `~/SunaConfig/library.json` and not userData

The roots, the Spotlight toggle and the download policy live in
`~/SunaConfig/library.json` (`$SUNA_CONFIG_DIR` overrides), beside the
`Context/` layer ADR-004 put there — **not** in the app's
`userData/settings.json`. The standalone MCP server runs without Electron and
therefore has no userData path at all; if the configuration lived there, an
agent session outside the app would scan a different set of folders than the
Settings pane shows, or none. One machine-level file means the pane the user
edits and the server that does the scanning are describing the same machine.
Roots are stored `~`-prefixed and expanded only at use time, so the file stays
portable and carries no machine-specific absolute paths.

## Why low confidence refuses to write

`cite_study` writes nothing — no bib entry, no PDF — when the resolution is
`low`. It returns the alternatives with their DOIs and asks to be re-run with
one of them.

Guessing is the one thing this feature must not do. A citation is an
attribution: wrong, it reads as a fact, propagates through the reference list,
and survives into print, where the cost of correcting it is a published
erratum. The cost of *not* guessing is one question to the user. A "helpful"
top-hit pick would also be invisible — the bibliography would look exactly as
correct as a right answer. So ambiguity is surfaced as ambiguity, in the
report and in `WORKFLOW.md`'s playbook, which tells the agent to show the
alternatives and ask.

## Why a `medium` local match needs corroboration

The same honesty rule runs the other way, and it was **tightened on
2026-08-18**. It first read: a `low`-confidence local file match is named in
the report but never auto-copied, and only `high` and `medium` matches are
brought into the project. That was too generous by exactly one rung. A lone
`filename-author-year` hit is a `medium` all by itself, and a bare "Smith
2020" in a filename names *every* paper Smith wrote in 2020 — so the ladder
would copy whichever Smith 2020 happened to be in `~/Downloads`, file it under
this cite key, and the mistake would surface at submission. That is the same
guess the section above refuses to make about a citation, made about the PDF
instead, and it is worse for being invisible: the reference list looks exactly
as correct as a right answer.

**Decision:** a local file is copied *unasked* only when the match is `high`,
or `medium` corroborated by a **second, distinct evidence id**. Two
independent facts agreeing is a different claim from one ambiguous fact.
`high` is safe by construction — `pdf-match.ts` reaches it only on
identifier- or byte-level evidence (the DOI in the file's own bytes, an arXiv
id, a Spotlight content hit).

Everything else — every `low` match, and an uncorroborated `medium` — is
**named in the report with its path and its evidence** and copied only when
someone accepts it deliberately: `fetch_pdf {"citekey": …, "accept": "<that
path>"}`. Only a path *that scan itself reported* may be accepted; any other
is refused and the refusal says so, so "accept" cannot become a way to copy an
arbitrary file into the project. The copy is then reported as accepted by
name — "copied because it was asked for, not because the evidence was enough"
— rather than as an ordinary `copied-local`.

The rule is one exported function, `isAutoCopyable` in
`packages/agent/src/library/scan.ts`, and it lives beside the scan rather than
in either host **because both hosts gate on it**. While it was private to
`mcp/study.ts`, the desktop References view asked the looser question
`confidence !== 'low'` and silently copied in the lone `filename-author-year`
match the MCP verb deliberately refused: the same feature answering the same
question two ways depending on which button the user pressed.

## Drift gates

`packages/agent/src/context/context.test.ts` pins `MCP.md`'s verb table equal
to the `TOOLS` registry and `packages/agent/src/context/docs.gen.ts`
byte-identical to a fresh `node scripts/gen-suna-context.mjs`. The table is
compared three ways, each rung added because the looser check let something
through:

- **verb names as sorted arrays, not sets** — a `Set` comparison waved a
  duplicated row through, so an `MCP.md` listing `cite_study` twice (24 rows
  against 23 verbs, reading to an agent as two different verbs) shipped green;
- **the advertised count**, now 23;
- **per row, the input names and their `?` markers**, read off the verb's own
  zod schema by asking whether the field accepts `undefined`. `fetch_pdf`
  gained `accept` — the only way a human can take a match too weak to copy
  unasked — while its row went on saying `{citekey?, doi?, policy?}`, and an
  input MCP.md does not document is an input no agent will ever send: the
  ladder kept reporting candidates it refused to copy while the escape hatch
  was invisible.

Adding a verb, or an input to an existing one, without teaching it in the
shipped docs fails `pnpm test`; so does editing the source docs without
regenerating.

## Accepted simplifications

- **Spotlight is macOS-only** and simply absent elsewhere. The bounded walk is
  the portable path and answers on its own; the missing index is a `note` in
  the report, not a degraded mode the user has to reason about.
- **No PDF parser.** Byte evidence is a raw ASCII search of the first 256 KB.
  It finds the DOI in uncompressed XMP metadata and misses a fully-compressed
  file — which then scores `medium` on its filename instead of `high`. It is
  still offered, and still copied unasked when the name carries two
  independent evidence ids (Zotero's `Gunn and Gott - 1972 - On the infall of
  matter into clusters of galaxies.pdf` is author-year *and* title words);
  when the name gives only one, it becomes a candidate to accept rather than a
  copy. See *Why a `medium` local match needs corroboration*.
- **No content hashing or dedupe across the library.** Two copies of the same
  paper in two roots are two matches, ranked; the user's file is never
  touched, so there is nothing to reconcile.
- **The scan is not incremental and keeps no index.** `maxFilesScanned`
  (default 20 000) and `maxDepth` (default 6) bound it, and hitting the cap
  sets `truncated` in the report rather than silently returning less.
- **`references/` is a fixed name**, as it already is for `resolvePdfPath`'s
  citekey rule — an acquired PDF lands exactly where the existing resolver
  looks for it.

## Rejected

- **Scanning the whole home directory** (or worse, the whole disk). It would
  read mail attachments, Desktop archives and every synced work folder to find
  one paper, and the user never asked for any of that. Bounded, named roots
  make the read surface something the user can see in Settings and revoke.
- **Sci-Hub, institutional proxies, credential replay, or any other paywall
  circumvention.** SUNA is a tool researchers run on their own machines
  against their institution's access; shipping a bypass would make the app a
  liability to the people it is for. The download ladder stops at open access
  and the publisher's own advertised `citation_pdf_url`, and a 403 is reported
  as a 403 — `metadata-only` is an honest outcome, not a failure to route
  around.
- **Silently picking the top hit** when the mention is ambiguous. See *Why low
  confidence refuses to write*: the failure is invisible and permanent, and
  the alternative — naming the candidates and asking — costs one message.
