import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import { GitHubAccount } from './GitHubAccount'

type RemoteInfo = ResponseOf<'git:remote'>
type SshStatus = ResponseOf<'git:ssh-status'>
type Session = ResponseOf<'github:session'>
type Owners = ResponseOf<'github:owners'>
type RemoteCheck = ResponseOf<'git:check-remote'>
type Visibility = 'private' | 'public' | 'internal'

/** A GitHub repository name from a project folder name. */
export function repoNameFromDir(dir: string): string {
  const base = dir.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'manuscript' : cleaned.slice(0, 100)
}

const KEYGEN = 'ssh-keygen -t ed25519 -C "you@example.com"'
const AGENT_ADD = 'ssh-add --apple-use-keychain ~/.ssh/id_ed25519'

function hostKeyPage(host: string | null): string {
  const h = host ?? 'github.com'
  if (h.endsWith('github.com')) return 'https://github.com/settings/ssh/new'
  if (h.endsWith('gitlab.com')) return 'https://gitlab.com/-/user_settings/ssh_keys'
  return `https://${h}`
}

function Command({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="git__cmd">
      <code>{text}</code>
      <button
        className="btn"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Step({
  done,
  title,
  children
}: {
  done: boolean | null
  title: string
  children: React.ReactNode
}): JSX.Element {
  const mark = done === null ? '·' : done ? '✓' : '!'
  return (
    <div className="git__step">
      <div className="git__step-head">
        <span
          className={`git__step-mark git__step-mark--${done === null ? 'unknown' : done ? 'ok' : 'todo'}`}
        >
          {mark}
        </span>
        <span>{title}</span>
      </div>
      <div className="git__step-body">{children}</div>
    </div>
  )
}

/**
 * The SSH checklist. Deliberately a guide and not an automation: generating a
 * key and adding it to a hosting account are decisions (passphrase, which
 * account) that belong to the user, so SUNA reports exactly which step is
 * missing and hands over the command that fixes it.
 *
 * Since signing in to GitHub also authorizes pushing, this is now the second
 * route rather than the only one — which is why it starts collapsed.
 */
function SshGuide({
  host,
  status,
  onProbe,
  probing
}: {
  host: string | null
  status: SshStatus | null
  onProbe: () => void
  probing: boolean
}): JSX.Element {
  if (status === null) return <p className="view__hint">Checking SSH setup…</p>

  const hasKey = status.keys.length > 0
  const key = status.keys[0]
  const identityOk = status.identity.name !== null && status.identity.email !== null

  return (
    <div className="git__guide">
      <p className="view__hint">
        SSH proves this machine&apos;s identity with a key instead of a password. Four steps, once
        per machine — or skip it entirely by signing in to GitHub above.
      </p>

      <Step done={identityOk} title="1 · Tell git who you are">
        {identityOk ? (
          <p className="view__hint">
            {status.identity.name} &lt;{status.identity.email}&gt;
          </p>
        ) : (
          <>
            <p className="view__hint">Commits need a name and email attached to them.</p>
            <Command text='git config --global user.name "Your Name"' />
            <Command text='git config --global user.email "you@example.com"' />
          </>
        )}
      </Step>

      <Step done={hasKey} title="2 · Create an SSH key">
        {hasKey ? (
          <p className="view__hint">
            Found {status.keys.map((k) => k.file).join(', ')} in {status.sshDir}.
          </p>
        ) : (
          <>
            <p className="view__hint">
              No public key in {status.sshDir}. Run this in Terminal and accept the default file
              location; a passphrase is optional but recommended.
            </p>
            <Command text={KEYGEN} />
          </>
        )}
      </Step>

      {/* Advisory, never a failure: a key without a passphrase authenticates
          fine with an empty agent, so an empty agent is not proof of trouble. */}
      <Step
        done={status.agentKeys !== null && status.agentKeys > 0 ? true : null}
        title="3 · Load it into ssh-agent (if your key has a passphrase)"
      >
        {status.agentKeys === null ? (
          <p className="view__hint">
            ssh-agent could not be queried. If pushes fail, run this in Terminal.
          </p>
        ) : status.agentKeys > 0 ? (
          <p className="view__hint">
            ssh-agent holds {status.agentKeys} {status.agentKeys === 1 ? 'identity' : 'identities'}.
          </p>
        ) : (
          <p className="view__hint">
            The agent holds no identities. That is fine for a key without a passphrase; otherwise
            SUNA cannot unlock it during a push, so add it once:
          </p>
        )}
        <Command text={AGENT_ADD} />
      </Step>

      <Step done={status.authenticated} title={`4 · Authorize the key on ${status.host}`}>
        {key !== undefined && (
          <>
            <p className="view__hint">
              Copy your public key and paste it into the host&apos;s SSH keys page. This is the
              public half — it is safe to share; never copy the file without <code>.pub</code>.
            </p>
            <Command text={key.publicKey} />
          </>
        )}
        <p className="view__hint">
          <a href={hostKeyPage(host ?? status.host)} target="_blank" rel="noreferrer">
            Open {status.host} SSH key settings ↗
          </a>
        </p>
        <div className="git__guide-actions">
          <button className="btn" disabled={probing} onClick={onProbe}>
            {probing ? 'Testing…' : 'Test connection'}
          </button>
          {status.authenticated === true && (
            <span className="git__ok">Authenticated with {status.host}.</span>
          )}
        </div>
        {status.probeMessage !== null && status.authenticated !== true && (
          <pre className="git__probe">{status.probeMessage}</pre>
        )}
      </Step>
    </div>
  )
}

/**
 * Remote, GitHub account, and publishing for the current project.
 *
 * Kept beside the changes list rather than behind a dialog: "is my work backed
 * up anywhere but this laptop" is the question this panel exists to answer at
 * a glance.
 */
export function GitRemoteSection({
  rootDir,
  refreshKey,
  onChanged,
  setStatusNote
}: {
  rootDir: string
  refreshKey: number
  onChanged: () => void | Promise<void>
  setStatusNote: (note: string) => void
}): JSX.Element {
  const [remote, setRemote] = useState<RemoteInfo | null>(null)
  const [ssh, setSsh] = useState<SshStatus | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [owners, setOwners] = useState<Owners['owners']>([])
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [probing, setProbing] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [check, setCheck] = useState<RemoteCheck | null>(null)
  const [repoName, setRepoName] = useState(() => repoNameFromDir(rootDir))
  const [owner, setOwner] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('private')

  const loadSsh = useCallback(async (host: string | null, probe: boolean): Promise<void> => {
    try {
      const next = await window.suna.invoke('git:ssh-status', {
        ...(host !== null ? { host } : {}),
        probe
      })
      setSsh(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadSession = useCallback(async (): Promise<Session | null> => {
    const next = await window.suna.invoke('github:session', {}).catch(() => null)
    setSession(next)
    if (next !== null && next.signedIn) {
      const list = await window.suna.invoke('github:owners', {}).catch(() => null)
      setOwners(list?.owners ?? [])
    } else {
      setOwners([])
    }
    return next
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const info = await window.suna.invoke('git:remote', { dir: rootDir })
      setRemote(info)
      setEditing(info.url === null)
      await loadSsh(info.host, false)
      await loadSession()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir, loadSsh, loadSession])

  useEffect(() => {
    setRemote(null)
    setSsh(null)
    setSession(null)
    setCheck(null)
    setUrl('')
    setError(null)
    setNote(null)
    setRepoName(repoNameFromDir(rootDir))
    setOwner('')
    void refresh()
  }, [refresh, rootDir])

  // Re-read when the panel above says the repository moved (a push, a fetch).
  useEffect(() => {
    if (refreshKey === 0) return
    void refresh()
  }, [refreshKey, refresh])

  const signedIn = session?.signedIn === true && session.needsReauth !== true

  const saveRemote = async (value: string, allowHttps: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.suna.invoke('git:set-remote', {
        dir: rootDir,
        url: value,
        allowHttps
      })
      setNote(
        res.converted
          ? `Stored as SSH (${res.url}) — HTTPS needs either a GitHub sign-in or a password SUNA cannot prompt for.`
          : `Remote set to ${res.url}`
      )
      setUrl('')
      setEditing(false)
      await refresh()
      // The panel above owns Fetch/Pull/Push, and a remote is exactly what
      // decides whether those are reachable — without this they stay greyed
      // out until something else happens to refresh it. `git remote add`
      // writes .git/config, which the .git watcher deliberately ignores, so
      // nothing else would.
      await onChanged()
      await verify()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Ask whether the remote is really there, and — when GitHub says it is not —
   * pre-load the creation form with the very slug the remote already names, so
   * the fix is one button rather than a re-typed URL.
   */
  const verify = async (): Promise<RemoteCheck | null> => {
    try {
      const res = await window.suna.invoke('git:check-remote', { dir: rootDir })
      setCheck(res)
      if (res.missing) {
        const info = await window.suna.invoke('git:remote', { dir: rootDir })
        const [slugOwner, slugName] = (info.slug ?? '').split('/')
        if (slugName !== undefined && slugName !== '') {
          setOwner(slugOwner ?? '')
          setRepoName(slugName)
        }
        await loadSession()
      }
      return res
    } catch {
      return null
    }
  }

  const createRepo = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await window.suna.invoke('github:create-repo', {
        dir: rootDir,
        name: repoName.trim(),
        visibility,
        owner: owner.trim() === '' ? null : owner.trim(),
        // Signed in means HTTPS can authenticate from the keychain, which
        // spares a first-time collaborator the whole SSH-key detour.
        useHttps: signedIn && ssh?.keys.length === 0
      })
      setStatusNote(`Created ${res.slug} on GitHub`)
      setNote(`${res.slug} created and set as origin (${res.remoteUrl}). Publish when ready.`)
      setCheck(null)
      await refresh()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const probe = (): void => {
    setProbing(true)
    void loadSsh(remote?.host ?? null, true).finally(() => setProbing(false))
  }

  if (remote === null) {
    return (
      <div>
        <div className="view__section-title">Remote</div>
        {error !== null ? (
          <div className="view__error">{error}</div>
        ) : (
          <p className="view__hint">Reading remote…</p>
        )}
      </div>
    )
  }

  const isHttps = remote.protocol === 'https'
  // The remote names a repository the host says is not there — offer to make it.
  const missingRepo = remote.url !== null && check !== null && check.missing
  const showCreate = (remote.url === null || missingRepo) && signedIn

  return (
    <div className="git__remote-section">
      <div className="view__section-title">Remote &amp; GitHub</div>

      <GitHubAccount
        onChanged={async () => {
          await refresh()
          await onChanged()
        }}
        setStatusNote={setStatusNote}
      />

      {remote.url === null ? (
        <p className="view__hint">
          No remote yet. Add one to keep a copy of this project off this machine — create the
          repository on GitHub below, or paste the URL of one you already made.
        </p>
      ) : (
        <div className="git__remote-row">
          <span className={`chip git__proto git__proto--${remote.protocol ?? 'other'}`}>
            {remote.protocol === 'ssh' ? 'SSH' : remote.protocol === 'https' ? 'HTTPS' : 'local'}
          </span>
          <span className="git__remote-url" title={remote.url}>
            {remote.url}
          </span>
          <button className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Change'}
          </button>
        </div>
      )}

      {/* An HTTPS remote is only a problem when nothing can authenticate it. */}
      {isHttps && !signedIn && remote.sshUrl !== null && (
        <div className="git__warn">
          <p>
            This remote uses HTTPS, which needs a password on every push — and SUNA has no terminal
            to answer that prompt. Either sign in to GitHub above, or switch the remote to SSH:
          </p>
          <code>{remote.sshUrl}</code>
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void saveRemote(remote.sshUrl as string, false)}
          >
            Switch to SSH
          </button>
        </div>
      )}

      {isHttps && signedIn && (
        <p className="view__hint git__ok">
          Pushes to this HTTPS remote authenticate with your GitHub sign-in — no SSH key needed.
        </p>
      )}

      {missingRepo && (
        <div className="git__warn">
          <p>
            The remote is set, but GitHub has no <strong>{remote.slug ?? remote.url}</strong>. A
            remote is only a recorded URL — adding one does not create the repository.
          </p>
        </div>
      )}

      {showCreate && session?.account != null && (
        <div className="git__create">
          <div className="git__create-head">
            {missingRepo ? 'Create it now as ' : 'Create it on GitHub as '}
            <strong>{owner.trim() === '' ? session.account.login : owner.trim()}</strong>
          </div>
          <div className="git__create-row">
            <input
              className="view__input"
              aria-label="Repository name"
              placeholder="repository-name"
              spellCheck={false}
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
            />
            <select
              className="view__select git__create-vis"
              aria-label="Visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
              {owner.trim() !== '' && <option value="internal">Internal</option>}
            </select>
          </div>
          {owners.length > 1 && (
            <select
              className="view__select"
              aria-label="Owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">{session.account.login} (your account)</option>
              {owners
                .filter((entry) => entry.kind === 'org')
                .map((entry) => (
                  <option key={entry.login} value={entry.login}>
                    {entry.login} (organization)
                  </option>
                ))}
            </select>
          )}
          <div className="git__guide-actions">
            <button
              className="btn btn--primary"
              disabled={busy || repoName.trim() === ''}
              onClick={() => void createRepo()}
            >
              {busy ? 'Creating…' : 'Create on GitHub'}
            </button>
            <span className="view__hint">
              Creates an empty {visibility} repository and points origin at it. Nothing is uploaded
              until you push.
            </span>
          </div>
        </div>
      )}

      {(remote.url === null || missingRepo) && !signedIn && (
        <p className="view__hint">
          Sign in above to create the repository from here, or make it at{' '}
          <a href="https://github.com/new" target="_blank" rel="noreferrer">
            github.com/new ↗
          </a>{' '}
          and paste its URL below.
        </p>
      )}

      {editing && (
        <div className="git__remote-edit">
          <input
            className="view__input"
            placeholder="git@github.com:owner/repo.git"
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim() !== '') void saveRemote(url, signedIn)
            }}
          />
          <p className="view__hint">
            {signedIn
              ? 'Paste either form. An https:// URL is kept as-is — your GitHub sign-in authenticates it.'
              : 'Paste either form — an https:// URL is stored in its SSH form, because that is the only one that can authenticate without a prompt.'}
          </p>
          <div className="git__guide-actions">
            <button
              className="btn btn--primary"
              disabled={busy || url.trim() === ''}
              onClick={() => void saveRemote(url, signedIn)}
            >
              {remote.url === null ? 'Add remote' : 'Save remote'}
            </button>
            {!signedIn && (
              <button
                className="btn"
                disabled={busy || url.trim() === ''}
                onClick={() => void saveRemote(url, true)}
                title="Store the URL exactly as typed, even if it is HTTPS"
              >
                Keep HTTPS
              </button>
            )}
          </div>
        </div>
      )}

      {note !== null && <p className="view__hint">{note}</p>}
      {error !== null && <div className="view__error">{error}</div>}

      <button className="git__guide-toggle" onClick={() => setGuideOpen((v) => !v)}>
        {guideOpen ? '▾' : '▸'} SSH setup
        {signedIn
          ? ' · not needed while signed in'
          : ssh !== null && ssh.keys.length === 0
            ? ' · no key found on this machine'
            : ''}
      </button>
      {guideOpen && <SshGuide host={remote.host} status={ssh} onProbe={probe} probing={probing} />}
    </div>
  )
}
