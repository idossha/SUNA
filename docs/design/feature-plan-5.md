# Feature plan 5 — recents, typography defaults, true live preview, onboarding & settings hierarchy

Requested 2026-08-15.

## 0. Current state (verified in code before writing)

- `editor/settings.ts` defaults: `fontSizePx: 16`, `lineHeight` (bounds
  1.4–2), `contentWidthCh: 68`.
- `editor/livePreview.ts` **dims** markdown syntax with a `cm-lp-syntax`
  class — `##` and `**` stay visible. The cursor-reveal machinery already
  exists for math/citations/tables; headings and emphasis simply never used
  it.
- Global settings live in `userData/settings.json` (`settings:get/set`).
  Project identity lives in `suna.json` (`SunaProjectManifestSchema`:
  schemaVersion, name, activeProfileId, directories, createdAt).
- The welcome screen has three buttons and no history.

---

## 1. Recent projects on the welcome screen

- Global settings gain `recentProjects: [{ path, name, lastOpenedAt }]`,
  capped at 10, most-recent first, deduped by path. Written on every
  successful `project:open` / `project:create` / example open.
- Welcome screen lists them under the actions: name, dimmed parent path,
  relative time ("2 hours ago"). Click opens. Keyboard reachable.
- A path that no longer exists renders dimmed with a "Missing" tag and a
  **Remove** action; opening it fails gracefully and offers removal (never a
  silent no-op).
- Empty state keeps today's copy.

**Acceptance**: creating a project then reopening the app lists it first;
opening a listed project restores it; deleting the directory outside SUNA
shows the Missing state and Remove clears it from settings.

## 2. Typography defaults

`fontSizePx: 14`, `lineHeight: 1.6` as the shipped defaults, in the editor
settings store *and* in the global-settings defaults (§4), so a fresh install
and a fresh project agree. Existing users' persisted values are untouched —
this changes defaults, not stored preferences.

**Acceptance**: with settings cleared, a markdown tab computes 14px font and
1.6 line-height; the Settings page shows those as the defaults.

## 3. True live preview — hide markdown syntax

Today's behaviour dims `##` and `**`; the requirement is Flux/Obsidian
behaviour: **render the result, reveal the source only where the cursor is.**

- **Headings**: `## Results` displays as a styled *Results* — the `##␣` is
  `Decoration.replace`d (zero-width), not dimmed. The existing `cm-lp-h{n}`
  line class keeps the size/weight.
- **Emphasis**: `**bold**` → **bold** with both `**` runs replaced;
  `*italic*`, `_italic_`, `~~strike~~`, and `` `code` `` likewise.
- **Reveal rule** (identical contract to math, so the editor feels
  consistent): the marks reappear when the selection intersects the
  *formatting node's range*, extended to the whole line for headings — so
  putting the cursor in a heading shows `## Results` and moving away
  re-renders. Multi-cursor: any cursor inside reveals that node.
- **Lists and blockquotes**: bullet `-`/`*` markers and `>` render as their
  glyph via a replace-widget (a proper bullet, a quote bar), same reveal
  rule. Ordered-list numbers stay literal (they carry meaning).
- **Links**: `[text](url)` shows *text* styled as a link; the URL reveals on
  cursor entry. Bare autolinks stay as-is.
- **Nothing is destructive**: this is decoration only — the file always holds
  the markdown, and turning the mode off shows it verbatim.
- **Escapes**: `\*not emphasis\*` and content inside code fences/inline code
  must not be transformed (the existing `exclude` ranges already carry code;
  extend, do not bypass).

**Acceptance**: with the cursor elsewhere, no `#` or `*` characters are
visible in a rendered section (assert the rendered text of a line equals the
plain text); clicking into the heading line shows `## ` again and moving away
hides it; the file bytes never change from any of this; ⌘B still round-trips.

## 4. Settings hierarchy: global vs project

**Two levels, one resolver.**

- **Global** (`userData/settings.json`) — app-wide and **only editable from
  the Settings page**: appearance defaults (font size, line height, content
  width, theme), default editor mode, vim, terminal shell, interface scale,
  AI/literature provider keys and preferences, `recentProjects`, onboarding
  "don't show again" flags.
- **Project** — lives in the project directory as **`suna.json`**, extended
  with an optional `settings` block. This is the "json file in the project
  dir" the user edits by hand; because it is JSON with a schema, the existing
  schema-aware linting already validates it live in the editor. Project
  settings hold: `activeProfileId` (already there), preview/render profile,
  editor overrides (width/font/line-height/mode), figure defaults, python env
  path, literature provider preference, and per-project AI settings.
  (YAML is deliberately not introduced: a second config format would mean a
  second parser, a second schema surface and a second lint path for no gain —
  recorded as a decision, revisit if the user wants it.)
- **Resolver**: `resolveSetting(key)` = project value ?? global value ??
  built-in default. Every settings control in the UI shows its **source**
  ("from project" / "from global" / "default") and project-level ones offer
  "Reset to global".
- Changing a project setting writes `suna.json` through the same
  read-validate-atomic-write path as `manuscript:update`; changing a global
  setting goes to `settings:set`. Neither ever writes the other.
- Watch `suna.json` for external edits (the user typing in it, or an agent)
  and re-resolve live.

**Acceptance**: setting content width in a project changes only `suna.json`
and the Settings page shows "from project"; Reset to global removes the key
and the value falls back; editing `suna.json` by hand in the editor
re-resolves without restart; an invalid value lints in the editor and is
rejected by the writer.

## 5. Onboarding — new project wizard

A guided flow replacing today's "pick a folder" for **New project** (Open
existing is unchanged). Full-tab, seven steps, back/next, Escape cancels,
nothing is written until the final step.

1. **Where & what** — parent directory picker + project name; shows the exact
   path to be created and validates it (empty/exists/not writable) live.
2. **Target journal** — the four bundled profiles as cards showing their
   headline rules (citation style, figure widths, word limits) sourced from
   the profile JSON; "Decide later" is allowed and sets `nature-astronomy`
   with a note.
3. **What to scaffold** — Blank (dirs + empty manuscript), Starter (a
   one-section manuscript with a demo figure script), or **Import existing**
   (point at a folder of `.md`/`.tex`/`.bib` and copy them in).
4. **Python environment** — detect existing envs in the chosen location
   (reuses `env:detect`), offer "create with uv" (runs `uv venv`, reported
   honestly if uv is missing), or skip.
5. **AI** — three cards: **Agent CLI** (detected `claude`/`codex`, "uses your
   subscription", the recommended default), **API key** (provider + key,
   stored in the keychain), or **Skip**. Writing `.mcp.json` is offered here
   with a one-line explanation.
6. **Defaults** — editor mode, theme, font size, line height, content width,
   seeded from global; a checkbox writes them as *project* settings rather
   than global.
7. **Review** — shows the directory tree that will be created and the exact
   `suna.json` to be written, then **Create project**. Progress is reported
   per step (dirs → files → git init → env → mcp), and a failure leaves a
   clear message plus whatever succeeded (never a half-state with no
   explanation).

Also: a **"Set up project"** entry point for an existing project missing
`suna.json`, running steps 2–7 against it.

**Acceptance**: the wizard creates exactly what its Review step showed; all
files schema-valid; git initialized with one commit; cancelling at any step
writes nothing; a name colliding with an existing directory is blocked at
step 1 with a visible reason.

---

## Constraints

- No new config format (see §4); `suna.json` stays the single project file.
- Live preview is decoration-only: the markdown file is never rewritten.
- Pure logic (settings resolver, recents dedupe/cap, wizard validation,
  reveal-range computation) gets unit tests; anything only observable in the
  app gets a smoke step.
- Gates: `pnpm typecheck && pnpm test && pnpm smoke` green.
