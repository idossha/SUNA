# Signing in to GitHub

How SUNA authenticates a user to GitHub, why it is an OAuth App rather than a
GitHub App, and how to register the one this build uses.

> This is the operational procedure, and it is authoritative for it —
> `docs/ARCHITECTURE.md` deliberately does not carry registration steps. The
> reasoning behind the choices is logged in
> [`docs/DECISIONS.md`](DECISIONS.md) 2026-08-19.
>
> **Status: this build has a client id.** `BUILT_IN_CLIENT_ID` in
> `apps/desktop/src/main/services/github-auth.ts` is populated and committed,
> so device-flow sign-in works out of the box. The registration steps below are
> for a fork, or for re-registering the app.

## The decision

**An OAuth App, authenticated with the OAuth 2.0 device flow.**

GitHub's own general advice is to prefer GitHub Apps — fine-grained
permissions, per-repository access, short-lived tokens — and for most
integrations that advice is right. It is not right for this one, for three
reasons that are specific to what SUNA does with the connection.

1. **A GitHub App cannot create the repository.** SUNA's first GitHub action
   is "make a repository for this manuscript". `POST /user/repos` documents
   only OAuth app tokens and classic PATs; creating a repository on a personal
   account is not a fine-grained permission a GitHub App can hold. The primary
   flow would simply not work.

2. **A GitHub App can only push where it is installed.** A user access token
   reaches a repository only if the app is installed on that account or
   organization. A co-author sharing an org repository would have to get SUNA
   installed there before the first push — an admin step, often by someone
   else, in the middle of writing a paper.

3. **User-to-server tokens expire in 8 hours** and need refresh-token
   rotation. That is correct for a server-side integration and pure overhead
   for a desktop app whose token already lives in the OS keychain.

The comparison that settles it is GitHub Desktop, the closest analogue — a
desktop git client that creates repositories and pushes to them. It uses an
OAuth App. So does the `gh` CLI.

### Why device flow, and not the web flow

The web (redirect) flow requires a client **secret**, and GitHub Desktop
really does bundle one into its distributed binary. A secret inside an
application anyone can download is not a secret.

The device flow needs only the client ID, which GitHub documents as public
information. The user gets a short code, types it at `github.com/login/device`,
and SUNA polls until GitHub says yes. Nothing confidential is shipped, so
there is nothing to leak.

## Registering the app

One-time, by whoever maintains the build.

1. Go to <https://github.com/settings/applications/new>
2. Fill in:

   | Field | Value |
   |---|---|
   | Application name | `SUNA` |
   | Homepage URL | the project's repository or site |
   | Authorization callback URL | `https://github.com/login/device` |
   | Enable Device Flow | **ticked** — without this the flow returns `device_flow_disabled` |

   The callback URL is unused by the device flow but the form requires one.

3. Register, then copy the **Client ID**. Do **not** generate a client secret;
   nothing here uses one.
4. Paste it into `BUILT_IN_CLIENT_ID` in
   `apps/desktop/src/main/services/github-auth.ts` and commit it. It is public
   and belongs in version control.

Anyone running a fork, or pointing SUNA at their own app, can override it at
runtime with `SUNA_GITHUB_CLIENT_ID` instead.

If the value is wrong the panel says so rather than failing at the first
request — including the specific case of pasting a client secret (40 hex
characters) into the id slot, which would otherwise be committed and rejected
by GitHub with an error naming neither problem.

## Scopes

`repo read:org`.

`repo` is what creating a repository and pushing to a private one need; it is
the narrowest scope that covers both, because OAuth Apps have no finer grain.
`read:org` is only so the owner picker can list organizations the user could
publish into — without it the list is just the user, which still works.

Nothing requested here grants deletion.

## Signing out

Sign-out deletes the token from the keychain. It does **not** revoke it
server-side: GitHub's token-revocation endpoint authenticates with
`client_id:client_secret`, and a public client has no secret to authenticate
with. A user who wants the authorization itself withdrawn does it at
<https://github.com/settings/applications>, which the panel should say when
this comes up.

## What the token is used for

- `GET /user` — who is signed in, and which scopes the token actually carries.
- `GET /user/orgs` — the owner picker.
- `POST /user/repos` or `POST /orgs/{org}/repos` — creating the repository.
- Git pushes over HTTPS, via `GIT_ASKPASS` on a child-process environment
  variable. Never written into `.git/config`, and never passed as a process
  argument. See `git-credential.ts`.

SSH remains the default transport and needs none of this.
