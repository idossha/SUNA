# Feature plan — editable title page, comments, canvas parity, literature search

Four features requested 2026-08-14, with a reference screenshot of flux's
canvas right rail. Ground truth was probed before writing (see §4.0).

---

## 1. Editable title page → writes manuscript.json

Today the title page renders read-only from `manuscript.json`; the only way to
change an author is to hand-edit JSON.

**Scope.** In the combined manuscript tab, the title page becomes an editing
surface for: title (LaTeX math allowed), shortTitle, articleType, authors
(given, family, ORCID, email, corresponding flag, equalContribution,
affiliation membership, order), affiliations (text, order), abstract,
significance, highlights (list).

**Interaction.** Click a field → inline edit in place (contenteditable/input
sized to the field, matching the rendered typography). Authors and
affiliations get a compact editor: rows with drag-to-reorder, add/remove,
and an affiliation multi-select per author. Escape cancels, blur/⌘Enter
commits. Nothing is a modal.

**Persistence rules (important).**
- Every commit re-reads `manuscript.json` from disk, applies the single field
  change to that fresh object, validates with `ManuscriptSchema`, and writes
  atomically (temp + rename). Never write a stale in-memory copy: the file is
  the source of truth and an agent may have edited it.
- Invalid input (e.g. a malformed ORCID) shows an inline error and does NOT
  write. Superscript markers renumber automatically because they are derived,
  never stored.
- Writes are debounced ~400 ms and coalesced per field; a save bumps the
  project store so every view refreshes.

**Acceptance.** Rename an author in the UI → `manuscript.json` on disk shows
the new name and remains schema-valid; affiliation superscripts renumber when
an affiliation is reordered; an invalid ORCID is rejected with a visible
message and leaves the file untouched.

---

## 2. Comments — for humans and agents

Model after the pattern already documented in `flux-review.md`: comments are
**sidecar data, never inline prose markers**, so the manuscript text stays
clean and diffable.

**Storage.** `manuscript/comments.json`, schema in `@suna/core`:

```jsonc
{
  "schemaVersion": 1,
  "comments": [{
    "id": "c-2026-08-14-a1b2",
    "target": {                        // discriminated union
      "kind": "section",               // | "figure" | "manuscript"
      "path": "sections/02-results.md",
      "anchor": {                      // W3C-style quote anchor
        "quote": "best-fit centroid of 6563.3",
        "prefix": "…with a ", "suffix": " Å and σ…"
      }
    },
    "body": "Should this be the vacuum wavelength?",
    "author": { "kind": "human", "name": "Ada" },   // or "agent" + model id
    "createdAt": "2026-08-14T21:03:00Z",
    "resolved": false,
    "replies": [ { "id": "…", "body": "…", "author": {…}, "createdAt": "…" } ]
  }]
}
```

**Anchoring.** Re-locate by exact quote first, then prefix/suffix context,
then fuzzy (normalized whitespace). If no match: mark the comment
`detached: true` and keep it — never delete, never silently move.

**UI.** A Comments sidebar view (new activity-bar entry): filter
all/open/resolved/mine, click to scroll to the anchor. In reading mode the
anchored text carries a subtle highlight and a gutter dot; selecting text
offers "Comment" (⌘⇧M). Replies inline; Resolve toggles. Agent-authored
comments are visually distinct (accent, model name).

**Agent access (this is the point).** New MCP tools: `list_comments`
(filterable), `add_comment` (target + anchor + body), `reply_comment`,
`resolve_comment`. An agent asked to "review the Results section" leaves real
anchored comments the human sees in the app; the human replies and the agent
reads the thread. Comments authored by agents carry `author.kind: "agent"`.

**Acceptance.** Select text → comment → it appears in the panel, the file
gains an entry, and the anchor highlights. An MCP `add_comment` call from a
CLI shows up in the panel after refresh. Editing the manuscript around the
anchor keeps the comment attached; deleting the quoted text marks it detached
rather than dropping it.

---

## 3. Canvas parity with the flux reference rail

From the screenshot, in priority order. Our engine already implements the
commands for items 1–3 (align/distribute/set-artboard exist and are tested);
this is mostly UI.

1. **Align & distribute panel** — 6 align buttons (left/center/right,
   top/middle/bottom) + Distribute H/V, wired to the existing `align` and
   `distribute` commands, disabled with a hint when < 2 (align) or < 3
   (distribute) elements are selected.
2. **Rulers** — horizontal/vertical rulers with ticks in **mm** (our artboards
   are physical), labels every 10 mm, live cursor position marker, origin at
   the artboard's top-left. Toggleable.
3. **Figure panel** — artboard X/Y/W/H in user units with a live
   `= W × H mm` readout (uses the existing artboard/mm mapping), background
   color, "Duplicate figure" (copies the figure directory + registers a new
   id in manuscript.json), and **"Auto-letter panels (a, b, c)"** which
   inserts bold panel letters at each axes group's top-left using the active
   profile's panel-label convention (case/weight/wrapper) — a single
   `batch` command so one undo reverts it.
4. **Palette section** — organized swatch ramps with a **Fill / Stroke**
   toggle and a "No fill" chip, seeded from the active journal profile's
   suggested palette (Wong for Nature) plus neutral ramps; clicking applies to
   the selection. "Import palette…" reads a `.json`/`.gpl` list of hexes into
   the project.
5. **Export section** — SVG (copy of the source, byte-identical), PNG, and
   PDF for the current figure, written into the project's `output/` dir.
6. **Journal-spec raster** — width preset dropdown built from the *active
   profile's* `figureRules.widthPresetsMm` (e.g. "Double column (180 mm)" for
   Nature — not flux's hardcoded 190), resolution dropdown (300/600/1200 dpi,
   defaulting to the profile's `minDpi`), transparent-background checkbox, a
   live `W × H mm @ N dpi · P×Q px` readout, and TIFF/PNG buttons.
   - PNG/TIFF are produced by rasterizing the SVG at the exact pixel size
     (renderer: `Image` from an SVG blob → offscreen canvas at target px →
     `toBlob`), then written through IPC. TIFF uses a baseline uncompressed
     encoder over the RGBA buffer (no dependency).
   - PDF via the main process (`printToPDF` on a hidden window sized to the
     artboard in mm) — vector-preserving.
   - The export runs the compliance checker first and warns (never blocks) if
     the figure violates the profile.

**Acceptance.** Two shapes align to the left edge with one click and one
undo restores; rulers show mm matching the artboard readout; auto-letter adds
`a`/`b` to the two-panel demo figure at profile-correct weight; PNG export at
180 mm/300 dpi produces a file whose pixel dimensions match the readout.

---

## 4. Literature search (OpenAlex + working alternatives)

### 4.0 Ground truth probed 2026-08-14 (do not assume otherwise)

| Service | Result from this machine |
|---|---|
| **OpenAlex** | **HTTP 429** — `"Insufficient budget… Add funds at openalex.org/pricing"`. It now meters requests; keyless use is not dependable. |
| **Crossref** | **Works, keyless** (`status ok`, 1,089,390 hits for the test query) with a polite `User-Agent`/`mailto`. |
| **NASA ADS** | 401 without a key; free key on request. The best source for astronomy. |
| **Semantic Scholar** | 429 without a key. |
| **arXiv** | Empty response from this network; treat as best-effort. |

### Design

A **provider abstraction** in `@suna/bib` (or a new `@suna/lit`):
`search(query, opts) → LitResult[]`, `byDoi(doi) → LitResult`,
`related(id) → LitResult[]`. Implementations: `crossref` (default, keyless),
`openalex` (used when the user supplies a key/has budget), `ads` (when the
user adds their free key), `arxiv` (best-effort). All network calls happen in
the **main process** (no renderer CORS/CSP issues), keys stored with the
existing `safeStorage` mechanism.

`LitResult`: `{ source, id, doi, title, authors[], year, venue, citedByCount,
openAccessUrl, abstract? }` — normalized across providers.

**Errors are surfaced honestly**: a 429 renders "OpenAlex is rate-limited or
out of budget — add a key in Settings, or use Crossref" with the provider
switch inline. Never an empty result list pretending nothing matched.

**UI.** The References view gains a **Search** tab: provider selector, query
box, result cards (title, authors, year, venue, citations, OA badge), and
per-result actions: **Add to references.bib** (converts to a BibTeX entry with
a generated cite key `firstauthorYEARword`, deduped against existing keys),
**Copy DOI**, **Open**. Plus "Find similar" on an existing bib entry.

**Agent access.** MCP tools `search_literature(query, provider?)`,
`lookup_doi(doi)`, `add_reference(doi | result)` so an agent can research and
populate the bibliography, and the human sees entries appear in the panel.

**Acceptance.** A Crossref search for "ram pressure stripping" returns results
in the panel without any key; adding one writes a valid entry to
`references.bib` that `parseBibtex` round-trips and the Cited/Uncited filter
counts as uncited; OpenAlex without budget shows the honest rate-limit
message; an MCP `search_literature` call returns the same normalized results.

---

## Constraints for all work

- `manuscript.json`, `comments.json`, `references.bib`, `figure.svg` remain
  the sources of truth; every write is validated then atomic.
- No silent rewriting of author content; comments never touch prose.
- Tests at the level the logic lives; anything only observable in the app gets
  a smoke step.
- Gates: `pnpm typecheck && pnpm test && pnpm smoke` all green.
