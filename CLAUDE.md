# CLAUDE.md

**The instructions for working on SUNA live in [`AGENTS.md`](AGENTS.md). Read that file.**

It is the same document for every agent and for humans — commands, the rules that are not
negotiable, and the gotchas that still bite. Keeping one copy is the point: two files drift, and
the one you did not read is always the one with the rule you broke.

From there:

- **`docs/ARCHITECTURE.md`** — the contract, §1–§22, cited by number from code and tests. §3.1's
  **D1–D13** are the rules that recur in every subsystem.
- **`docs/DECISIONS.md`** — append-only and dated: decision, why, alternatives rejected.
- **`docs/AUTOMATION.md`** — driving SUNA from outside: the MCP server and its verbs, the agent
  context layer, and the hidden-app driver.
- **`docs/ROADMAP.md`** — what exists and what is open.
