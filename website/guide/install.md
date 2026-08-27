# Install and run

Download an installer, or run from a source checkout. Most people want the installer.

## Download

Every [release](https://github.com/idossha/SUNA/releases) carries builds for macOS, Windows and Linux.

### macOS

SUNA is not notarized by Apple yet, and macOS refuses to open an app it cannot check — reporting it as **"damaged"**, with no override in the dialog. The quarantine flag that triggers this is attached by the *browser*, not by the file, so install from a terminal instead:

```bash
curl -fsSL https://raw.githubusercontent.com/idossha/SUNA/main/scripts/install-macos.sh | bash
```

That picks the right build for your Mac (Apple silicon or Intel), installs it to `/Applications`, and opens cleanly. Read [the script](https://github.com/idossha/SUNA/blob/main/scripts/install-macos.sh) first if you would rather not pipe to a shell.

Already downloaded the DMG in a browser? Drag SUNA to Applications, then:

```bash
xattr -dr com.apple.quarantine /Applications/SUNA.app
```

### Windows

Take the `.exe` matching your architecture. SmartScreen warns about an unknown publisher — choose *More info* → *Run anyway*.

### Linux

Take the AppImage for your architecture (`chmod +x` it and run), or the `.deb` on Debian and Ubuntu.

## Run from source

You need a source checkout to develop SUNA, or to run an unreleased revision.

## What you need

| Piece | Required? | Version | What it is for |
|---|---|---|---|
| Node | Yes | >= 22 | The declared workspace engine |
| pnpm | Yes | 10.30.3 | Pinned in `packageManager`; the repo is a pnpm workspace |
| git | Optional | any | Project version control; creation degrades gracefully without it |
| Python + uv | Optional | Python >= 3.10 | The `suna-mpl` matplotlib companion and the example project's figure scripts |
| An agent CLI (`claude` or `codex`) | Optional | any on PATH | The "AI search" literature provider, and driving SUNA from an external agent |
| An AI provider API key | Optional | — | In-app AI when you would rather not use a CLI subscription |

Electron is not a separate install. It comes down as a devDependency of the desktop app during `pnpm install`.

You do **not** need LaTeX or Tectonic. PDF export goes through a hidden Electron window's `printToPDF`, with no external binary involved — the package table in the repo's own `README.md` is stale on this point.

## Clone and run

```bash
git clone git@github.com:idossha/SUNA.git
cd SUNA
pnpm install
pnpm dev
```

`pnpm dev` runs `electron-vite dev` for the desktop app and opens a window. This is the visible-window development mode; it is what you want as a human using the app.

pnpm 10 blocks package install scripts by default. SUNA allow-lists exactly four that need to run — `electron`, `esbuild`, `node-pty`, and `@electron/rebuild` — so a plain `pnpm install` is enough; you do not run a separate native-module rebuild step.

::: info Also run `pnpm build` once if you plan to use an external agent
In a source checkout, the MCP server that `claude` or `codex` talks to is launched as `node <repo>/packages/agent/dist-mcp/server.mjs`. That directory is gitignored, so it does not arrive with a clone, and `pnpm dev` does not produce it. Run `pnpm build` (which is `pnpm -r build` across the workspace) once, before expecting an external agent to connect. See [MCP](/ai/mcp).
:::

## First run

The app opens on the Welcome tab, which offers **Create project**, **Open project…**, **Open example**, **Set up project…**, and **Import .docx…**, above a list of recent projects.

<figure class="shot">
  <img src="/shots/welcome.webp" alt="The SUNA Welcome tab, headed 'A workspace for the whole paper', with buttons for Create project, Open project, Open example, Set up project and Import .docx, and no recent projects yet." />
  <figcaption>The Welcome tab on launch, as it looks on a first run — the recents list under the buttons is still empty. Start with Open example.</figcaption>
</figure>

**Open example** is the fastest way to see a real project. It never edits the shipped demo: it copies `examples/hello-suna/` into your Electron user-data folder — on macOS `~/Library/Application Support/@suna/desktop/example-project` — skipping `output/`, `.git`, and `.DS_Store`, then git-inits the copy with an initial commit. Later opens reuse that copy. If a SUNA update ships a different example, the copy you have is moved aside (`example-project-<old-name>`, never deleted) and a fresh one is taken. Delete the directory to start from a clean example.

**Create project** and **Set up project…** both run the seven-step onboarding wizard: Where & what, Target journal, What to scaffold, Python environment, AI, Defaults, Review. `Set up project…` skips step 1 and seeds a folder you already have. A new project starts in the bundled SUNA house style, not a journal profile — see [profiles](/publishing/profiles). The [quickstart](/guide/quickstart) walks the whole path.

## What the optional pieces add

**Python and uv.** Wizard step 4 "Python environment" offers Skip, an existing detected environment, or "Create with uv". Detection looks for a project-local `.venv`, `venv`, or `env` (it needs a `pyvenv.cfg`), one nested level down, plus conda environments via `conda env list --json`; uv is probed with `uv --version`. Without uv, the "Create with uv" option is disabled and says so. The `suna-mpl` companion needs Python >= 3.10 and `matplotlib >= 3.8`. The example's figures are regenerated from `examples/hello-suna/` with commands of the form:

```bash
uv run --project ../../python/suna_mpl python figures/fig-spectrum/source/plot.py
```

See [figures from code](/figures/from-code).

**An agent CLI.** Wizard step 5 "AI" recommends "Agent CLI", which uses an existing Claude Code or Codex subscription and stores no API key. With neither on PATH, Settings reports "Neither was found on PATH — literature search falls back to Crossref." — literature search still works, without the AI-search provider. See [references](/writing/references).

**An API key.** The alternative in step 5, billed per token. The three supported providers are Anthropic, OpenAI, and Ollama (local, default base `http://127.0.0.1:11434`). Keys are encrypted with Electron's `safeStorage` and written as base64 ciphertext to `keys.json` in the user-data folder with mode 0600.

**A contact email.** Settings → Literature providers has a Contact email field, sent to Crossref and OpenAlex as a polite-pool contact — their preferred practice, not a login. If it is blank, SUNA falls back to your `user.email` setting, and then to sending nothing. Configure it in [settings](/guide/settings).

The standalone MCP server does not see that field. It reads its own `SUNA_CONTACT_EMAIL` from the environment it is launched with, and nothing in SUNA exports it for you — so export it yourself if you want an agent to reach Unpaywall, which requires it. Without it, that rung of the download ladder is skipped and the report says so. See [MCP](/ai/mcp).

Whichever AI choice you make, the wizard says the agent wiring is written anyway: `.mcp.json` (machine-local, gitignored), `AGENTS.md` / `CLAUDE.md`, and the `context/` memory files. See [agent context](/ai/context).

## Where SUNA writes outside your project

On first use SUNA creates a machine-level `~/SunaConfig/` folder holding the context documents and `library.json` (the reference-PDF search roots), and a pointer skill at `~/.claude/skills/suna/SKILL.md`. Project scaffolding writes a `.gitignore` containing `output/`, `.DS_Store`, `__pycache__/`, `.venv/`, and `.mcp.json`, so the machine-local MCP wiring is never committed. [What lives where](/reference/files) has the full map.

## Platform support

macOS is the only platform SUNA has been exercised on. The code carries Windows branches and non-Darwin fallbacks, but no Windows or Linux run is on record, so treat those as untested rather than supported. One feature is macOS-only by construction: the "Use Spotlight" setting, which asks `mdfind` for PDFs whose text contains a DOI or title before walking your folders, appears only on macOS.

## Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| "uv was not found on PATH — install it first, or choose Skip." | uv is not installed | Install uv, or pick Skip and set the environment up yourself |
| "git init failed (continuing without VCS)" | No `git` binary on PATH | Install git if you want project history; the project is still usable |
| "secure key storage is not available on this system" | `safeStorage` encryption is unavailable, so saving a key throws rather than storing it in the clear | Use the agent-CLI option instead of an API key |
| An external agent cannot start the SUNA MCP server | `packages/agent/dist-mcp/server.mjs` was never built | Run `pnpm build` at the repo root |
| A project has no `.mcp.json` | The wiring is written on open and is gitignored, so it never travels with a clone | Open the project in SUNA once |
| The example looks stale or you broke it | You are editing the copy, not the shipped demo | Delete `~/Library/Application Support/@suna/desktop/example-project` and choose Open example again |

## Developer commands

| Command | What it does |
|---|---|
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm test` | Vitest across the workspace |
| `pnpm build` | `pnpm -r build` — includes the MCP server bundle |
| `cd python/suna_mpl && uv run pytest` | Python companion tests |

Do not pipe the typecheck into a pager: `pnpm typecheck | tail` reports `tail`'s exit status, not `tsc`'s, and hides a failure.

::: warning Not built yet
`pnpm smoke`, the end-to-end UI smoke test, is stale. It still clicks a removed button and reads manuscript paths that no longer exist, so several of its steps fail on a healthy checkout. Do not treat it as a green check that your install is good; use `pnpm typecheck && pnpm test` for that.
:::

Next: the [quickstart](/guide/quickstart) takes the example project from open to exported PDF, or take the [tour](/guide/tour) of the workspace first.
