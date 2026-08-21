# ADR-011 — Collaboration: git invites first, then live text, never live figures

**Status:** proposed · 2026-08-21 (user direction: "a git invite to a private
project is a good first step. a second step is indeed the live text. we will
not need live figure co-editing ever." Depends on the OAuth App of
`github-oauth-app.md` and the session core in
`renderer/src/state/docSessions.ts`. Spec: `feature-plan-15.md`.)

## Context

SUNA is a desktop app whose sources of truth are plain-text files on the
author's disk, tracked in git. Nothing about that says "single author" — a
manuscript is written by four people — but nothing in the app says
"co-author" either. Today a second person gets the paper by being handed a
folder.

Two different things get called collaboration, and conflating them is what
makes this look harder than it is.

**Turn-taking.** Ben writes the Methods on Tuesday, Ido rewrites the
Discussion on Wednesday. They are never in the same paragraph at the same
second. This is what a manuscript actually is most of the time, and git is
already the correct tool for it — reviewable diffs, attribution, history.

**Simultaneity.** Two carets in one sentence, Google-Docs style. It is worth
much less for a paper than for a meeting agenda, but it is worth something:
it removes "are you in the file right now?" from the workflow, and it makes a
writing session with a co-author over a call feel like one document instead
of two.

The decisive discovery is that SUNA is much closer to the second than it
looks. `DocSessionCore` (`state/docSessions.ts:137`) is already described in
its own docstring as "the transport-free sync core: an authoritative Text
plus N views kept in lockstep by forwarding ChangeSets." It rebases with
`ChangeSet.map` and the code comment at line 125 already names the mechanic:
"the collab OT mechanic." It was built so that one file open in the Explorer
tab, the Manuscript tab and a split stay one buffer, and so that an
IME-composing view can lag behind the session and be rebased forward when it
catches up.

**A network peer is a view that lags.** The queue-and-rebase path written for
IME composition is, structurally, the path a remote peer needs. That is not a
coincidence to be exploited cleverly; it is the reason this is a weeks-long
job and not a rewrite.

## Decision

### 1. Two tiers, shipped in that order, each useful alone

**Tier 1 — invite a collaborator to a private project.** A GitHub
collaborator invitation issued from inside SUNA, plus a clone-a-project entry
point so the invitee can accept and open it. Async, no server of ours, no new
document model.

**Tier 2 — live text.** Simultaneous editing of the prose files, with remote
carets and presence, over a relay we run.

Tier 1 is not a stepping stone that gets thrown away. It stays the durable
layer underneath Tier 2 forever: live sessions are ephemeral, git is what
persists.

### 2. The GitHub repository is the access-control list

No SUNA accounts, no user table, no invite tokens of our own. A person can
edit a project if and only if GitHub says they are a collaborator on its
repository. Tier 1 is literally that. Tier 2 enforces it by having the relay
take the joiner's GitHub token, call `GET /repos/{owner}/{repo}` with it, and
accept the connection only on a 200 — the token is used once, for that check,
and never stored.

This is the single largest scope reduction available, and it costs nothing:
the `repo` scope the OAuth App already requests
(`github-auth.ts:32`) covers collaborator management, so Tier 1 needs no
re-authentication of existing users.

### 3. Live text is central-authority OT, not a CRDT

Peers exchange CodeMirror `ChangeSet`s against a version number. A relay
serializes them into one canonical order and rebases latecomers. This is the
model `@codemirror/collab` implements, in the same vocabulary
`DocSessionCore` already speaks.

**Over Yjs / Automerge**, which is the obvious industry default, for three
reasons in ascending order of importance:

1. It would introduce a parallel document model — a `Y.Text` that is the real
   document while the file is a projection of it. The canvas rule in
   `CLAUDE.md` forbids exactly this shape for the SVG DOM, and the reasoning
   does not stop being true for prose.
2. CRDT merge is character-level and unconditional. Two people who rewrite
   the same sentence offline get a mechanically-valid interleaving of both
   rewrites, which is not a sentence. A git conflict is uglier and correct.
3. It moves durability into the CRDT. Once offline edits are expected to
   merge automatically, the CRDT history becomes the thing you must not lose,
   and the file stops being the truth. That is the whole architecture
   inverted to buy a feature — offline co-editing — that git already covers
   with better output.

The cost of this choice is stated plainly: **a peer who is not connected
cannot participate in a live session.** Their work goes through git, as a
reviewable diff. We consider that the right answer for a manuscript rather
than a limitation to apologize for.

### 4. Sessions are ephemeral; the relay stores nothing at rest

A session is created when the first peer opens a file with live mode on,
seeded from that peer's buffer, and destroyed when the last peer leaves. The
relay holds document text and an update log in memory only, for the life of
the session. No database, no disk, no backups. Losing the relay loses a
session, not a manuscript — every peer's converged text is already on their
own disk on the existing autosave cadence.

**Over a hosted-documents model**, where projects live in our cloud and the
desktop app syncs to it. That is a different product, and it deletes the
property that makes SUNA worth using.

### 5. Not Vercel

The relay needs long-lived WebSocket connections and in-memory per-session
state. Serverless functions have neither. A single small always-on Node
process (Fly.io, Railway, a VPS) or one Cloudflare Durable Object per session
is the shape. It must be self-hostable, and it must be **optional**: with no
relay configured, which is the default, SUNA behaves exactly as it does
today.

### 6. The host does not own the session

**Over host-peer authority**, where the project owner's `DocSessionCore` is
the authority and guests are remote views of it. It is tempting — it is a
smaller diff and no document text ever leaves the owner's machine — and it is
wrong twice: the session dies when the owner shuts their laptop, and the
guest has been editing the owner's files while their own clone sat unchanged
underneath them.

Server-authoritative means every peer's disk converges to the same bytes, so
any of them can commit and the others fast-forward.

### 7. Live figure co-editing is out of scope permanently

Not "later," not "after v1." The canvas is not getting a collaborative
editing path, and this ADR is the record of that being a decision rather than
an omission. Figures remain single-writer, coordinated through git like any
other file. If two people touch the same SVG, they get a git conflict.

This is the clause that keeps the whole feature affordable. The canvas is the
one surface where live editing would have forced a parallel scene graph and
broken ADR-001.

## Consequences

- `DocSessionCore` gains version bookkeeping and one new entry point for
  applying remote changes. It is the only existing file whose core logic
  changes; everything else is additive.
- We operate a service. That is new for this project, and it comes with
  uptime, TLS, and abuse concerns that a desktop app did not have. It is
  bounded by being stateless and optional.
- `comments.json` gets live sync cheaply (append-mostly, and comments are
  already anchored by quote/prefix/suffix, so they survive concurrent prose
  edits). `references.bib`, `manuscript.json` and figures do not sync live in
  any planned version.
- A live session requires all peers on the same commit. "Pull first" becomes
  a precondition SUNA checks and offers to satisfy, not an error it reports.
- Offline divergence keeps using machinery that already exists and is
  already tested: `merge3`, `gitConflictState`/`gitResolveConflict`, and the
  `DivergenceBanner` three-way merge.
