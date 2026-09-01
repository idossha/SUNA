# Working on SUNA (for humans and agents)

An Electron academic-writing platform: manuscripts, figures, references and journal compliance in
one folder of plain text. pnpm monorepo, TypeScript strict.

Read `docs/ARCHITECTURE.md` first — it is the contract, and its section numbers are cited from code
comments and tests. `docs/DECISIONS.md` is append-only and records *why*. `docs/ROADMAP.md` says
what is open. Where a document and the code disagree, **`docs/ARCHITECTURE.md` §20 is the list of
known disagreements** — check it before assuming either side is right.

| Document | What it is |
|---|---|
| `docs/ARCHITECTURE.md` | The contract. §1–§22, cited by number. **D1–D13 in §3.1 are the rules that recur everywhere.** |
| `docs/DECISIONS.md` | Append-only, dated. Decision — why — alternatives rejected. |
| `docs/ROADMAP.md` | What exists, what is open. |
| `docs/AUTOMATION.md` | Driving SUNA from outside: the MCP server, the context layer, the hidden-app driver. |
| `docs/TESTING.md` | The operator's manual for the suites. |
| `docs/RELEASING.md` | Cutting a release; macOS signing and notarization. |
| `docs/packaging.md` | What goes inside the bundle. |

## Commands

- `pnpm install` · `pnpm build` (workspace + `electron-vite build` + the MCP bundle) ·
  `pnpm typecheck` · `pnpm test` · `pnpm package` / `pnpm package:mac`
- **`pnpm typecheck` and `pnpm test` must pass workspace-wide before a commit.** `pnpm build`
  first on a fresh clone — the MCP bundle and the emitted declarations are prerequisites of the
  typecheck.
- **Never pipe the typecheck into a pager.** `pnpm typecheck | tail` reports `tail`'s exit status,
  not `tsc`'s, and hides a failure.
- Python: `cd python/suna_mpl && uv run pytest`.
- `pnpm docs:dev` / `pnpm docs:build` — the VitePress site in `website/`. It fails the build on a
  dead internal link, so the build *is* the link checker. Run
  `node website/scripts/normalize.mjs --check` before pushing a page: a shortcut written
  `<kbd>⌘\</kbd>` compiles to a broken Vue template, and `{{ }}` inside inline code is interpolated
  by Vue and will crash the render.

## Testing

`docs/TESTING.md` is the operator's manual. The short version:

- **UI checks run against a HIDDEN app. Never launch a visible window to test.**
  `node scripts/e2e/drive.mjs --boot --example` boots one hidden window with isolated `userData`
  and a relocated `SUNA_CONFIG_HOME` — *a driven run must never touch the real `~/.suna`* — then
  `--shot out.png`, `--eval "expr"` and `run probe.mjs` iterate in seconds. `--stop` when done.
- `pnpm smoke` is ~80 named end-to-end steps over CDP, hidden by default, filterable with
  `--only` / `--from` / `--until` / `--list`. The step names are the feature inventory.
- `scripts/e2e/probes/` holds focused drivers for what the main suite does not cover.
- `node scripts/e2e/packaged.mjs` boots the *packaged* bundle. It is the only thing that exercises
  the packaged layout — asar contents, `extraResources`, the MCP bundle beside its `node_modules`.
- `pnpm dev` opens a real window and is **for the human only**.

**Establish a baseline before blaming your change.** Two failures currently pre-date any work you
are doing: the Windows CI leg fails in `packages/agent` (path quoting, symlink write boundaries,
`SUNA_CONFIG_DIR`), and `pnpm smoke` stops at `reading-mode` on a stale precondition. Neither is
yours unless you made it worse.

## Rules

1. **Sources of truth are JSON, Markdown, BibTeX and SVG.** Never introduce a binary or proprietary
   document format. PDF and DOCX are export-only and are read back never. There is no SUNA file
   format: removing SUNA from a project must leave a working directory of plain text (§3).
2. **Nothing derived is stored** (D1, §8). Figure, table, equation and reference numbers are
   computed at format time from document order. Storing one is how a cross-reference to "Figure 2"
   comes to point at Figure 5.
3. **The file is the truth; never a parallel model** (D11). The canvas document model *is* the SVG
   DOM (§10.1); the `.ipynb` is the notebook; the Markdown is the manuscript. No parallel scene
   graph, no CRDT, and no import/export conversion that owns the file.
4. **All canvas mutations go through the command bus** (`@suna/canvas`, §10.2). UI gestures and AI
   agent calls are equal clients of it. Every command must satisfy apply → invert → redo → invert
   byte-identity, and round-trip byte-identity over real matplotlib exports. This is the strongest
   test obligation in the repo and it is a contract obligation, not a nicety.
5. **Flag, never rewrite; advisory, never blocking** (D3, §12.1). A compliance checker reports; it
   never silently reformats the author's document. The single deliberate exception is an unanswered
   cover-letter assertion, which blocks export because it is an affidavit.
6. **Refuse rather than guess** (D2). A wrong answer is invisible — a mis-attributed citation looks
   exactly as correct as a right one. Where a journal states no number, SUNA states no number (D4).
7. **Read fresh, validate, write atomically** (D6). Every write to a source of truth re-reads from
   disk first, because an agent may have edited it since. Never write a stale in-memory copy.
8. **Detached, never deleted** (D7). No subsystem may drop user data because it stopped resolving.
9. **Escape everything that came from outside before it reaches an agent's context** (D12) —
   `quoteExternalPath` / `describeExternalError`. A source-reading test enforces this, because five
   review passes over one finished feature each found unescaped sites (6, 5, 2, 6, 4). Review does
   not converge on this; the gate does.
10. **One setting is one entry.** A new setting is one entry in `SETTING_KEYS`
    (`packages/core/src/settings-resolve.ts`); a new themeable colour is one entry in the token
    registry; a new IPC channel is one entry in `CHANNELS`. If any of those takes more than one
    edit, the abstraction has broken and that is the bug to fix.
11. **Measure in the running app; distrust static reasoning** (D13). A static read of Electron's
    menu predicted a conflict that a runtime check disproved. Re-run a measurement before moving
    the thing it settled.
12. **Comments in this codebase are load-bearing.** Where a rule exists because a naive approach
    failed, write the failure down next to the code. Most of `docs/ARCHITECTURE.md` was recovered
    from those comments — and a rule that belongs in the contract goes there too, in the same
    commit.
13. **Never push a tag.** `scripts/release.sh` deliberately stops at a local commit and tag;
    pushing it is what publishes a release, and that is a human's deliberate act.

## Gotchas that still bite

- **dockview v8 ships no React binding.** The adapter is
  `apps/desktop/src/renderer/src/shell/dock/DockHost.tsx` — extend it rather than importing a
  `DockviewReact` that does not exist.
- **TypeScript 7: CSS side-effect imports need the `vite/client` types reference**
  (`src/renderer/src/env.d.ts`).
- **pnpm 10 blocks postinstall scripts.** `electron`, `esbuild`, `node-pty` and `@electron/rebuild`
  are allow-listed in the root `package.json` (`pnpm.onlyBuiltDependencies`), so a plain
  `pnpm install` is enough — there is no separate native-rebuild step.
- **Settings and themes live in ONE user-owned file**, `~/.suna/config.yml`, plus
  `~/.suna/themes/*.yml`. There is no project settings level and no second store. Colours are **not**
  in any stylesheet: they come from the theme registry (`packages/core/src/theme.ts`) as a generated
  sheet. See §6 and `docs/design/configuration.md`.
- **There are two machine directories, not one.** `~/.suna` (`SUNA_CONFIG_HOME`) holds settings and
  themes; `~/SunaConfig` (`SUNA_CONFIG_DIR`) holds the agent context documents and `library.json`.
  Each is real and they are not the same thing (§6.3).
- **matplotlib SVG export needs `svg.fonttype: none`** to keep text editable, which is what makes
  canvas text editing possible at all. `suna_mpl` sets it.
- **Adding an MCP verb is not done until the shipped docs say so.** A drift gate compares `MCP.md`'s
  verb table against the `TOOLS` registry as sorted arrays, including each input's `?` marker, and
  requires the generated context module to be byte-identical to a fresh regeneration
  (`node scripts/gen-suna-context.mjs`). An input the docs omit is an input no agent will ever send.
- **`@suna/formatter` does no formatting**, and there is no LaTeX or Tectonic anywhere in the
  project — PDF export is Chromium `printToPDF`. Several older documents say otherwise; §20 has the
  list.
- **`packages/provenance` is a stub** (`export {}`, no importers). The figure-to-code provenance
  loop is designed and not built; §11.3 says exactly what is missing and §11.4 the rules if it is
  ever built.

## Commits

Conventional commits. `main` is the working branch here and is usually checked out — do not force
anything onto it. Before a commit: `pnpm typecheck && pnpm test`, both green, workspace-wide.
