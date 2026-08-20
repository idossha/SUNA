import { useEffect, useMemo, useState, type JSX } from 'react'
import type { LetterKind } from '@suna/core'
import { BUNDLED_PROFILE_IDS, getBundledProfile } from '@suna/formatter'
import { useProjectStore } from '../state/project'
import { refreshDocuments, useDocumentsStore } from '../state/documents'
import { openDocumentTab } from '../state/dock'
import { cliGate, runLetterDraft } from '../ai/directedActions'
import { AI_EFFORT_LABELS, AI_MODEL_LABELS } from '../settings/aiChoice'
import { AI_EFFORTS, AI_MODELS, type AiEffort, type AiModel } from '@suna/core'
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

type StartFrom = 'basic' | 'ai'

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
  const [startFrom, setStartFrom] = useState<StartFrom>('basic')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null)
  // Per-run, not persisted: "this one letter is worth Opus" is a decision
  // about the task, not about the project. null means "use the project's
  // setting", which is what the Settings tab is for.
  const [model, setModel] = useState<AiModel | null>(null)
  const [effort, setEffort] = useState<AiEffort | null>(null)

  useEffect(() => {
    let cancelled = false
    void cliGate().then((gate) => {
      if (!cancelled) setAiAvailable(gate.ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const profile = useMemo(() => getBundledProfile(profileId), [profileId])
  const letters = profile?.letters
  const documents = useDocumentsStore((s) => s.documents)

  // The name the user typed, or a sensible default from the venue. It drives
  // BOTH the row in the sidebar and the filename, so two letters to the same
  // journal are told apart by something the author chose rather than by a
  // numeric suffix nobody can read.
  const defaultName = `Cover letter — ${profile?.journalName ?? profileId}`
  const effectiveName = name.trim() === '' ? defaultName : name.trim()

  const id = useMemo(() => {
    const base = slugify(effectiveName) === '' ? 'cover-letter' : slugify(effectiveName)
    const taken = new Set(documents.map((d) => d.id))
    if (!taken.has(base)) return base
    for (let n = 2; n < 100; n += 1) {
      if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
    }
    return `${base}-${Date.now()}`
  }, [effectiveName, documents])

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
        title: effectiveName
      })
      refreshDocuments()
      openDocumentTab(rootDir, res.documentId)
      onClose()

      // The AI route runs AFTER the letter exists and is on screen, so the
      // draft arrives into a document the author is already looking at rather
      // than behind a spinner in a modal. Progress and Cancel live in the
      // Agent panel, the same as every other directed action.
      if (startFrom === 'ai') {
        void runLetterDraft({
          rootDir,
          documentId: res.documentId,
          letterPath: `${rootDir}/manuscript/${res.proseFile}`,
          letterFile: res.proseFile,
          journalName: profile?.journalName ?? profileId,
          letterKind,
          requiredAssertions: res.requiredAssertions,
          // The venue's own stated requirements travel INTO the prompt, so the
          // agent argues against what this journal actually asks for rather
          // than a generic idea of a cover letter.
          venueRequirements: (letters?.assertions ?? []).map((a) =>
            `${a.id} (${a.stance})${a.quote === null ? '' : ` — "${a.quote}"`}`
          ),
          placeholder: '<!-- Why this work matters',
          ...(model === null ? {} : { model }),
          ...(effort === null ? {} : { effort })
        })
      }
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
          <div className="sheet__field">
            <label htmlFor="letter-name">Name</label>
            <input
              id="letter-name"
              type="text"
              value={name}
              placeholder={defaultName}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

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
                checked={startFrom === 'basic'}
                onChange={() => setStartFrom('basic')}
              />
              <span>
                Basic
                <em>
                  Title, article type, the venue’s name and your corresponding author, filled in
                  from the project. Offline and instant. The paragraphs that argue the paper are
                  left for you.
                </em>
              </span>
            </label>
            <label
              className={`sheet__radio${aiAvailable === false ? ' is-disabled' : ''}`}
              title={aiAvailable === false ? 'No agent CLI was found on this machine' : undefined}
            >
              <input
                type="radio"
                name="start-from"
                checked={startFrom === 'ai'}
                disabled={aiAvailable === false}
                onChange={() => setStartFrom('ai')}
              />
              <span>
                AI draft
                <em>
                  Everything Basic does, then the agent reads the manuscript, its metadata and
                  your project context and writes the argument — professionally, and grounded in
                  what the paper actually says.
                  {aiAvailable === false && ' Unavailable: no agent CLI found.'}
                </em>
              </span>
            </label>
            {startFrom === 'ai' && (
              <div className="sheet__ai-opts">
                <label>
                  Model
                  <select
                    value={model ?? ''}
                    onChange={(e) => setModel(e.target.value === '' ? null : (e.target.value as AiModel))}
                  >
                    <option value="">Project default</option>
                    {AI_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {AI_MODEL_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Effort
                  <select
                    value={effort ?? ''}
                    onChange={(e) => setEffort(e.target.value === '' ? null : (e.target.value as AiEffort))}
                  >
                    <option value="">Project default</option>
                    {AI_EFFORTS.map((x) => (
                      <option key={x} value={x}>
                        {AI_EFFORT_LABELS[x]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="sheet__ai-hint">
                  For this run only. A letter is short and read by one editor, so a
                  slower model is usually worth it here even when the project runs on a
                  faster one.
                </p>
              </div>
            )}

            <p className="sheet__note">
              Either way SUNA never fills in an assertion. Those are your factual claims to an
              editor, made over your signature, so only you answer them — the agent is told to
              leave every ⟦ unanswered ⟧ marker exactly where it is.
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
