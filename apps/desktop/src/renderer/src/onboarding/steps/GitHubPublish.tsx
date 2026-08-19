import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import { GitHubAccount } from '../../views/GitHubAccount'
import { repoNameFromProjectName, type GitHubVisibility, type StepProps } from '../types'

type Session = ResponseOf<'github:session'>

/**
 * The version-control block on the review step.
 *
 * The local repository is never in question — the scaffold always makes one,
 * and a manuscript without version history is the thing SUNA exists to
 * prevent. What this offers is the second half: a copy off this machine,
 * decided at the moment the project is made rather than remembered later,
 * because "later" is after the first week of writing that would have been
 * lost.
 */
export function GitHubPublish({ state, update }: StepProps): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setSession(await window.suna.invoke('github:session', {}).catch(() => null))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Seed the repository name from the project name the moment it is useful,
  // and keep following it until the user types their own.
  const suggested = repoNameFromProjectName(state.name)
  useEffect(() => {
    if (state.githubRepoName === '') update({ githubRepoName: suggested })
    // Only ever fills a blank; a name the user edited is never overwritten.
  }, [suggested, state.githubRepoName, update])

  const signedIn = session?.signedIn === true && session.needsReauth !== true

  return (
    <div className="onboard__vcs">
      <div className="onboard__review-label">Version control</div>
      <p className="onboard__step-sub">
        A git repository is created here either way, with everything in it as the first commit.
      </p>

      {!signedIn ? (
        <>
          <p className="onboard__step-sub">
            Sign in to GitHub to also put a copy off this machine — you can do this later from
            Source Control or Settings instead.
          </p>
          <GitHubAccount onChanged={load} setStatusNote={() => undefined} />
        </>
      ) : (
        <>
          <label className="onboard__vcs-toggle">
            <input
              type="checkbox"
              checked={state.publishToGitHub}
              onChange={(event) => update({ publishToGitHub: event.target.checked })}
            />
            <span>
              Create a GitHub repository as <strong>{session?.account?.login}</strong> and push the
              first commit
            </span>
          </label>

          {state.publishToGitHub && (
            <div className="onboard__vcs-fields">
              <input
                className="view__input"
                aria-label="Repository name"
                placeholder="repository-name"
                spellCheck={false}
                value={state.githubRepoName}
                onChange={(event) => update({ githubRepoName: event.target.value })}
              />
              <select
                className="view__select"
                aria-label="Repository visibility"
                value={state.githubVisibility}
                onChange={(event) =>
                  update({ githubVisibility: event.target.value as GitHubVisibility })
                }
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </div>
          )}
        </>
      )}
    </div>
  )
}
