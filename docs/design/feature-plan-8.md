# Feature plan 8 — "?" shortcut help, directed AI actions

Requested 2026-08-17. Gates: `pnpm typecheck`, `pnpm test`,
`pnpm --filter @suna/desktop build`, hidden-driver probes
(`scripts/e2e/probes/`), and the new unbilled smoke steps. Billed legs
(a full agent run completing an edit) are measured by hand once and
recorded in TESTING.md, like steps 47/54.

Two empirical facts this plan is built on (measured 2026-08-17,
Claude Code 2.1.233, against the drive example copy):

1. **Headless MCP works with explicit flags.** `claude -p … --output-format
   json --mcp-config .mcp.json --allowed-tools "mcp__suna__list_outline"`
   called the real bundled suna server and returned the demo outline
   (159/97/117/214 words). Without `--mcp-config`/`--allowed-tools` the
   headless CLI has no MCP and no write tools — the current `ai-ask.ts`
   spawn passes neither, which is why directed actions extend it.
2. **`claude -p` reads the prompt from stdin** when no positional prompt is
   given (`echo … | claude -p --output-format json` → answer). Directed
   actions deliver prompts via stdin: no argv size limit, and the prompt
   text does not appear in `ps` (see §7 for the cancel-step consequence).

The Flux precedents adapted here (see `~/01_production/flux`): the `?`
overlay (`Help.svelte` — static sections keyed by surface id, isTyping
guard, focus save/restore), the feedback stamp (structured context captured
at the moment of the ask), and reader send-to-agent prefix templates.

## 1. "?" — keyboard-shortcut overlay

New files `apps/desktop/src/renderer/src/shell/help/HelpOverlay.tsx`,
`shell/help/sections.ts`, `shell/help/help.css`.

- **Data** (`sections.ts`): `SECTIONS: { id, label, groups: { title,
  items: [keys, description][] }[] }[]` with ids `global | editor |
  manuscript | canvas | explorer | viewers`. Content = the Appendix table
  below, verbatim — it was inventoried from the code and cross-checked
  against TESTING.md; do not invent bindings. Include the §3–§5 AI actions
  in their surfaces' sections. Export pure
  `sectionForSurface(surface: string | null, explorerFocused: boolean):
  string` mapping dock component kinds → section ids (`canvas→canvas`,
  `manuscript→manuscript`, `editor→editor`, `pdf|image|dataview→viewers`,
  anything else→`global`; explorerFocused wins with `explorer`). Unit-test
  ids unique, every group non-empty, and the mapping table.
- **Open/close**: window `keydown` listener owned by the overlay: fires on
  `event.key === '?'`, bails on `event.defaultPrevented`, on
  ⌘/⌃/⌥ modifiers, and on an `isTyping(event.target)` guard
  (INPUT/TEXTAREA/`isContentEditable` — CodeMirror content is
  contenteditable, so typing `?` in any editor, and vim's `?` search, never
  open it). Esc closes (dialog-level `onKeyDown`). Focus moves into the
  dialog on open and is restored on close (Flux pattern). Do NOT register
  `?` as a `Command.shortcut` — the palette dispatcher has no isTyping
  guard and matches by `event.code`, so a `Shift-Slash` command would fire
  while typing `?` into e.g. the explorer filter.
- **State**: `helpOpen` + `setHelpOpen` on `state/ui.ts` (`useUiStore`).
- **Initial tab**: on open, read the active surface — new exported helper
  `activePanelComponent(): string | null` in `state/dock.ts` (the
  `dockApi.activePanel?.view.contentComponent` expression already used
  internally at dock.ts:18/27/187) — plus `document.activeElement` inside
  the explorer tree for `explorerFocused`; feed `sectionForSurface`.
- **Mount**: `App.tsx`, after `<CommandPalette/>`, before `<Toasts/>`;
  backdrop/dialog per palette conventions (`.palette-backdrop` idiom,
  z-index 200, `role="dialog" aria-modal="true"`, backdrop mousedown
  closes, inner stopPropagation). Root class **`help-overlay`**, tab
  buttons `help-overlay__tab`, rows render `<kbd>` + description like
  Flux. Footer legend: "⌘ = Cmd · ⌃ = Ctrl · ⌥ = Option · ⇧ = Shift".
- **Entry points**: the `?` key; a `?` chip in the StatusBar right cluster
  (`shell/StatusBar.tsx`, next to Terminal/Settings, title "Keyboard
  shortcuts (?)"); palette command `help.shortcuts` ("Keyboard
  Shortcuts…", category View, NO shortcut spec) in `state/commands.ts`.

## 2. Directed AI actions — shared plumbing

One runner, three entry points (§3 comment, §4 figure, §5 repair). All
run the agent CLI headless via `ai-ask.ts` with per-action tool
allowlists; results land in the Agent transcript via
`pushExternalExchange` on success; progress/cancel state lives in a store
so cards/panels can unmount freely.

### 2a. `ai-ask.ts` extensions (main)

`AiAskOptions` gains `allowedTools?: string[]`, `useMcp?: boolean`,
`viaStdin?: boolean`. Claude spawn: when `viaStdin`, drop the positional
prompt (`['-p', '--output-format', 'json', …]`), `stdio[0] = 'pipe'`,
write the prompt then `stdin.end()`; when `useMcp` and
`<dir>/.mcp.json` exists, append `--mcp-config <abs .mcp.json>`; when
`allowedTools` non-empty, append `--allowed-tools <joined by comma>`
(one argv element, the CLI accepts comma/space-separated). The codex path
is UNCHANGED — codex asks run `--sandbox read-only`, so directed EDIT
actions are claude-only for now: when the resolved CLI is codex, the UI
disables the action with title "AI edits need Claude Code (codex runs
read-only here)" (detect via the existing `lit:cli-status` round trip).
Timeout stays 180 s. `parseClaudeAskOutput` unchanged.

IPC: extend the `ai:ask` request contract (`packages/core/src/ipc.ts`)
with the three optional fields; `ipc.ts` passes them through; preload
untouched (it already forwards the request object opaquely — verify).

### 2b. Element capture (main, new `services/capture.ts`)

- `'app:capture-rect'` — request `{ rect: { x, y, width, height },
  targetPath?: string }` (CSS px, the sender window's page coordinates —
  `capturePage` takes DIP, which equals CSS px here). Clamps the rect to
  the window's content bounds, `webContents.capturePage(rect)`, writes
  PNG to `targetPath` or `<temp>/suna-captures/cap-<ts>.png`
  (`mkdir -p`), responds `{ path, width, height }` (decoded image size).
  Works in `SUNA_HIDDEN=1` runs (background throttling is off there).
- `'app:dev-info'` — `{ isDev: !app.isPackaged, repoRoot }` where
  `repoRoot = resolve(app.getAppPath(), '..', '..')` in dev, null when
  packaged.
- `'ai:repair-bundle'` — request `{ slug, contextJson, rect? }`. Rejects
  when packaged. Writes
  `<repoRoot>/bug-reports/<yyyymmdd-hhmmss>-<slug>/` containing
  `shot.png` (if rect given, via the capture path above),
  `context.json`, and later `prompt.md` (written by the renderer follow-up
  via a `promptPath` in the response? No — keep one writer: the response
  returns `{ bundleDir, shotPath }`, the renderer composes the prompt and
  sends it back through `ai:ask`; main appends nothing). The handler also
  calls `allowRoot(repoRoot)` so the follow-up `ai:ask` with
  `dir = repoRoot` passes `assertInsideAllowedRoot`. Add `bug-reports/`
  to `.gitignore`.

All three get zod contracts in `packages/core/src/ipc.ts` and unit tests
for the pure parts (rect clamp, bundle naming).

### 2c. Renderer shared modules

- **`ai/templates.ts`** — three pure builders returning the full prompt
  string; every template has the same skeleton: role line → TASK (the
  user's words verbatim) → CONTEXT (absolute paths, ids, structured
  facts) → RULES (surgical constraints + which MCP verbs/tools to use +
  "never run destructive git commands, never commit") → closing line
  "Reply with a concise summary of exactly what you changed; it is shown
  to the author in the app."
  - `figureEditPrompt({ figureId, svgPath, artboardMm, selectedIds,
    screenshotPath, profileName, complianceIssues, instruction })` —
    RULES: edit `figure.svg` only; preserve all element ids and untouched
    markup; never regenerate from `source/plot.py`; check your work with
    `mcp__suna__check_figure_compliance`; the screenshot at
    `screenshotPath` shows the current visual state and the gold overlay
    marks the selection.
  - `commentFixPrompt({ manuscriptPath, commentId, anchor, thread,
    surrounding, detached, instruction? })` — thread rendered as
    "author (when): body" lines; RULES: make the minimal edit that
    addresses the comment using `mcp__suna__edit_manuscript`
    (exact find/replace — never `write_manuscript`); then
    `mcp__suna__reply_comment` summarizing the change; then
    `mcp__suna__resolve_comment { resolved: true }` ONLY if fully
    addressed; if ambiguous, ask via `reply_comment` and do not resolve;
    touch nothing outside the quoted region unless the comment demands it.
  - `uiRepairPrompt({ bundleDir, shotPath, context, report })` — you are
    in the SUNA source repo; read `shot.png` and `context.json`; the DOM
    path/classes map to `apps/desktop/src/renderer/src` components; make
    a minimal fix; verify with `pnpm typecheck` and the nearest unit
    tests; do NOT commit; list the files you changed.
  - Unit tests assert each context field appears, the forbidden-actions
    lines are present, and stable section ordering.
- **`ai/directedActions.ts`** — `runCommentFix`, `runFigureEdit`,
  `runUiRepair`: build template → `startAiAsk` (extended options) →
  drive `state/aiActions.ts` → on success `pushExternalExchange(promptTitle,
  text)` (promptTitle = a one-line label, not the full prompt) + a
  status note; on error a status note with the CLI's message verbatim.
  Allowlists:
  - figure: `Read,Grep,Glob,Edit,Write,mcp__suna__read_figure_svg,
    mcp__suna__list_figures,mcp__suna__check_figure_compliance`
  - comment: `Read,Grep,mcp__suna__read_manuscript,mcp__suna__list_outline,
    mcp__suna__list_comments,mcp__suna__edit_manuscript,
    mcp__suna__reply_comment,mcp__suna__resolve_comment`
  - repair: `Read,Grep,Glob,Edit,Write,Bash(pnpm:*),Bash(node:*)`
- **`state/aiActions.ts`** — zustand map `runs: Record<string, { status:
  'busy', note: string, cancel: () => void } >` keyed `comment:<id>` /
  `figure:<figureId>` / `repair` (single). Actions `start/progress/
  finish`. Cards/panels read by key so run state survives unmount
  (dockview detaches hidden panels; ThreadCard unmounts on deactivate).
  Unit tests for transitions.

## 3. Comment card "AI" button

`comments/CommentsRail.tsx`, `ThreadCard` actions row (line ~238): a new
**AI** button (class `cmt__btn cmt__btn--ai`, text `✦ AI`) between Reply
and Resolve. Behaviour:

- Click → snapshot the LIVE anchor exactly like `toggleResolved` does
  (`liveAnchors` + `makeAnchor`), collect `surrounding` = ±400 chars of
  the buffer text around the live range (or around the stored quote via
  `locate` when detached), thread = comment + replies, absolute path =
  `<rootDir>/manuscript/<comment.target.path>`, then
  `runCommentFix(...)`. No extra input in v1 — the comment body IS the
  instruction (matches the request: "smartly sends the anchor + comment").
- While `aiActions['comment:<id>']` is busy the actions row shows
  `✦ <note>` + a Cancel button; the card gets class `cmt-card--ai-busy`.
  Never touch `composing` — the agent's `reply_comment` lands through the
  comments.json watcher, which `composing: true` would defer.
- Disabled (with the honest title from §2a) when no CLI or when the
  resolved CLI is codex; hidden for drafts.
- On success no manual refresh is needed: the MCP reply/resolve arrives
  via the watcher, and the manuscript edit live-reloads the editor (the
  external-edit path smoke step 45 already proves).

## 4. Canvas "Agent" section

`canvas/PropertiesPanel.tsx`: new `AgentSection` between `PaletteSection`
and `ExportSection`, section-pattern markup (`canvas-props__section`,
title "Agent"). Root class **`canvas-agent`**, send button
`canvas-agent__send`.

- Target line: "Selection: `ax0.title` (+2 more)" from the selected ids,
  or "Whole figure" when none.
- A 2-row textarea (`canvas-agent__prompt`) for the instruction; Send
  disabled while empty or while busy; busy shows the aiActions note +
  Cancel (key `figure:<figureId>`).
- Capture: `CanvasTab` passes down `captureForAgent(): Promise<{ path,
  ids } | null>` — union `getBoundingClientRect()` of the selected ids'
  MIRROR elements (the mirror is layout truth; the engine doc is off-DOM)
  or the artboard's rect when nothing is selected, offset to window
  coordinates, padded 12 px, sent to `'app:capture-rect'`, PNG to the
  temp path. The capture keeps the selection overlay visible on purpose —
  the gold boxes tell the agent what "the selection" means, and the
  template says so.
- Context from `CanvasPaletteContext` (registered unconditionally —
  never `window.__sunaDev`, which is dev-only): rootDir, figureId,
  profile, plus current compliance issues (re-run `runCompliance` if the
  cached list is stale). `svgPath =
  <rootDir>/figures/<figureId>/figure.svg`.
- On success: if the canvas document has no unsaved edits, re-read
  `figure.svg` from disk into the engine (reuse the tab's existing
  load path) and re-run compliance; if dirty, status note "Agent edited
  figure.svg on disk — save or undo your local edits, then reopen".

## 5. "Repair this UI" (dev-only)

Command `ai.repairUi` — "AI: Report / repair this UI…" (category App),
registered in `state/commands.ts` with `enabled: () =>
import.meta.env.DEV`. New `shell/repair/RepairPicker.tsx` (+ css),
mounted in `App.tsx`:

- Activating enters pick mode: a fixed full-screen crosshair layer
  (`repair-picker`) that tracks `elementFromPoint`, outlines the hovered
  element (gold 2 px box + tag/class label), Esc exits. Click freezes the
  target and opens a small dialog: the target's identity line, a
  textarea for the report, Send / Cancel.
- Send → context JSON `{ domPath (up to 6 ancestors of tag.class),
  classList, dataAttrs, rect, activePanelComponent, activeView,
  appVersion, platform }` → `'ai:repair-bundle'` `{ slug, contextJson,
  rect }` → `uiRepairPrompt` → `ai:ask` with `dir = repoRoot`
  (allow-listed by the bundle handler). Progress + result via
  `aiActions['repair']` surfaced as a status note; the transcript gets
  the exchange on success. Every report is on disk under
  `bug-reports/…` whether or not a CLI was available — the bundle IS the
  fallback.

## 6. Docs

TESTING.md: new subsection under the drive-probe section describing the
three actions, their unbilled smoke coverage, and the billed manual legs
with a "last measured" line each (fill in after the first real runs).
Help overlay listed in the walkthrough. Roadmap: mark the feature.

## 7. Verification contract (selectors are API)

Stable hooks the probes and smoke steps rely on — builders must use
exactly these: `.help-overlay`, `.help-overlay__tab`, `.cmt__btn--ai`,
`.canvas-agent`, `.canvas-agent__send`, `.repair-picker`,
`data-help-section` on the dialog root = active section id.

- Probes (`scripts/e2e/probes/`): `help-overlay.mjs` (`?` opens; typing
  `?` in the editor does NOT open and inserts the char; canvas tab active
  → opens on canvas section; Esc closes and restores focus),
  `ai-surfaces.mjs` (comment card shows the AI button; canvas Agent
  section renders with the selection readout; capture-rect IPC → PNG
  whose IHDR size matches the request within the DPR factor).
- New smoke steps (append after step 66, same style): `help-overlay`,
  `ai-capture-rect`, and `comment-ai-cancel` — start a real comment fix
  and cancel ~3 s in, locating the child in `ps` by the `--mcp-config
  <project path>` argv (NOT by prompt text — stdin delivery keeps the
  prompt out of `ps`, and never by the string "claude", per step 47's
  rule); after Cancel the pid must be gone and the card out of its busy
  state. Unbilled (cancelled before completion).
- Billed legs, by hand once: a comment fix that lands an edit + reply +
  resolve; a figure edit that survives `check_figure_compliance`.

## Appendix — shortcut inventory for §1 (verified against code + TESTING.md)

**global**: ⌘K palette (files) · ⌘⇧P palette (commands) · palette
prefixes `>` commands, `$` terminal, `?` ask agent · ⌘\ split right ·
⌘⇧\ split down · ⌘⇧B toggle sidebar · ⌘⌥B toggle nav bar · ⌃` terminal ·
? this help · Esc close overlays · title-bar project switcher.
**editor** (prose): ⌘S save · ⌘Z/⌘⇧Z undo/redo · ⌘E source⇄reading ·
⌘B/⌘I bold/italic · ⌘⇧C code · ⌘⇧X strikethrough · ⌘K link (selection
only; else palette) · ⌘⇧K insert citation · ⌘⇧M comment on selection ·
⌘⌥M toggle comments rail · ⌘F search · right-click menu (format · link ·
citation · comment) · ✦ AI on a comment card sends it to the agent.
**manuscript**: everything in editor, plus: outline click scrolls ·
click title/abstract/authors to edit in place (Esc cancels, ⌘⏎ commits) ·
gear = appearance for the whole document.
**canvas**: V/R/O/L/A/T tools · Esc cancel/deselect · ⌘S save · ⌘Z/⌘⇧Z ·
⌘D duplicate · ⌘⇧I import SVG/PNG · scroll pan · ⌘-scroll zoom · arrows
nudge (⇧ ×10) · Delete removes · ⌘[/⌘] back/forward (⌥ = to end) ·
⌘G/⌘⇧G group/ungroup · shift-click add to selection · Agent section in
the right rail sends the selection + prompt to the agent.
**explorer**: ↑/↓ move (⇧ extends) · →/← expand/collapse · Home/End ·
Enter open · F2 rename · ⌘A select all · Esc clear · Delete two-step ·
⌘-click toggle row · ⇧-click range · ⌥-click open beside · right-click
menu.
**viewers**: PDF/image ⌘+/⌘−/⌘0 zoom, Fit width · PDF page jump box ·
CSV grid Text/Grid toggle · figures view ⌘-click opens beside ·
references: click row opens its PDF beside · Attach PDF….
