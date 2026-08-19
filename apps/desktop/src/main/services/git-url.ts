/* ---------------------------------------------------------------------------
   Remote URL shapes.

   Its own module so that both the remote service and the credential bridge can
   classify a URL without importing each other — the credential bridge needs to
   know "is this HTTPS, and is it GitHub" before it will hand over a token.
   --------------------------------------------------------------------------- */

export type GitRemoteProtocol = 'ssh' | 'https' | 'other'

export interface ParsedRemote {
  protocol: GitRemoteProtocol
  host: string | null
  path: string | null
}

const SSH_URL = /^ssh:\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/
const HTTP_URL = /^https?:\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/
const SCP_LIKE = /^(?:[^@\s/]+@)?([^:\s/]+):(?!\/)(.+)$/

/** Classify a remote url; no network, no filesystem. */
export function parseRemoteUrl(url: string): ParsedRemote {
  const value = url.trim()
  if (value === '') return { protocol: 'other', host: null, path: null }

  const ssh = SSH_URL.exec(value)
  if (ssh) return { protocol: 'ssh', host: ssh[1] ?? null, path: normalizeRepoPath(ssh[2]) }

  const http = HTTP_URL.exec(value)
  if (http) return { protocol: 'https', host: http[1] ?? null, path: normalizeRepoPath(http[2]) }

  // scp-like (git@github.com:owner/repo.git). Checked last and only when there
  // is no scheme, so 'https://…' can never fall through into it.
  if (!value.includes('://')) {
    const scp = SCP_LIKE.exec(value)
    if (scp) return { protocol: 'ssh', host: scp[1] ?? null, path: normalizeRepoPath(scp[2]) }
  }
  return { protocol: 'other', host: null, path: null }
}

function normalizeRepoPath(path: string | undefined): string | null {
  if (path === undefined) return null
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed === '') return null
  return trimmed.endsWith('.git') ? trimmed : `${trimmed}.git`
}

/** `https://github.com/owner/repo` → `git@github.com:owner/repo.git`. */
export function toSshUrl(url: string): string | null {
  const parsed = parseRemoteUrl(url)
  if (parsed.protocol === 'other' || parsed.host === null || parsed.path === null) return null
  return `git@${parsed.host}:${parsed.path}`
}

/** `git@github.com:owner/repo.git` → `https://github.com/owner/repo.git`. */
export function toHttpsUrl(url: string): string | null {
  const parsed = parseRemoteUrl(url)
  if (parsed.protocol === 'other' || parsed.host === null || parsed.path === null) return null
  return `https://${parsed.host}/${parsed.path}`
}
