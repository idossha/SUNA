import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'

type Session = ResponseOf<'github:session'>
type DeviceStart = ResponseOf<'github:device-start'>

/** Milliseconds; the poll interval GitHub returns is in seconds. */
const SECOND = 1000

function GitHubMark(): JSX.Element {
  return (
    <svg className="gh__mark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

/**
 * The code GitHub wants typed, shown big enough to read off the screen while
 * looking at a phone or a second window, and copyable in one click.
 */
function DeviceCode({ code }: { code: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="gh__code"
      title="Copy this code"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        })
      }}
    >
      <span className="gh__code-text">{code}</span>
      <span className="gh__code-copy">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

/**
 * Signing in to GitHub, and showing who is signed in.
 *
 * The flow is OAuth's device flow: GitHub hands out a short code, the user
 * types it on github.com, and SUNA polls until GitHub says yes. It is the
 * flow designed for apps that cannot hold a client secret, which every
 * desktop app is — a secret compiled into a binary anyone can download is not
 * a secret. Nothing is ever pasted by hand, and the resulting token goes to
 * the OS keychain, not to a file in the project.
 */
export function GitHubAccount({
  onChanged,
  setStatusNote
}: {
  onChanged: () => void | Promise<void>
  setStatusNote: (note: string) => void
}): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [device, setDevice] = useState<DeviceStart | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  // Cancels the poll loop when the component unmounts or the user backs out.
  const liveRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setSession(await window.suna.invoke('github:session', {}))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      liveRef.current = false
    }
  }, [load])

  /** Count the code's life down, so an expired code explains itself. */
  useEffect(() => {
    if (device === null || !waiting) return undefined
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => (value <= 1 ? 0 : value - 1))
    }, SECOND)
    return () => window.clearInterval(timer)
  }, [device, waiting])

  const stop = (): void => {
    liveRef.current = false
    setWaiting(false)
    setDevice(null)
  }

  /**
   * Poll on the interval GitHub asked for, one request at a time. The loop
   * lives here rather than in the main process so that closing this panel
   * genuinely ends it instead of leaving a timer hitting GitHub forever.
   */
  const runPolling = async (start: DeviceStart): Promise<void> => {
    let interval = start.interval
    liveRef.current = true
    while (liveRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, interval * SECOND))
      if (!liveRef.current) return
      let result: ResponseOf<'github:device-poll'>
      try {
        result = await window.suna.invoke('github:device-poll', {
          deviceCode: start.deviceCode,
          interval
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        stop()
        return
      }
      if (result.status === 'pending') {
        interval = result.interval
        continue
      }
      if (result.status === 'authorized') {
        stop()
        setNote(result.message)
        setStatusNote(
          result.account === null
            ? 'Signed in to GitHub'
            : `Signed in to GitHub as ${result.account.login}`
        )
        await load()
        await onChanged()
        return
      }
      // denied or expired: both end the flow with an explanation.
      setError(result.message ?? 'Sign-in did not complete.')
      stop()
      return
    }
  }

  const signIn = async (): Promise<void> => {
    setError(null)
    setNote(null)
    try {
      const start = await window.suna.invoke('github:device-start', {})
      setDevice(start)
      setSecondsLeft(start.expiresIn)
      setWaiting(true)
      // Open the page for them; the code still shows here either way.
      // `_blank` hits the main process's window-open handler, which routes it
      // to the system browser rather than opening a window inside the app.
      window.open(start.verificationUri, '_blank')
      void runPolling(start)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const signOut = async (): Promise<void> => {
    try {
      await window.suna.invoke('github:sign-out', {})
      setStatusNote('Signed out of GitHub')
      setNote(null)
      setError(null)
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (session === null) return <p className="view__hint">Checking GitHub…</p>

  if (!session.configured) {
    return (
      <div className="gh">
        <div className="gh__row">
          <GitHubMark />
          <span className="gh__title">GitHub</span>
        </div>
        <p className="view__hint">{session.message}</p>
      </div>
    )
  }

  if (session.signedIn && session.account !== null) {
    const account = session.account
    return (
      <div className="gh">
        <div className="gh__row">
          <GitHubMark />
          {account.avatarUrl !== null ? (
            <img className="gh__avatar" src={account.avatarUrl} alt="" width={22} height={22} />
          ) : (
            <span className="gh__avatar gh__avatar--blank" aria-hidden="true" />
          )}
          <span className="gh__who">
            <span className="gh__login">{account.login}</span>
            {account.name !== null && <span className="gh__name">{account.name}</span>}
          </span>
          <button className="btn gh__signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {session.needsReauth && <div className="git__warn"><p>{session.message}</p></div>}
        {note !== null && <p className="view__hint">{note}</p>}
        {error !== null && <div className="view__error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="gh">
      <div className="gh__row">
        <GitHubMark />
        <span className="gh__title">GitHub</span>
        {!waiting && (
          <button className="btn btn--primary gh__signin" onClick={() => void signIn()}>
            Sign in
          </button>
        )}
      </div>

      {session.message !== null && !waiting && <p className="view__hint">{session.message}</p>}

      {!waiting && device === null && (
        <p className="view__hint">
          Signing in lets SUNA create the repository for you and push without an SSH key. SUNA
          never sees your password — GitHub authorizes it directly, and the result is kept in this
          machine&apos;s keychain.
        </p>
      )}

      {device !== null && waiting && (
        <div className="gh__flow">
          <p className="view__hint">
            Enter this code on GitHub. The page should have opened already — if not, go to{' '}
            <a href={device.verificationUri} target="_blank" rel="noreferrer">
              {device.verificationUri.replace(/^https?:\/\//, '')} ↗
            </a>
            .
          </p>
          <DeviceCode code={device.userCode} />
          <div className="gh__waiting">
            <span className="gh__spinner" aria-hidden="true" />
            <span>
              Waiting for you to approve it
              {secondsLeft > 0 && ` · code expires in ${Math.ceil(secondsLeft / 60)} min`}
            </span>
            <button className="btn" onClick={stop}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {note !== null && <p className="view__hint">{note}</p>}
      {error !== null && <div className="view__error">{error}</div>}
    </div>
  )
}
