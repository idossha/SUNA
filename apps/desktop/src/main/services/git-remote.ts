import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runGit } from './git'
import { remoteAuthEnv } from './git-credential'
import { parseRemoteUrl, toSshUrl, type GitRemoteProtocol } from './git-url'
import { assertInsideAllowedRoot } from './roots'

const run = promisify(execFile)

/* ---------------------------------------------------------------------------
   Remotes, SSH-first.

   A manuscript's off-machine backup is a git remote, and the only credential
   flow that works from a windowless GUI process is a key ssh-agent already
   holds: HTTPS would need a username/password prompt SUNA cannot show, and a
   prompt with no terminal attached hangs the push forever. So remotes are
   stored in SSH form unless the user explicitly asks for HTTPS, and every
   network call runs with prompts disabled.
   --------------------------------------------------------------------------- */

export type { GitRemoteProtocol, ParsedRemote } from './git-url'
export { parseRemoteUrl, toHttpsUrl, toSshUrl } from './git-url'

export interface GitRemoteInfo {
  /** 'origin' when it exists; null when the repo has no remote yet. */
  name: string | null
  url: string | null
  protocol: GitRemoteProtocol | null
  /** Host the remote points at ('github.com'), for the SSH probe and guide. */
  host: string | null
  /** SSH equivalent of an HTTPS url, when it converts; null otherwise. */
  sshUrl: string | null
  /** 'owner/name' when the url names a hosted repository; null for a path. */
  slug: string | null
  /** e.g. 'origin/main'; null when the branch tracks nothing yet. */
  upstream: string | null
  /** Counted against the last-fetched remote ref, not a live query. */
  ahead: number
  behind: number
  hasCommits: boolean
  branch: string | null
}

export async function gitRemote(dir: string): Promise<GitRemoteInfo> {
  const abs = assertInsideAllowedRoot(dir)

  const url = (await runGit(abs, ['remote', 'get-url', 'origin']).catch(() => '')).trim()
  const branchRaw = (await runGit(abs, ['branch', '--show-current']).catch(() => '')).trim()
  const branch = branchRaw === '' ? null : branchRaw
  const hasCommits = await runGit(abs, ['rev-parse', '--verify', 'HEAD']).then(
    () => true,
    () => false
  )
  const upstreamRaw = (
    await runGit(abs, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(
      () => ''
    )
  ).trim()
  const upstream = upstreamRaw === '' ? null : upstreamRaw

  let ahead = 0
  let behind = 0
  if (upstream !== null && hasCommits) {
    const counts = (
      await runGit(abs, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).catch(
        () => ''
      )
    ).trim()
    const [behindRaw, aheadRaw] = counts.split(/\s+/)
    behind = Number.parseInt(behindRaw ?? '', 10) || 0
    ahead = Number.parseInt(aheadRaw ?? '', 10) || 0
  }

  if (url === '') {
    return {
      name: null,
      url: null,
      protocol: null,
      host: null,
      sshUrl: null,
      slug: null,
      upstream,
      ahead,
      behind,
      hasCommits,
      branch
    }
  }
  const parsed = parseRemoteUrl(url)
  return {
    name: 'origin',
    url,
    protocol: parsed.protocol,
    host: parsed.host,
    sshUrl: parsed.protocol === 'https' ? toSshUrl(url) : null,
    slug: parsed.path === null ? null : parsed.path.replace(/\.git$/, ''),
    upstream,
    ahead,
    behind,
    hasCommits,
    branch
  }
}

export interface SetRemoteResult {
  url: string
  protocol: GitRemoteProtocol
  /** True when an HTTPS url was rewritten to its SSH form. */
  converted: boolean
}

/**
 * Point `origin` at `url`, rewriting HTTPS to SSH unless the caller opts out.
 * execFile means no shell, but a leading '-' would still reach git as a flag,
 * so that and embedded whitespace are refused outright.
 */
export async function gitSetRemote(
  dir: string,
  url: string,
  allowHttps: boolean
): Promise<SetRemoteResult> {
  const abs = assertInsideAllowedRoot(dir)
  const raw = url.trim()
  if (raw === '') throw new Error('Enter a remote URL.')
  if (raw.startsWith('-')) throw new Error('A remote URL cannot start with "-".')
  if (/\s/.test(raw)) throw new Error('A remote URL cannot contain spaces.')

  const parsed = parseRemoteUrl(raw)
  // An absolute path is a real remote too (a backup disk, a shared volume);
  // it needs no credentials, so it bypasses the SSH-vs-HTTPS question entirely.
  const isLocalPath = raw.startsWith('/') || raw.startsWith('file://')
  if (parsed.protocol === 'other' && !isLocalPath) {
    throw new Error(
      `git cannot use that URL. Expected git@host:owner/repo.git or https://host/owner/repo — got: ${raw}`
    )
  }

  let final = raw
  let converted = false
  if (parsed.protocol === 'https' && !allowHttps) {
    const ssh = toSshUrl(raw)
    if (ssh !== null) {
      final = ssh
      converted = true
    }
  }

  const existing = (await runGit(abs, ['remote', 'get-url', 'origin']).catch(() => '')).trim()
  if (existing === '') await runGit(abs, ['remote', 'add', 'origin', final])
  else await runGit(abs, ['remote', 'set-url', 'origin', final])

  return { url: final, protocol: parseRemoteUrl(final).protocol, converted }
}

export interface GitPushResult {
  branch: string
  remote: string
  /** True when this push also set the branch's upstream (the first push). */
  setUpstream: boolean
  output: string
}

/**
 * Push the current branch to origin, setting upstream on the first push.
 * Failures are translated into the one sentence that says what to do next —
 * git's own stderr is kept underneath it, because it often names the key.
 */
export async function gitPush(dir: string): Promise<GitPushResult> {
  const abs = assertInsideAllowedRoot(dir)
  const info = await gitRemote(abs)
  if (info.url === null) throw new Error('This repository has no remote yet — add one first.')
  if (!info.hasCommits) throw new Error('Nothing to push yet — make a commit first.')
  if (info.branch === null) {
    throw new Error('HEAD is detached; check out a branch before pushing.')
  }

  const setUpstream = info.upstream === null
  const args = setUpstream ? ['push', '-u', 'origin', info.branch] : ['push']
  try {
    const output = await runGit(abs, args, await remoteEnv(info.url))
    return { branch: info.branch, remote: 'origin', setUpstream, output }
  } catch (error) {
    throw new Error(explainPushFailure(error instanceof Error ? error.message : String(error)))
  }
}

export interface RemoteCheck {
  /** The remote answered and the repository exists. */
  reachable: boolean
  /** The host answered but has no such repository — the fixable case. */
  missing: boolean
  message: string
}

/**
 * Ask the remote whether it is actually there. `git remote add` records a
 * string without contacting anything, so a typo — or a repository the user
 * meant to create and did not — stays invisible until the first push fails.
 * This turns that into an answer at the moment the remote is set.
 */
export async function gitCheckRemote(dir: string): Promise<RemoteCheck> {
  const abs = assertInsideAllowedRoot(dir)
  const info = await gitRemote(abs)
  if (info.url === null) return { reachable: false, missing: false, message: 'No remote set.' }
  try {
    await runGit(abs, ['ls-remote', '--heads', 'origin'], await remoteEnv(info.url))
    return { reachable: true, missing: false, message: 'Remote reachable.' }
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).trim()
    const missing = /repository not found|does not appear to be a git repository|not found/i.test(
      detail
    )
    return { reachable: false, missing, message: explainPushFailure(detail) }
  }
}

/**
 * Env that makes git fail fast rather than prompt a terminal we do not have.
 *
 * `auth` is the credential bridge's contribution (see git-credential.ts) and
 * is merged LAST, because when it is present it supplies a GIT_ASKPASS that
 * must survive the blanking done here for the unauthenticated case.
 */
export function nonInteractiveEnv(auth?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: ''
  }
  // Respect a user's own GIT_SSH_COMMAND (custom key, proxy, 1Password agent).
  if (process.env['GIT_SSH_COMMAND'] === undefined) {
    env['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o ConnectTimeout=15'
  }
  return auth === undefined ? env : { ...env, ...auth }
}

/** The non-interactive env for one remote URL, credential bridge included. */
export async function remoteEnv(url: string | null): Promise<NodeJS.ProcessEnv> {
  return nonInteractiveEnv(await remoteAuthEnv(url))
}

/** Turn git's push stderr into the one sentence that says what to do next. */
export function explainPushFailure(detail: string): string {
  const text = detail.trim()
  if (/permission denied \(publickey|host key verification|no matching host key/i.test(text)) {
    return `SSH could not authenticate with the remote. Set up an SSH key (steps below), then push again.\n\n${text}`
  }
  if (/terminal prompts disabled|authentication failed|could not read username/i.test(text)) {
    return `This remote asks for a username and password, which SUNA cannot prompt for. Switch it to SSH and push again.\n\n${text}`
  }
  if (/could not read from remote repository|repository not found/i.test(text)) {
    return `The remote refused the connection — the URL may be wrong, the repository may not exist yet, or your key may not be authorized for it.\n\n${text}`
  }
  if (/non-fast-forward|fetch first|behind its remote/i.test(text)) {
    return `The remote has commits you do not have. Pull them first (git pull --rebase in a terminal), then push again.\n\n${text}`
  }
  return text
}

/* ---- SSH readiness ------------------------------------------------------- */

export interface SshPublicKey {
  /** File name only ('id_ed25519.pub'); the private key is never read. */
  file: string
  type: string
  comment: string
  /** Full public key line, so the user can paste it into the host. */
  publicKey: string
}

export interface SshStatus {
  host: string
  sshDir: string
  keys: SshPublicKey[]
  /** Identities ssh-agent holds; null when ssh-add could not be run. */
  agentKeys: number | null
  /** Result of a live probe; null when no probe was requested. */
  authenticated: boolean | null
  probeMessage: string | null
  /** git's user.name / user.email — commits fail without them. */
  identity: { name: string | null; email: string | null }
}

const KEY_LINE = /^(\S+)\s+\S+(?:\s+(.*))?$/

/**
 * What the machine already has for SSH pushing. Reads only `*.pub` files —
 * private keys are never opened, and nothing here is ever sent anywhere except
 * the optional probe, which is a plain `ssh -T` to the host of the remote.
 */
export async function sshStatus(host: string, probe: boolean): Promise<SshStatus> {
  const safeHost = /^[A-Za-z0-9._-]+$/.test(host) ? host : 'github.com'
  const sshDir = join(homedir(), '.ssh')

  const keys: SshPublicKey[] = []
  try {
    const names = (await readdir(sshDir)).filter((n) => n.endsWith('.pub')).sort()
    for (const file of names) {
      const full = join(sshDir, file)
      const info = await stat(full).catch(() => null)
      if (info === null || !info.isFile() || info.size > 64 * 1024) continue
      const line = (await readFile(full, 'utf8').catch(() => '')).trim()
      const match = KEY_LINE.exec(line)
      if (match === null) continue
      keys.push({
        file,
        type: match[1] ?? '',
        comment: (match[2] ?? '').trim(),
        publicKey: line
      })
    }
  } catch {
    // no ~/.ssh at all: keys stays empty, and the guide starts at ssh-keygen.
  }

  const agentKeys = await countAgentKeys()
  const identity = await gitIdentity()

  let authenticated: boolean | null = null
  let probeMessage: string | null = null
  if (probe) {
    const result = await probeSshHost(safeHost)
    authenticated = result.authenticated
    probeMessage = result.message
  }

  return { host: safeHost, sshDir, keys, agentKeys, authenticated, probeMessage, identity }
}

async function countAgentKeys(): Promise<number | null> {
  try {
    const { stdout } = await run('ssh-add', ['-l'], { timeout: 5000 })
    return stdout.split('\n').filter((l) => l.trim() !== '').length
  } catch (error) {
    // exit 1 = agent running but empty; anything else = no agent / no ssh-add.
    const code = (error as { code?: unknown }).code
    return code === 1 ? 0 : null
  }
}

async function gitIdentity(): Promise<{ name: string | null; email: string | null }> {
  const read = async (key: string): Promise<string | null> => {
    try {
      const { stdout } = await run('git', ['config', '--get', key], { timeout: 5000 })
      const value = stdout.trim()
      return value === '' ? null : value
    } catch {
      return null
    }
  }
  const [name, email] = await Promise.all([read('user.name'), read('user.email')])
  return { name, email }
}

/**
 * `ssh -T git@host`. GitHub answers with a greeting and exit code 1, GitLab
 * with a welcome and exit 0 — success is the greeting, not the exit code.
 */
async function probeSshHost(host: string): Promise<{ authenticated: boolean; message: string }> {
  const args = [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=15',
    `git@${host}`
  ]
  let text: string
  try {
    const { stdout, stderr } = await run('ssh', args, { timeout: 25_000 })
    text = `${stdout}${stderr}`.trim()
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    text = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || (e.message ?? 'ssh failed')
  }
  const authenticated = /successfully authenticated|welcome to gitlab|logged in as/i.test(text)
  return { authenticated, message: text }
}
