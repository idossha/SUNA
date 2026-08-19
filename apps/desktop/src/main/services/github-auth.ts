import { getSecret, setSecret } from './agent-keys'

/* ---------------------------------------------------------------------------
   Signing in to GitHub, the way VS Code does — OAuth, not a pasted token.

   This is the OAuth 2.0 **device flow**: SUNA asks GitHub for a short user
   code, the user types it at github.com/login/device, and SUNA polls until
   GitHub hands back an access token. The flow exists precisely for apps that
   cannot host a redirect URL, which is every desktop app without a registered
   custom scheme.

   Why device flow and not the web flow: the web flow requires a client
   SECRET, and a secret shipped inside a desktop binary is not a secret. The
   device flow requires only the client ID, which GitHub documents as public
   information. So there is nothing confidential in this file — the only
   sensitive value is the resulting user token, which goes straight into the
   OS keychain via safeStorage (see agent-keys.ts) and is never logged.
   --------------------------------------------------------------------------- */

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const API = 'https://api.github.com'

/** Slot in the encrypted store; namespaced away from agent provider ids. */
const TOKEN_SLOT = 'github:token'

/**
 * `repo` is what creating a repository and pushing to a private one need;
 * `read:org` is what lets the owner picker list organizations the user can
 * publish into. Nothing here grants deletion.
 */
const SCOPES = 'repo read:org'

/**
 * The OAuth App's client ID. See docs/design/github-oauth-app.md for how this
 * one was registered and why an OAuth App rather than a GitHub App.
 *
 * PUBLIC by design, and committed on purpose: GitHub documents client IDs as
 * non-secret, and the device flow uses no client secret at all. (GitHub
 * Desktop bundles both an id AND a secret into its binary; needing only the
 * id is the whole reason this flow was chosen.)
 *
 * `SUNA_GITHUB_CLIENT_ID` overrides it at runtime — for a fork, or for
 * anyone pointing SUNA at their own OAuth App.
 */
const BUILT_IN_CLIENT_ID = 'Ov23liNjXZl4PKbGdBWg'

/**
 * Client IDs are opaque, and GitHub has changed their shape more than once
 * ('Iv1.' + hex, later 'Ov23li…'), so this checks only that the value could
 * be one: printable, no whitespace, no punctuation a URL-encoder would maul.
 */
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{8,100}$/

/** A client SECRET is 40 hex characters. A client ID never is. */
const LOOKS_LIKE_SECRET = /^[0-9a-f]{40}$/

/**
 * Why the configured client id cannot be used, or null when it can.
 *
 * The secret check is the one worth having: pasting the secret into this slot
 * is an easy mistake, it would be committed like the id, and GitHub would
 * reject it with an error that names neither problem.
 */
export function clientIdProblem(raw: string): string | null {
  if (raw === '') return null // simply not configured; not an error
  if (LOOKS_LIKE_SECRET.test(raw)) {
    return 'That value looks like an OAuth client SECRET, not a client ID. Remove it — the device flow needs no secret, and a secret must never be committed.'
  }
  if (!CLIENT_ID_RE.test(raw)) {
    return `That does not look like a GitHub OAuth client ID: ${raw.slice(0, 12)}…`
  }
  return null
}

export function githubClientId(): string | null {
  // `??` and not `||`: setting SUNA_GITHUB_CLIENT_ID to an EMPTY string is a
  // deliberate override meaning "this build has no app", which is how the
  // unconfigured path stays testable now that a real id ships in the binary.
  const raw = (process.env['SUNA_GITHUB_CLIENT_ID'] ?? BUILT_IN_CLIENT_ID).trim()
  if (raw === '' || clientIdProblem(raw) !== null) return null
  return raw
}

export function githubConfigured(): boolean {
  return githubClientId() !== null
}

/** The configured value's problem, for the panel to show. Null when fine. */
export function githubConfigProblem(): string | null {
  return clientIdProblem((process.env['SUNA_GITHUB_CLIENT_ID'] ?? BUILT_IN_CLIENT_ID).trim())
}

/** In-memory copy so a signed-in session survives a keychain that refuses writes. */
let memoryToken: string | null = null

export async function githubToken(): Promise<string | null> {
  if (memoryToken !== null) return memoryToken
  const stored = await getSecret(TOKEN_SLOT).catch(() => null)
  if (stored !== null && stored !== '') memoryToken = stored
  return memoryToken
}

async function storeToken(token: string): Promise<boolean> {
  memoryToken = token
  try {
    await setSecret(TOKEN_SLOT, token)
    return true
  } catch {
    // No OS keyring (a bare Linux session, typically). The token still works
    // for this run; the caller reports that it will not outlive the app.
    return false
  }
}

export async function githubSignOut(): Promise<void> {
  memoryToken = null
  await setSecret(TOKEN_SLOT, '').catch(() => undefined)
}

/* ---- the flow ------------------------------------------------------------ */

export interface DeviceCodeResult {
  /** The code the user types into GitHub — shown large, and copyable. */
  userCode: string
  /** Where to type it: https://github.com/login/device. */
  verificationUri: string
  /** Opaque handle the poll step passes back; not shown to the user. */
  deviceCode: string
  /** Seconds until the code dies (GitHub: 900). */
  expiresIn: number
  /** Minimum seconds between polls (GitHub: 5). */
  interval: number
}

interface DeviceCodePayload {
  device_code?: unknown
  user_code?: unknown
  verification_uri?: unknown
  expires_in?: unknown
  interval?: unknown
  error?: unknown
  error_description?: unknown
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Step 1: ask GitHub for a user code. */
export async function startDeviceFlow(): Promise<DeviceCodeResult> {
  const clientId = githubClientId()
  if (clientId === null) {
    throw new Error(
      'SUNA has no GitHub OAuth App configured yet, so it cannot sign in. See github-auth.ts for the one-time setup.'
    )
  }

  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: SCOPES })
  }).catch((error: unknown) => {
    throw new Error(`Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`)
  })

  const payload = (await response.json().catch(() => ({}))) as DeviceCodePayload
  if (str(payload.error) !== '') {
    throw new Error(explainDeviceError(str(payload.error), str(payload.error_description)))
  }
  const deviceCode = str(payload.device_code)
  const userCode = str(payload.user_code)
  if (deviceCode === '' || userCode === '') {
    throw new Error(`GitHub returned no device code (HTTP ${response.status}).`)
  }
  return {
    userCode,
    verificationUri: str(payload.verification_uri) || 'https://github.com/login/device',
    deviceCode,
    expiresIn: num(payload.expires_in, 900),
    interval: num(payload.interval, 5)
  }
}

export type DevicePollStatus = 'pending' | 'authorized' | 'denied' | 'expired'

export interface DevicePollResult {
  status: DevicePollStatus
  /** Seconds to wait before the next poll; grows when GitHub says slow_down. */
  interval: number
  /** Set once authorized: the account that just signed in. */
  account: GitHubAccount | null
  /** False when the token could not be written to the OS keychain. */
  persisted: boolean
  message: string | null
}

/**
 * Step 2, ONE attempt.
 *
 * Deliberately a single poll rather than a loop that resolves when the user
 * finishes: the renderer owns the timer, so cancelling the dialog cancels the
 * flow, and no orphaned interval keeps hitting GitHub after the panel closes.
 */
export async function pollDeviceFlow(
  deviceCode: string,
  interval: number
): Promise<DevicePollResult> {
  const clientId = githubClientId()
  if (clientId === null) throw new Error('No GitHub OAuth App is configured.')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  }).catch((error: unknown) => {
    throw new Error(`Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`)
  })

  const payload = (await response.json().catch(() => ({}))) as DeviceCodePayload & {
    access_token?: unknown
  }
  const error = str(payload.error)

  if (error === 'authorization_pending') {
    return { status: 'pending', interval, account: null, persisted: false, message: null }
  }
  if (error === 'slow_down') {
    // GitHub's documented remedy is +5s, and it means it: keep polling faster
    // and the flow is rate-limited out entirely.
    return {
      status: 'pending',
      interval: num(payload.interval, interval + 5),
      account: null,
      persisted: false,
      message: null
    }
  }
  if (error === 'expired_token') {
    return {
      status: 'expired',
      interval,
      account: null,
      persisted: false,
      message: 'That code expired. Start again to get a new one.'
    }
  }
  if (error === 'access_denied') {
    return {
      status: 'denied',
      interval,
      account: null,
      persisted: false,
      message: 'Sign-in was cancelled on GitHub.'
    }
  }
  if (error !== '') {
    throw new Error(explainDeviceError(error, str(payload.error_description)))
  }

  const token = str(payload.access_token)
  if (token === '') throw new Error(`GitHub returned no access token (HTTP ${response.status}).`)

  const persisted = await storeToken(token)
  const account = await githubAccount()
  return {
    status: 'authorized',
    interval,
    account,
    persisted,
    message: persisted
      ? null
      : 'Signed in, but this machine has no secure keychain — you will have to sign in again next time SUNA starts.'
  }
}

function explainDeviceError(code: string, description: string): string {
  const detail = description === '' ? '' : `\n\n${description}`
  if (code === 'device_flow_disabled') {
    return `The GitHub OAuth App exists but does not have Device Flow enabled. Turn it on in the app's settings on GitHub.${detail}`
  }
  // 'Not Found' is what github.com/login/device/code actually answers (404)
  // for a client id it has never issued — verified against the live endpoint.
  // Left generic it reads as "GitHub refused the sign-in (Not Found)", which
  // names neither the cause nor the fix for the likeliest misconfiguration
  // there is: a wrong, deleted, or never-registered app.
  if (
    code === 'Not Found' ||
    code === 'incorrect_client_credentials' ||
    code === 'unauthorized_client'
  ) {
    return `GitHub does not recognize SUNA's OAuth client ID — it may be wrong, or the app may have been deleted.${detail}`
  }
  return `GitHub refused the sign-in (${code}).${detail}`
}

/* ---- who is signed in ---------------------------------------------------- */

export interface GitHubAccount {
  login: string
  name: string | null
  avatarUrl: string | null
  htmlUrl: string
  /** Scopes the token actually carries, per the response header. */
  scopes: string[]
}

export interface GitHubSession {
  configured: boolean
  signedIn: boolean
  account: GitHubAccount | null
  /** True when the token is missing the `repo` scope creation/push needs. */
  needsReauth: boolean
  message: string | null
}

/** Common headers for every REST call; the token never leaves this module's callers. */
export async function githubHeaders(): Promise<Record<string, string> | null> {
  const token = await githubToken()
  if (token === null) return null
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

/** `GET /user`, or null when there is no usable token. */
export async function githubAccount(): Promise<GitHubAccount | null> {
  const headers = await githubHeaders()
  if (headers === null) return null
  const response = await fetch(`${API}/user`, { headers }).catch(() => null)
  if (response === null || !response.ok) return null
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  const login = str(body['login'])
  if (login === '') return null
  return {
    login,
    name: str(body['name']) === '' ? null : str(body['name']),
    avatarUrl: str(body['avatar_url']) === '' ? null : str(body['avatar_url']),
    htmlUrl: str(body['html_url']) || `https://github.com/${login}`,
    scopes: (response.headers.get('x-oauth-scopes') ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope !== '')
  }
}

/**
 * The panel's whole view of GitHub auth in one call: whether sign-in is even
 * possible, whether it happened, and whether the token can still do the work.
 *
 * A stored token that GitHub has since revoked comes back as signed-out rather
 * than as an error, because that is what it is from the user's side.
 */
export async function githubSession(): Promise<GitHubSession> {
  if (!githubConfigured()) {
    // A misconfigured id and an absent one are different problems, and only
    // one of them is somebody's mistake.
    const problem = githubConfigProblem()
    return {
      configured: false,
      signedIn: false,
      account: null,
      needsReauth: false,
      message:
        problem ??
        'This build has no GitHub OAuth App configured, so SUNA cannot sign in to GitHub. You can still use SSH, which needs no sign-in.'
    }
  }
  const token = await githubToken()
  if (token === null) {
    return { configured: true, signedIn: false, account: null, needsReauth: false, message: null }
  }
  const account = await githubAccount()
  if (account === null) {
    return {
      configured: true,
      signedIn: false,
      account: null,
      needsReauth: true,
      message: 'The stored GitHub sign-in is no longer valid — sign in again.'
    }
  }
  const needsReauth = account.scopes.length > 0 && !account.scopes.includes('repo')
  return {
    configured: true,
    signedIn: true,
    account,
    needsReauth,
    message: needsReauth
      ? 'This sign-in cannot create or push to repositories (it is missing the `repo` scope). Sign out and in again.'
      : null
  }
}
