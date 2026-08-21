# Feature plan 15 — co-authors, live and otherwise

**Goal (user direction, 2026-08-21):** "a git invite to a private project is a
good first step. a second step is indeed the live text. we will not need live
figure co-editing ever."

Decision record: `adr-011-collaboration.md`. This is the build spec.

Decided before drafting:

| question | answer |
|---|---|
| who may edit a project? | **whoever GitHub says is a collaborator on its repo.** No SUNA accounts. The `repo` scope we already request covers invitations, so no existing user re-authenticates. |
| what merges concurrent typing? | **central-authority OT over CodeMirror `ChangeSet`s**, not a CRDT. `DocSessionCore` already speaks this vocabulary. |
| what persists? | **the files, in git.** The relay is memory-only and stateless; losing it loses a session, not work. |
| which files go live? | **prose only** — `manuscript.md`, `supplementary.md`, letter bodies — plus `comments.json` in Stage E. Never figures, `.bib` or `manuscript.json`. |
| what about an offline co-author? | **git.** They cannot join a live session; their work arrives as a reviewable diff. This is the intended answer, not a gap. |

---

## Stage A — Invite a collaborator

Async collaboration, end to end, with no server of ours. Independently
shippable and worth shipping alone.

### A1. Collaborator API — `main/services/github-collab.ts` (new)

Four calls against the token from `githubToken()`, following the
error-explaining style of `github.ts`:

| function | endpoint |
|---|---|
| `ghListCollaborators(slug)` | `GET /repos/{slug}/collaborators` |
| `ghListInvitations(slug)` | `GET /repos/{slug}/invitations` (pending, not yet accepted) |
| `ghInviteCollaborator(slug, login, permission)` | `PUT /repos/{slug}/collaborators/{login}` |
| `ghRemoveCollaborator(slug, login)` | `DELETE /repos/{slug}/collaborators/{login}` |

`permission` is `'push' | 'pull'` — write and read-only. `admin` is
deliberately not offered; transferring control of a repository is a thing to
do on github.com, deliberately, not a dropdown in a writing app.

The slug comes from `gitRemote(dir)` parsed through the existing
`git-url.ts`. A project with no remote gets the publish flow
(`views/GitRemote.tsx`) first, not an error.

An `explainInviteFailure(status, payload)` mirroring `explainCreateFailure`,
covering the four failures that will actually happen: no such GitHub user
(404), not an admin of this repository (403), the user is already a
collaborator (204 with no invitation created — report it as success, not as
nothing), and org SAML SSO not authorized (403 with a distinguishable body).

### A2. Clone a project — `main/services/git-clone.ts` (new)

The gap Stage A would otherwise leave: an invitee can accept on github.com
and then has nowhere to put the result. `gitClone(url, parentDir, name)`
shells out through the same `remoteEnv`/`nonInteractiveEnv` credential path
`git-remote.ts` uses, then validates that the clone contains a `suna.json`
and opens it.

Entry point on `WelcomeTab.tsx` beside "Open project" — *Clone from
GitHub…*, offering the repositories the signed-in account can already see
(`GET /user/repos?affiliation=collaborator`) rather than demanding a URL.

### A3. UI — `views/Collaborators.tsx` (new)

A panel beside `GitRemote.tsx` and `GitHubAccount.tsx`: current
collaborators with avatars, pending invitations marked as such, an add field
taking a GitHub username, and a remove action behind a confirm. Read-only,
with an explanatory line, when the signed-in user is not an admin of the
repository.

### A4. IPC

`github:collaborators`, `github:invite`, `github:uninvite`, `git:clone` —
zod-schema'd in `packages/core/src/ipc.ts` beside the existing github
channels, registered in `main/ipc.ts` through the existing `handle` helper.

**Stage A is done when** a second GitHub account can be invited from inside
SUNA, accept, clone the private project through the Welcome tab, edit,
push, and have the first account see the change in the git panel.

---

## Stage B — The sync core, headless

No network in this stage. All of it is unit-testable, and the correctness of
the whole feature is decided here.

### B1. What changes in `DocSessionCore`

Today the core is a synchronous hub: `applyLocal` folds a view's changes into
`this.doc` and forwards them to the other views, and every view is in this
process. Live editing adds one thing the hub does not have — **the notion of
being behind an authority** — and it already contains the mechanic for it.

The `ViewEntry.pending` field, written so an IME-composing view can queue
remote changes and rebase them through its own composition
(`ChangeSet.map`, `docSessions.ts:117-127`), is exactly the bookkeeping a
network peer needs. Generalize it:

- `version: number` — the last relay version this session has folded in.
- `unconfirmed: ChangeSet | null` — local edits sent to the relay, or waiting
  to be sent, and not yet echoed back. Same rebase discipline as `pending`.
- `applyAuthoritative(changes: ChangeSet, version: number)` — the new entry
  point. Rebases `unconfirmed` over the incoming changes, applies the
  authoritative changes to `this.doc`, delivers them to every view through
  the existing `deliver()` (so IME queuing, selection mapping and comment
  anchors keep working untouched), and advances `version`.
- `takeSendable(): { base: number, changes: ChangeSet } | null` — hands the
  transport the outgoing batch and marks it unconfirmed.

`applyExternal(content: string)` stays exactly as it is and remains the path
for disk reloads and agent edits. Live changes must **not** go through it —
it diffs whole strings, which is right for "the file changed underneath us"
and lossy for "here is precisely what my co-author typed."

`@codemirror/collab` is the reference implementation to read while writing
this, not a dependency to add. Its `collab()` extension assumes one
`EditorState` per client; SUNA's shape is one hub with N local views, so the
bookkeeping belongs in the hub. The primitives it relies on
(`ChangeSet.map`, `.compose`) are already imported here.

### B2. Protocol — `packages/core/src/collab.ts` (new)

Zod schemas, in the style of the existing `ipc.ts` schemas, since the same
messages cross both the IPC boundary and the wire:

- `JoinRequest` — repo slug, relative file path, HEAD commit sha, client id,
  display name, avatar url.
- `JoinAccepted` — `{ version, doc, peers }`.
- `Update` — `{ base, changes: ChangeSetJSON, clientId }`, using
  `ChangeSet.toJSON`/`fromJSON`.
- `Broadcast` — `{ version, changes, clientId }`.
- `Presence` — `{ clientId, anchor, head }`, and join/leave.
- `Rejected` — with a reason enum: `behind-head`, `not-a-collaborator`,
  `no-such-session`, `too-large`.

### B3. Tests — `docSessions.collab.test.ts` (new)

The existing transport-free seam is what makes this cheap. Three levels:

1. **Hand-written interleavings** — the classic ones. Two peers insert at the
   same offset; one deletes a range the other is typing inside; a peer edits
   while three updates are in flight.
2. **Convergence fuzz** — N simulated peers, a scripted relay, random edits
   and random delivery orders, seeded and reproducible. Assert every peer's
   text is identical to the relay's at quiescence. This is the same
   adversarial-verification discipline `hardening.fuzz.test.ts` applies to
   the canvas.
3. **Non-regression** — comment anchors and caret positions survive a remote
   edit landing elsewhere in the file, which is the property `diffSpans`
   multi-span was introduced for and the one a naive implementation breaks
   first.

**Stage B is done when** the fuzz test converges over thousands of seeded
interleavings with no network and no UI in the picture.

---

## Stage C — The relay

New workspace app, `apps/relay`. Node, `ws`, no framework, no database.

Per session, in memory: the authoritative text, a monotonic version, a
bounded log of recent updates for rebasing latecomers, and the connected
peers. Keyed by `{repo slug, file path}`. Created on first join, destroyed
some minutes after the last peer leaves.

**Admission** is the ADR's ACL rule: the joiner presents its GitHub token,
the relay calls `GET /repos/{slug}` with it and requires a 200 and
`permissions.push`. The token is used for that call and dropped. A joiner
whose HEAD sha differs from the session's is rejected `behind-head`, and the
client turns that into "pull first" with a button rather than an error.

**Seeding.** The first peer's buffer becomes the session document, together
with the commit sha it is based on. Everyone after that is admitted only at
that sha, so the document a session starts from is always one both sides
could have produced from the same commit.

**Limits**, because it is a public endpoint: document size, updates per
second per peer, peers per session, sessions per repo. Every rejection is a
typed `Rejected`, never a dropped socket.

Deployment: one small always-on process. Config is a single URL in SUNA's
settings, empty by default — with no relay configured the app is exactly what
it is today, and self-hosting is changing that string.

---

## Stage D — Live in the editor

### D1. Transport — `renderer/src/state/liveSession.ts` (new)

WebSocket client owning reconnect-with-backoff, the version handshake, and
the pump between the socket and `DocSessionCore.takeSendable()` /
`applyAuthoritative()`. Batches sends on an animation frame so a fast typist
produces one message per frame, not one per keystroke.

Disk writes continue on the existing `AUTOSAVE_IDLE_MS` cadence, unchanged —
which is what makes every peer's clone converge byte-identically without a
new save path.

On disconnect: the buffer keeps whatever it has, live decorations disappear,
a status line says the session dropped, and the file is saved. From that
moment divergence is a git problem, handled by machinery that already exists.

### D2. Presence — `renderer/src/editor/presence.ts` (new)

Each peer broadcasts its primary selection, mapped through incoming changes
like any other position. Rendered as CodeMirror decorations: a colored caret
with a name label, and a tinted selection range. Colors assigned from a fixed
palette by client id, so a person is the same color for everyone.

Avatar chips in the editor toolbar for who is present, with a click to jump
to that person's caret.

### D3. Turning it on

Per-project, off by default. A "Live" control in the toolbar of a text
document, disabled with a reason when the project has no remote, the user is
not signed in, no relay is configured, or the working tree is dirty or behind
the remote — each of which is a fixable state with an offered fix, not a
refusal.

**Stage D is done when** two SUNA instances signed in as different GitHub
accounts, on the same commit of a private repo, type in one paragraph and see
each other's carets, and both clones hold identical bytes afterward.

---

## Stage E — Live comments

Cheap once D exists, and disproportionately useful: reviewing together is
most of what co-authors actually do in one sitting.

`comments.json` is append-mostly and comments are anchored by
`quote`/`prefix`/`suffix` rather than by offset, so they already survive
concurrent prose edits. Sync as id-keyed operations — add, edit body,
resolve, delete — merged by id with last-write-wins per field, rather than as
document text. Reuse the same relay session; a different message type.

---

## Not built, and not planned

- **Live figure editing.** ADR-011 §7. Permanent.
- **Live `.bib` and `manuscript.json`.** Both are structured and both are
  edited rarely and deliberately; git covers them.
- **Offline participation in a live session.** ADR-011 §3.
- **Any server-side persistence.** ADR-011 §4.

## Risk register

| risk | mitigation |
|---|---|
| OT bookkeeping is subtle and wrong OT loses text silently | Stage B is fuzz-tested headless before a socket exists; convergence is asserted, not eyeballed |
| we now operate a service | stateless, memory-only, optional, self-hostable; an outage degrades to Stage A |
| a live session and an agent edit collide | agents write to disk, and `flushDirtySessions` already forces a save before an agent runs; a live session must additionally pause the pump while an agent holds the file |
| two peers on different commits | admission requires matching HEAD; rejection carries a "pull first" affordance |
| GitHub rate limits on admission checks | cache a positive membership check for the life of the session |
