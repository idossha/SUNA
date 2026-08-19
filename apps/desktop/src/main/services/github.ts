import { gitSetRemote } from './git-remote'
import { githubHeaders } from './github-auth'
import { assertInsideAllowedRoot } from './roots'

/* ---------------------------------------------------------------------------
   Creating the remote repository from inside SUNA.

   This talks to GitHub's REST API with the token from the device-flow sign-in
   (github-auth.ts) — no CLI on PATH, no pasted token, nothing for the user to
   install. The token is read one call at a time and never stored here.
   --------------------------------------------------------------------------- */

const API = 'https://api.github.com'

export type GhVisibility = 'private' | 'public' | 'internal'

export interface GhCreateResult {
  /** owner/name of the repository that now exists on GitHub. */
  slug: string
  /** Web URL, for the confirmation link. */
  htmlUrl: string
  /** The remote SUNA stored. */
  remoteUrl: string
}

export interface GhOwner {
  login: string
  /** 'user' for the signed-in account, 'org' for an organization. */
  kind: 'user' | 'org'
  avatarUrl: string | null
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

async function requireHeaders(): Promise<Record<string, string>> {
  const headers = await githubHeaders()
  if (headers === null) {
    throw new Error('Not signed in to GitHub — sign in first, then try again.')
  }
  return headers
}

/**
 * Accounts the signed-in user may create a repository under: themselves, plus
 * every organization the token can see. Organizations require the `read:org`
 * scope; without it the list is just the user, which still works.
 */
export async function githubOwners(): Promise<{ owners: GhOwner[] }> {
  const headers = await requireHeaders()

  const me = await fetch(`${API}/user`, { headers }).catch(() => null)
  const owners: GhOwner[] = []
  if (me !== null && me.ok) {
    const body = (await me.json().catch(() => ({}))) as Record<string, unknown>
    const login = str(body['login'])
    if (login !== '') {
      owners.push({
        login,
        kind: 'user',
        avatarUrl: str(body['avatar_url']) === '' ? null : str(body['avatar_url'])
      })
    }
  }

  const orgs = await fetch(`${API}/user/orgs?per_page=100`, { headers }).catch(() => null)
  if (orgs !== null && orgs.ok) {
    const body = (await orgs.json().catch(() => [])) as unknown
    if (Array.isArray(body)) {
      for (const entry of body) {
        if (typeof entry !== 'object' || entry === null) continue
        const record = entry as Record<string, unknown>
        const login = str(record['login'])
        if (login === '') continue
        owners.push({
          login,
          kind: 'org',
          avatarUrl: str(record['avatar_url']) === '' ? null : str(record['avatar_url'])
        })
      }
    }
  }
  return { owners }
}

/**
 * Create an empty repository on GitHub and point `origin` at it.
 *
 * Deliberately does NOT push: creating a repository is reversible from the
 * user's side and only they know whether the working tree is ready to leave
 * the machine, so the first push stays the explicit "Publish branch" click.
 */
export async function ghCreateRepo(
  dir: string,
  name: string,
  visibility: GhVisibility,
  owner: string | null,
  description: string | null,
  useHttps: boolean
): Promise<GhCreateResult> {
  const abs = assertInsideAllowedRoot(dir)

  // Every check that can be made without the network comes first, so a bad
  // name reports the bad name rather than "not signed in".
  const repo = name.trim()
  if (!NAME_RE.test(repo)) {
    throw new Error(
      'A repository name may use letters, digits, dot, dash and underscore, and must start with a letter or digit.'
    )
  }
  const ownerName = owner === null || owner.trim() === '' ? null : owner.trim()
  if (ownerName !== null && !OWNER_RE.test(ownerName)) {
    throw new Error(`Not a valid GitHub account or organization name: ${ownerName}`)
  }

  // 'internal' is an organization-only visibility; the /user/repos endpoint
  // rejects it, which would otherwise surface as an opaque 422.
  if (visibility === 'internal' && ownerName === null) {
    throw new Error('Internal visibility only exists inside an organization — pick an owner first.')
  }

  const headers = await requireHeaders()
  const endpoint = ownerName === null ? `${API}/user/repos` : `${API}/orgs/${ownerName}/repos`
  const body: Record<string, unknown> = { name: repo, visibility, private: visibility !== 'public' }
  if (description !== null && description.trim() !== '') body['description'] = description.trim()

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch((error: unknown) => {
    throw new Error(
      `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`
    )
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(explainCreateFailure(response.status, payload))
  }

  const slug = str(payload['full_name'])
  const htmlUrl = str(payload['html_url'])
  const sshUrl = str(payload['ssh_url'])
  const cloneUrl = str(payload['clone_url'])
  if (slug === '' || htmlUrl === '') {
    throw new Error('GitHub created the repository but returned an unexpected response.')
  }

  // SSH by default (the transport that needs no token at push time); HTTPS
  // only when the caller says the signed-in credential helper will carry it.
  const preferred = useHttps ? cloneUrl : sshUrl
  const fallback = useHttps ? sshUrl : cloneUrl
  const remote = preferred !== '' ? preferred : fallback !== '' ? fallback : htmlUrl
  const set = await gitSetRemote(abs, remote, useHttps)
  return { slug, htmlUrl, remoteUrl: set.url }
}

/** Name the fixable cause of a failed creation; the rest passes through. */
export function explainCreateFailure(status: number, payload: Record<string, unknown>): string {
  const message = str(payload['message'])
  const errors = Array.isArray(payload['errors'])
    ? (payload['errors'] as unknown[])
        .map((entry) =>
          typeof entry === 'object' && entry !== null
            ? str((entry as Record<string, unknown>)['message'])
            : ''
        )
        .filter((entry) => entry !== '')
    : []
  const detail = [message, ...errors].filter((part) => part !== '').join(' — ')

  if (errors.some((entry) => /already exists/i.test(entry)) || /already exists/i.test(message)) {
    return `A repository with that name already exists on that account. Pick another name, or paste the existing repository's URL as the remote instead.\n\n${detail}`
  }
  if (status === 401) {
    return `GitHub rejected the sign-in — sign out and in again.\n\n${detail}`
  }
  if (status === 403) {
    return `This account is not allowed to create that repository (no rights on the organization, or the sign-in is missing the \`repo\` scope).\n\n${detail}`
  }
  if (status === 404) {
    return `GitHub has no such organization, or this account cannot see it.\n\n${detail}`
  }
  return detail === '' ? `GitHub refused the request (HTTP ${status}).` : detail
}
