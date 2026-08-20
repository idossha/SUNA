import { useMemo, useState, type JSX } from 'react'
import type { LetterKind } from '@suna/core'
import { BUNDLED_PROFILE_IDS, getBundledProfile } from '@suna/formatter'
import { useProjectStore } from '../state/project'
import { refreshDocuments, useDocumentsStore } from '../state/documents'
import { openDocumentTab } from '../state/dock'
import './documents.css'

/**
 * The New Letter sheet (document-kinds-ux.md §A.2).
 *
 * Writes NOTHING until Create — the DocxImportTab contract, which is the
 * strongest UX convention in this codebase. Changing the journal re-renders
 * the requirements list off the profile and touches no file, so the moment a
 * user learns that Science asks for something Nature does not is *before*
 * they write, not at submission.
 */

const KINDS: { id: LetterKind; label: string; hint: string; disabled?: boolean }[] = [
  { id: 'submission', label: 'Submission cover letter', hint: 'The letter that goes with a first submission' },
  { id: 'revision', label: 'Cover letter for a revision', hint: 'Accompanies a resubmission after review' },
  {
    id: 'appeal',
    label: 'Appeal',
    hint: 'Not in this version — appeals have eligibility rules SUNA cannot check yet',
    disabled: true
  }
]

type StartFrom = 'skeleton' | 'seeded'

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^([0-9])/, 'l$1')

export function NewLetterSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const activeProfileId = useProjectStore((s) => s.manifest?.activeProfileId ?? null)

  const [letterKind, setLetterKind] = useState<LetterKind>('submission')
  const [profileId, setProfileId] = useState<string>(activeProfileId ?? 'nature')
  const [startFrom, setStartFrom] = useState<StartFrom>('seeded')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const profile = useMemo(() => getBundledProfile(profileId), [profileId])
  const letters = profile?.letters
  const documents = useDocumentsStore((s) => s.documents)

  // A second letter to the same journal is a normal thing to want — a
  // revision cover letter beside the submission one, or a fresh attempt after
  // a rejection. Finding a free id here means the collision shows up as the
  // filename under the buttons, rather than as an error after Create.
  const id = useMemo(() => {
    const base = slugify(`cover-${profile?.journalName ?? profileId}`)
    const taken = new Set(documents.map((d) => d.id))
    if (!taken.has(base)) return base
    for (let n = 2; n < 100; n += 1) {
      if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
    }
    return `${base}-${Date.now()}`
  }, [profile, profileId, documents])

  const create = async (): Promise<void> => {
    if (rootDir === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.suna.invoke('letter:new', {
        dir: rootDir,
        id,
        letterKind,
        targetProfileId: profileId,
        title: `Cover letter — ${profile?.journalName ?? profileId}`
      })
      // The skeleton mode differs from seeded only in whether the seeded
      // paragraphs survive; both write the same assertion set, because the
      // affidavit is not optional in either.
      if (startFrom === 'skeleton') {
        await window.suna.invoke('fs:write-text', {
          path: `${rootDir}/manuscript/${res.proseFile}`,
          content: skeletonOnly(res.requiredAssertions)
        })
      }
      refreshDocuments()
      openDocumentTab(rootDir, res.documentId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="sheet__scrim" onClick={onClose} role="presentation">
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New letter"
      >
        <header className="sheet__head">
          <h2>New letter</h2>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="sheet__body">
          <fieldset className="sheet__field">
            <legend>Kind</legend>
            {KINDS.map((k) => (
              <label key={k.id} className={`sheet__radio${k.disabled === true ? ' is-disabled' : ''}`}>
                <input
                  type="radio"
                  name="letter-kind"
                  checked={letterKind === k.id}
                  disabled={k.disabled === true}
                  onChange={() => setLetterKind(k.id)}
                />
                <span>
                  {k.label}
                  <em>{k.hint}</em>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="sheet__field">
            <label htmlFor="letter-journal">Journal</label>
            <select
              id="letter-journal"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {BUNDLED_PROFILE_IDS.map((pid) => {
                const p = getBundledProfile(pid)
                return (
                  <option key={pid} value={pid}>
                    {p?.journalName ?? pid}
                  </option>
                )
              })}
            </select>
            <RequirementsPreview profileId={profileId} letterKind={letterKind} />
          </div>

          <fieldset className="sheet__field">
            <legend>Start from</legend>
            <label className="sheet__radio">
              <input
                type="radio"
                name="start-from"
                checked={startFrom === 'seeded'}
                onChange={() => setStartFrom('seeded')}
              />
              <span>
                Seeded from the manuscript
                <em>
                  Title, article type, the venue’s name and your corresponding author, filled in.
                  Offline and instant. The paragraphs that argue the paper are left for you.
                </em>
              </span>
            </label>
            <label className="sheet__radio">
              <input
                type="radio"
                name="start-from"
                checked={startFrom === 'skeleton'}
                onChange={() => setStartFrom('skeleton')}
              />
              <span>
                Empty skeleton
                <em>Headings and the assertion list only.</em>
              </span>
            </label>
            <p className="sheet__note">
              An AI draft is written into the letter as a reviewable diff once you have one — use
              the Agent panel with the letter open. SUNA never fills in an assertion either way:
              those are your claims to an editor, so only you sign them.
            </p>
          </fieldset>

          {error !== null && <p className="sheet__error">{error}</p>}
        </div>

        <footer className="sheet__foot">
          <span className="sheet__path">
            manuscript/letters/{id}.md
            {letters === undefined && ' · no letter rules researched for this journal yet'}
          </span>
          <div className="sheet__actions">
            <button onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="is-primary" onClick={() => void create()} disabled={busy || rootDir === null}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/**
 * The venue's stated requirements, live. Three states, and they are NOT the
 * same: no researched rules at all, researched-and-silent, and an explicit
 * "we do not ask for one".
 */
function RequirementsPreview({
  profileId,
  letterKind
}: {
  profileId: string
  letterKind: LetterKind
}): JSX.Element {
  const profile = getBundledProfile(profileId)
  const letters = profile?.letters

  if (letters === undefined) {
    return (
      <div className="reqs reqs--unknown">
        Nobody has researched {profile?.journalName ?? profileId}’s cover-letter requirements yet.
        The letter will be created and checked for nothing — which is not the same as it being
        compliant.
      </div>
    )
  }

  const stance = letters.stance[letterKind]
  if (stance === 'not-requested') {
    return (
      <div className="reqs reqs--none">
        {profile?.journalName} does not request a cover letter for this kind of submission.
        {letters.sources[0] !== undefined && (
          <>
            {' '}
            <a href={letters.sources[0]} onClick={(e) => e.preventDefault()}>
              source
            </a>
          </>
        )}
      </div>
    )
  }

  const required = letters.assertions.filter((a) => a.stance === 'required')
  const optional = letters.assertions.filter((a) => a.stance !== 'required')
  const unquoted = letters.assertions.filter(
    (a) => a.quote === null && a.basis === 'documented-indexed'
  ).length

  return (
    <div className="reqs">
      <div className="reqs__head">
        Requirements for {profile?.journalName}
        {stance === undefined && <em> — this journal says nothing about this letter kind</em>}
      </div>
      <ul>
        {required.map((a) => (
          <li key={a.id}>
            <span className="reqs__dot reqs__dot--req" />
            {a.id}
            <span className="reqs__stance">required</span>
          </li>
        ))}
        {optional.map((a) => (
          <li key={a.id}>
            <span className="reqs__dot" />
            {a.id}
            <span className="reqs__stance">{a.stance}</span>
          </li>
        ))}
      </ul>
      {unquoted > 0 && (
        <p className="reqs__caveat">
          {unquoted} of these come from a search index — this venue’s own page refuses to be
          fetched, so SUNA cites the URL without quoting it.
        </p>
      )}
    </div>
  )
}

/** The skeleton without the seeded opening — assertions only. */
function skeletonOnly(requiredAssertions: readonly string[]): string {
  const lines = ['Dear Editor,', '']
  lines.push('<!-- Your letter. -->', '')
  for (const id of requiredAssertions) {
    lines.push(`⟦ unanswered — ${id} ⟧ ::assert{${id}}`, '')
  }
  lines.push('Sincerely,', '')
  return `${lines.join('\n')}\n`
}
