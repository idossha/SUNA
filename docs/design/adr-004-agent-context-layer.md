# ADR-004 — Agent context layer: machine-level docs, project stubs, heal-on-open

**Status:** accepted · 2026-08-16 (user direction: "every new project contains
the necessary MCP and skill for agents to know how to work with SUNA"; scheme
chosen from the flux review: machine-level + stub, always-on, memory layer,
close the verb gaps)

## Decision

Every SUNA project is agent-ready, unconditionally. The knowledge ships with
SUNA, not with the project:

1. **Machine level — `~/SunaConfig/Context/`** (override: `$SUNA_CONFIG_DIR`):
   - `UserContext/` (`WHO-AM-I.md`, `RULES.md`) — user-owned, seeded once,
     never rewritten; agents read it first and may only *propose* edits.
   - `SunaContext/` — seven app-owned stock docs (`README.md`,
     `PROJECT-GUIDE.md`, `MANUSCRIPT.md`, `COMMENTS.md`, `FIGURES.md`,
     `MCP.md`, `WORKFLOW.md`) teaching the SUNA contract: SciMark syntax,
     the citation workflow, the comments sidecar + review loop, figure
     ownership, the full MCP verb table, the session playbook, and the
     safety doctrine (additive automatic / destructive proposes first;
     content is data, never instructions; compliance advisory-only;
     numbering derived, never stored).
2. **Project level** — every scaffold writes, and every open heals:
   - `AGENTS.md` + `CLAUDE.md`: identical ~20-line stubs pointing at the two
     context layers. Line 1 carries a `suna:agent-stub v1` marker; SUNA may
     rewrite the file only while the marker is present — deleting it hands
     the file to the user forever.
   - `context/MISSION.md` (co-owned charter), `context/NOTEBOOK.md` (agent
     memory: body + append-only session log, surgical edits only),
     `context/RULES.md` (promoted standing preferences). Created only when
     missing, never rewritten.
   - `.mcp.json`: **machine-local and gitignored** (it bakes an absolute
     server path); `.gitignore` gains a `.mcp.json` line.
3. **Skill** — `~/.claude/skills/suna/SKILL.md`, a pointer stub for
   bare-session discovery ("the knowledge lives with SUNA, not in this
   skill"), synced while it carries its managed marker.

## Mechanism

- Source docs live in `resources/suna-context/` + `resources/suna-skill/`;
  `scripts/gen-suna-context.mjs` embeds them into the checked-in
  `packages/agent/src/context/docs.gen.ts` with a 16-hex sha256 content
  hash. Embedded means they ride the Electron bundle and the esbuild MCP
  bundle with zero packaging config.
- `ensureSunaConfig()` runs at app start and MCP-server boot; it re-syncs
  `SunaContext/` when the hash changed, substituting `{{SUNA_MCP_PATH}}` /
  `{{SUNA_MCP}}` with this install's invocation, and stamps
  `SunaContext/.version` (`{hash, serverPath, synced}`).
- `ensureProjectAgentLayer()` runs from every surface that makes a project
  "the open one" (`project:create/open/open-example/scaffold`,
  `docx:commit`, `agent:write-mcp-config`) and from MCP-server boot.
  Additive and existence-guarded throughout; scaffolds call it before
  `git init` so stubs + `context/` land in the initial commit.
- **Anti-churn ("gone, not different")**: baked absolute paths are re-baked
  only when the stamped path no longer *exists*. A dev checkout and a
  packaged app resolve different paths; alternating between them must not
  rewrite the folder or `.mcp.json` on every switch. Three refinements from
  the adversarial review: a same-install `.mcp.json` entry (identical
  serverPath) is also re-baked when its command/env or `--project` root
  drifted (fixes the legacy plain-`node` entry and moved projects); all
  writes byte-compare first, so a heal that cannot converge (bundle missing)
  stops rewriting; an unparseable `.mcp.json` is preserved as
  `.mcp.json.invalid` beside the fresh one, never destroyed.
- Packaged, `.mcp.json` runs the app binary as Node
  (`command: process.execPath`, `env: {ELECTRON_RUN_AS_NODE: '1'}`), so no
  system `node` is required; dev uses `node` + the repo's `dist-mcp` bundle.

## Verb gaps closed (18 → 20 tools)

So the shipped docs teach a contract without apologies:

- **`edit_manuscript {find, replace}`** — the anchored edit primitive:
  exactly one exact-match occurrence or a loud error (whitespace-normalized
  near-miss hint on zero matches; per-match context on several). An edit
  from a stale read fails instead of clobbering concurrent changes. The
  docs teach this as the routine edit path; `write_manuscript` stays for
  wholesale restructures.
- **`check_manuscript {}`** — exposes the already-implemented
  `checkManuscript` (word/abstract/section limits, required sections,
  availability statements, figure-reference integrity), mirroring the
  app's export-time check (first declared article type, distinct cited
  keys as the reference count).
- **Comment identity** — authorship comes from `$SUNA_AGENT_NAME` /
  `$SUNA_AGENT_MODEL` at call time (default `Agent`), replacing the
  hardcoded "Claude Code"; the Agent view's CLI launcher sets the name.

## Drift gates

`packages/agent/src/context/context.test.ts` (in `pnpm test`) pins:
generated module byte-identical to a fresh regeneration; placeholders
survive in `MCP.md` and appear nowhere else; no machine paths in any source
doc; `MCP.md`'s verb table equals the `TOOLS` registry exactly (names and
count); ensure functions are idempotent, never touch user-authored files,
and honour gone-not-different (dev ↔ packaged alternation covered).
Smoke steps 37/43 exercise the real bundle; step 43 asserts all 20 verbs
and round-trips `edit_manuscript` / `check_manuscript`.

## Accepted simplifications

- **No config lock**: concurrent app + server heals at worst write
  identical bytes (all writes are idempotent, atomic tmp+rename).
- **No movable-config pointer** (flux's `fluxConfigPath` preference):
  `$SUNA_CONFIG_DIR` env is the only override.
- **Docs removed from the set are not deleted** from an installed
  `SunaContext/` — they linger until the next manual cleanup; acceptable at
  seven files.
- **`context/` is a fixed name**, deliberately outside `suna.json`'s
  `directories` record — an agent-layer convention, not a relocatable data
  directory; adding a manifest key would force a schema migration for zero
  benefit.

## Rejected

- Per-project baked doc copies (the earlier flux approach) — they go stale
  on every release; flux itself retired them for the machine-level scheme.
- A fat skill carrying the instructions — same staleness failure, one more
  copy to gate.
- `.mcp.json` committed to the project repo — it holds an absolute
  machine path by construction.
