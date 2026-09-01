# TODO

Ideas that are worth doing but are not being done right now. This file is a
holding pen, not a plan: the contract is `docs/ARCHITECTURE.md`, what is
open is `docs/ROADMAP.md`, and anything with a settled design belongs as a
dated entry in `docs/DECISIONS.md` rather than here.

An entry earns its place by being **actionable later without its author
present** — enough context that whoever picks it up (human or agent) can
decide whether to start, and start without re-deriving the reasoning.

## How to add an entry

Append under `## Backlog`, newest last. Use this shape:

```markdown
### <Imperative title — what would change, not what is wrong>

**Status:** idea | designed | blocked on <what>
**Touches:** <the files or packages a reader should open first>

<One paragraph: what is true today, and what would be true after. Name the
functions and files that carry the current behavior.>

#### Why this shape

<The approach, concretely enough to argue with. Commands, flags, data
shapes. Skip if the title says it all.>

#### Costs to accept before starting

<Bulleted. The things that make this more than an afternoon: platform gaps,
signing, migrations, new design work hiding behind the obvious work. Be
honest here — this section is what stops someone starting on a Friday.>

#### Verdict

<Whether it is worth doing, and what would change that answer.>
```

Rules that keep this file useful:

- **Write the costs section even when it is inconvenient.** An entry with no
  costs listed reads as "an afternoon", and that is how a week disappears.
- **Cite the code.** `file.ts:120` or a function name, not "the terminal
  stuff". The reader's first move is to open something.
- **State what is already true.** Half of a good entry is describing the
  current behavior accurately, so the reader can tell whether the entry has
  gone stale.
- **No dates, no owners, no priorities.** Those go stale faster than the
  idea does. Ordering is not priority.
- **One entry per idea.** If it splits cleanly into two things that could
  ship separately, it is two entries.

## How to work on an entry

1. **Re-verify the "what is true today" paragraph first.** These entries are
   written against a moving codebase and are not updated when it moves. If
   the premise is stale, fix the entry before writing any code — a stale
   premise usually means the idea changed too.
2. **Check the costs section for hidden design work.** Where an entry says a
   sub-problem needs a policy or a migration, that part is not implementation
   and should not be improvised mid-task. Settle it with the user, or write
   the ADR, first.
3. **Gate as usual:** `pnpm typecheck` and `pnpm test` pass workspace-wide
   before a commit. UI checks run against a hidden app
   (`scripts/e2e/drive.mjs`), never a visible window.
4. **Remove the entry in the same commit that finishes it.** A "done" section
   here would duplicate git history. If the work produced a decision worth
   keeping, that decision goes in an ADR, not back into this file.
5. **Abandoning is a real outcome.** If the entry turns out to be wrong,
   delete it and say why in the commit message.

---

## Backlog

### Bundle tmux so agent sessions survive a SUNA crash

**Status:** idea
**Touches:** `main/services/terminal.ts`, `shell/screenask/screenask.ts`,
`main/index.ts`, packaging

The floating agent terminal now survives a renderer reload: the pty lives in
the main process and `restoreFloatTerminal` re-adopts it. It does not survive
main going away — `killAllTerminals` ends every pty on quit, and a force-quit
or a main-process crash closes the pty master, SIGHUPs the shell and takes
`claude` with it. Running the agent inside a bundled tmux would move the
session out of SUNA's process tree entirely, so a crash, a force-quit or a
full restart leaves the conversation running and re-attachable — including
from a plain terminal outside the app.

#### Why this shape

tmux can be bundled without touching the user's own setup, because every
piece of global state it owns is redirectable by flag:

- `-S <userData>/tmux.sock` — its own socket, therefore its own server. The
  user's `tmux ls` never sees SUNA's sessions and vice versa. This is the one
  that matters.
- `-f <resources>/tmux.conf` — a shipped config, so a custom prefix key or
  status bar in `~/.tmux.conf` cannot leak into the window.
- `TMUX_TMPDIR` — pins the socket under `app.getPath('userData')`.
- Unset `TMUX` in the pty env, or launching from inside an existing tmux
  refuses to nest.

Shape of the command:

```
<resources>/bin/tmux -S <sock> -f <conf> new-session -A \
  -s suna-agent-<id> '<screenAskCommand output>'
```

What gets persisted across a restart becomes the tmux **session name** rather
than a pty id — stable across everything, unlike the id.
`resources/bin/tmux` follows the path already used by `mcp/`, `python/` and
`examples/` (see `agentLayer.ts`, `kernel.ts:37`).

#### Costs to accept before starting

- **Getting the binary.** libevent is not on macOS, so tmux + libevent must
  be built statically in CI; no official static distribution exists. One per
  arch (arm64 + x64, `lipo`'d or chosen at runtime), and a static build on
  Linux too, to survive glibc variation.
- **Signing.** A second Mach-O inside the bundle must be signed and notarized
  with the app or hardened runtime rejects it. Solved problem, but it fails
  on other people's machines rather than on ours.
- **Windows gets nothing.** tmux does not exist there; `terminal.ts` already
  branches to COMSPEC/powershell. Persistence would be macOS/Linux only, and
  the UI must not imply otherwise.
- **Licensing.** tmux ISC, libevent BSD-3, ncurses MIT-ish — all
  redistributable, all needing attribution in an about/licenses screen.
- **Orphan reaping is the real design work.** Surviving a crash means the
  agent is no longer owned by anything with a UI: a force-quit leaves
  `claude` running and burning tokens. Needs a policy — kill sessions older
  than N hours at startup, list orphans and offer to end them — and that is
  a decision, not an implementation detail.
- There is no `electron-builder.yml` in the repo yet, so the packaging side
  needs writing regardless of this feature.

#### Verdict

Worth doing only if "survives a force-quit" is worth owning orphaned agent
processes. The reload case — the one actually hit in practice — is already
fixed without any of it.
