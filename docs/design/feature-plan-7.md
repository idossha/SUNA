# Feature plan 7 — flat manuscript, authors.json, tab-opens-manuscript, project switcher

Requested 2026-08-15. **No smoke suite for this work** (user tests manually).
Gates are `pnpm typecheck`, `pnpm test`, and `pnpm --filter @suna/desktop build`;
tests broken by the schema change are updated, not skipped.

## 1. One manuscript file, flat directory (breaking change)

**Today**: `manuscript/manuscript.json` holds a `body` array whose nodes point
at `manuscript/sections/NN-name.md`; authors and affiliations live inside
`manuscript.json`.

**Target layout** — `manuscript/` is flat, exactly four files:

```
manuscript/
  manuscript.md        # the entire prose; sections are Markdown headings
  manuscript.json      # metadata (no authors, no body paths)
  authors.json         # authors + affiliations
  references.bib
```

### Schema changes (`@suna/core`)

- **`ManuscriptSchema`**: drop `body` (and `SectionNode`/`BoxNode` path
  plumbing). Keep title, shortTitle, articleType, doi, openAccess, history,
  abstract, significance, highlights, figures, tables, availability,
  backMatter, bibliography. Add `manuscriptFile` defaulting to
  `"manuscript.md"` so the name is data, not a constant scattered in code.
- **New `AuthorsFileSchema`** (`manuscript/authors.json`):
  `{ schemaVersion: 1, authors: Author[], affiliations: Affiliation[] }`
  reusing the existing `AuthorSchema`/`AffiliationSchema` verbatim so nothing
  about ORCID/corresponding/equal-contribution changes.
- **Sections become derived, not stored.** Add a pure
  `outlineFromMarkdown(md): { level, title, from, to, words }[]` in
  `@suna/core` (or `@suna/markdown` if that is the better home) built on the
  existing SciMark parser — it must ignore `#` inside fenced code, and treat
  the text before the first heading as an untitled leading section (the
  demo's intro has no heading and must not vanish).

### Migration (must be automatic and safe)

A project opened with the old layout is migrated on open:

1. Concatenate `body` sections **in order** into `manuscript.md`, emitting
   each node's heading at its level (`A`→`#`, `B`→`##`, `C-runin`→`###`) and
   omitting a heading for `heading: null` nodes.
2. Move `authors` + `affiliations` into `authors.json`.
3. Rewrite `manuscript.json` without `body`/`authors`/`affiliations`.
4. Delete `sections/` **only after** the new files are written and validated;
   never lose prose. If anything fails, leave the project untouched and
   report.
5. Migrate `comments.json` targets: `{kind:'section', path:'sections/x.md'}`
   → `{kind:'section', path:'manuscript.md'}`. Anchors are quote-based so
   they re-locate themselves; a comment whose quote no longer matches becomes
   `detached` rather than being dropped.
6. Migration is idempotent — opening an already-flat project does nothing.

Also migrate `examples/demo-paper` in the repo (as a committed change, so the
shipped example is already flat).

### Everything that reads sections must follow

`docx-import` (writes one `manuscript.md` instead of many), export (docx/pdf
build from the single file + outline), the combined manuscript tab (ONE
editor, not one per section), the Manuscript sidebar outline (from the
derived outline, with scroll-spy against heading positions), word counts,
`useCitedKeys`, and the MCP verbs (`read_section`/`write_section` become
`read_manuscript`/`write_manuscript`; keep the old names as thin aliases that
operate on the whole file so an agent mid-session does not break).

## 2. Manuscript tab opens the manuscript

Remove the "Open full manuscript" button. Activating the Manuscript view in
the activity bar opens (or focuses) the manuscript document tab directly, and
the sidebar keeps showing the outline + metadata summary for navigation.

## 3. Project switcher in the title bar

The title bar currently shows `SUNA · <project name>` as static text. Make the
project name a button opening a menu with:

- **Recent projects** (from the existing `project:recents`, max 8, each with
  its parent path; a missing one is dimmed with a Remove action)
- separator
- **Open project…** (existing picker)
- **New project…** (opens the onboarding wizard)
- **Open example**

Switching projects from here must fully re-point the app: project store,
comments, reference PDFs, settings resolution, and open tabs (close
project-scoped tabs rather than leaving stale editors pointing at the old
directory). With no project open the button reads "Open project".

## Constraints

- The prose file is the source of truth; migration must never lose text.
- Keep every existing capability working: live preview, margin comments,
  citations/cross-refs, export, compliance.
- No smoke suite; keep typecheck, unit tests, and the desktop build green.
