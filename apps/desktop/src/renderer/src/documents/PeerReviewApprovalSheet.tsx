import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  PEER_REVIEW_FILE,
  PEER_REVIEW_SECTIONS,
  peerReviewIsUnfilled,
  peerReviewSuggestion,
  type PeerReviewSource
} from '@suna/core'
import { parseSciMark, renderHtml } from '@suna/markdown'
import { PEER_REVIEW_LEARN_KEY, cliGate, runPeerReviewLearn } from '../ai/directedActions'
import { readLocalAuthorName } from '../state/comments'
import { useAiActionsStore } from '../state/aiActions'
import { useProjectStore } from '../state/project'
import { Sheet } from './Sheet'
import './documents.css'

/**
 * The gate on AI-drafted replies to referees.
 *
 * A response letter goes to an editor over the authors' names, and several
 * publishers now require authors to disclose how AI was used in preparing
 * one. So this is not onboarding and not a preference pane: until a person
 * has read the instructions the AI will follow and said in as many words
 * that they accept them, SUNA drafts nothing. The record of that goes in
 * `suna.json` — timestamp, who, which route, and the hash of the exact text
 * approved.
 *
 * Three routes to a document, because authors arrive in three states.
 * **Standard** for the author who has no house style and wants the
 * conventions everyone already follows. **Learn from a letter** for the one
 * who has been publishing for twenty years and whose real conventions are
 * sitting in a .docx on their disk — far better evidence than anything they
 * would write from memory. **Write my own** for the one who knows exactly
 * what they want.
 *
 * The agreement cannot be ticked until the document has been scrolled to the
 * end. That is the difference between an approval and a click-through, and
 * it is the entire point of the screen.
 */

/**
 * Where the document on screen came from. Deliberately NOT the same list as
 * `PeerReviewSource`, which is what gets recorded: there is no "write your
 * own" route, because a blank page is a bad place to start and the Edit
 * button already lets you rewrite every word of either route. `existing` is
 * not offered either — it is what you get when the file already says
 * something, and choosing a route replaces it.
 */
type Route = 'existing' | 'suggested' | 'imported'

const ROUTES: { id: Exclude<Route, 'existing'>; label: string; hint: string }[] = [
  {
    id: 'suggested',
    label: 'Standard guidelines',
    hint: 'The conventions most published response letters already follow — reply shape, when to quote the revised text, how to disagree. Ready to read now.'
  },
  {
    id: 'imported',
    label: 'Learn from a letter you have sent',
    hint: 'Point at a past response-to-reviewers document. The AI reads it and writes down the conventions it can actually see you following — your voice, not a generic one.'
  }
]

export function PeerReviewApprovalSheet({
  rootDir,
  onClose,
  onApproved
}: {
  rootDir: string
  onClose: () => void
  /** The approved text, so the caller can use it without re-reading the file. */
  onApproved: (text: string) => void
}): JSX.Element {
  const [route, setRoute] = useState<Route>('suggested')
  const [suggested, setSuggested] = useState(() => peerReviewSuggestion())
  const [learned, setLearned] = useState<string | null>(null)
  const [learnedFrom, setLearnedFrom] = useState<string | null>(null)
  const [existing, setExisting] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  // Somebody may have written this file by hand — in an editor, or through
  // an agent — long before they ever met this screen. Approving is then a
  // matter of reading back what they already wrote, so their own text is
  // what the screen opens on. Only real content counts: the seeded
  // placeholder is not something anyone wrote.
  useEffect(() => {
    let live = true
    window.suna
      .invoke('fs:read-text', { path: `${rootDir}/context/${PEER_REVIEW_FILE}` })
      .then(({ content }) => {
        if (!live || peerReviewIsUnfilled(content)) return
        setExisting(content)
        setRoute('existing')
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [rootDir])

  const [agreed, setAgreed] = useState(false)
  const [readToEnd, setReadToEnd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState<{ ok: boolean; reason?: string } | null>(null)

  const learnRun = useAiActionsStore((s) => s.runs[PEER_REVIEW_LEARN_KEY])
  const docRef = useRef<HTMLDivElement | null>(null)

  const text =
    route === 'existing' ? (existing ?? '') : route === 'suggested' ? suggested : (learned ?? '')
  const ready = text.trim() !== ''

  /**
   * What goes on the record. A route describes where the words started; the
   * record has to describe what was actually approved. Text the author has
   * edited — or wrote themselves before ever opening this — is theirs,
   * whatever produced the first draft of it, so it is recorded as 'manual'.
   */
  const source: PeerReviewSource =
    route === 'existing'
      ? 'manual'
      : route === 'suggested'
        ? (text === peerReviewSuggestion() ? 'suggested' : 'manual')
        : (learned !== null && text === learned ? 'imported' : 'manual')

  // Any change to what is on screen invalidates having read it. Switching
  // route, importing a letter, editing a line — each means the agreement now
  // covers different words, so it is withdrawn and must be given again.
  useEffect(() => {
    setAgreed(false)
    setReadToEnd(false)
  }, [text])

  useEffect(() => {
    if (route !== 'imported' || gate !== null) return
    void cliGate().then(setGate)
  }, [route, gate])

  // "Read to the end" is satisfied the moment the whole document fits without
  // scrolling — a four-line document nobody can scroll must not be
  // unapprovable. Re-measured on every text change for the same reason.
  const measure = (): void => {
    const el = docRef.current
    if (el === null) return
    if (el.scrollHeight - el.clientHeight <= 4) setReadToEnd(true)
    else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadToEnd(true)
  }
  useEffect(measure, [text, editing])

  const html = useMemo(() => {
    if (!ready) return ''
    try {
      return renderHtml(parseSciMark(text))
    } catch {
      // A document that will not parse is still a document the user may
      // approve; show it as plain text rather than blocking on our renderer.
      return ''
    }
  }, [text, ready])

  const pickLetter = async (): Promise<void> => {
    setError(null)
    try {
      const { path } = await window.suna.invoke('dialog:pick-file', {
        title: 'Choose a response-to-reviewers document',
        extensions: ['docx', 'md', 'txt']
      })
      if (path === null) return
      // The same extraction the reviewer importer uses — one docx-to-text
      // path in the app, already tested against real reviewer documents.
      const { sourceText } = await window.suna.invoke('review:analyse', { text: null, path })
      if (sourceText.trim() === '') {
        setError('That document has no readable text in it.')
        return
      }
      setLearnedFrom(path)
      setLearned(null)
      const outcome = await runPeerReviewLearn({
        rootDir,
        sourcePath: path,
        sourceText,
        sectionTitles: PEER_REVIEW_SECTIONS.map((s) => s.title)
      })
      if (outcome.text === null) setError(outcome.error ?? 'The AI could not read that document.')
      else setLearned(outcome.text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const approve = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // Write first, then approve: the record's hash is taken from the file
      // on disk, so the file has to be the approved text before it is asked.
      await window.suna.invoke('fs:write-text', {
        path: `${rootDir}/context/${PEER_REVIEW_FILE}`,
        content: text
      })
      const { manifest } = await window.suna.invoke('peer-review:approve', {
        dir: rootDir,
        approvedBy: readLocalAuthorName(),
        source,
        learnedFrom: source === 'imported' ? learnedFrom : null
      })
      useProjectStore.setState({ manifest })
      onApproved(text)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Sheet label="Approve the guidelines for AI replies" onClose={onClose}>
      <header className="sheet__head">
        <h2>Before SUNA drafts a reply to a referee</h2>
        <button className="sheet__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="sheet__body prapp__body">
        <p className="prapp__lead">
          Replies to referees go to an editor over your name, and several publishers now ask
          authors to disclose how AI helped write them. So SUNA drafts nothing until you have
          read the instructions it will follow and accepted them. Once, for this project.
        </p>

        <fieldset className="sheet__field">
          <legend>
            {route === 'existing' ? 'Or replace them with' : 'Where the guidelines come from'}
          </legend>
          {route === 'existing' && (
            <p className="prapp__existing">
              This project already has guidelines. Read them below and approve them as they
              stand, or start again from one of these:
            </p>
          )}
          {ROUTES.map((r) => (
            <label
              key={r.id}
              className={`sheet__radio${r.id === 'imported' && gate !== null && !gate.ok ? ' is-disabled' : ''}`}
              title={r.id === 'imported' && gate !== null && !gate.ok ? gate.reason : undefined}
            >
              <input
                type="radio"
                name="pr-route"
                checked={route === r.id}
                disabled={busy || (r.id === 'imported' && gate !== null && !gate.ok)}
                onChange={() => {
                  setRoute(r.id)
                  setEditing(false)
                }}
              />
              <span>
                {r.label}
                <em>{r.hint}</em>
              </span>
            </label>
          ))}
        </fieldset>

        {route === 'imported' && (
          <div className="prapp__import">
            <button onClick={() => void pickLetter()} disabled={learnRun !== undefined || busy}>
              {learnedFrom === null ? 'Choose a document…' : 'Choose a different document…'}
            </button>
            {learnedFrom !== null && (
              <span className="prapp__import-file" title={learnedFrom}>
                {learnedFrom.split('/').pop()}
              </span>
            )}
            {learnRun !== undefined && (
              <span className="prapp__import-busy" role="status" aria-live="polite">
                <span className="reply-ai__pulse" aria-hidden="true" />
                Reading the letter… <em>{learnRun.note}</em>
                <button className="reply-ai__cancel" onClick={() => learnRun.cancel()}>
                  Cancel
                </button>
              </span>
            )}
          </div>
        )}

        <div className="prapp__doc-head">
          <span>
            {!ready
              ? 'Nothing to read yet'
              : route === 'existing'
                ? `Your existing context/${PEER_REVIEW_FILE}`
                : 'What the AI will be told'}
          </span>
          {ready && (
            <button
              className="prapp__edit-toggle"
              onClick={() => setEditing((v) => !v)}
              disabled={busy}
            >
              {editing ? 'Done editing' : 'Edit'}
            </button>
          )}
        </div>

        {editing ? (
          <textarea
            className="prapp__editor"
            value={text}
            spellCheck={false}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value
              if (route === 'suggested') setSuggested(next)
              else if (route === 'imported') setLearned(next)
              else setExisting(next)
            }}
          />
        ) : (
          <div className="prapp__doc" ref={docRef} onScroll={measure} tabIndex={0}>
            {!ready ? (
              <p className="prapp__doc-empty">
                Choose a response letter above and the AI will read your conventions off it.
              </p>
            ) : html === '' ? (
              <pre>{text}</pre>
            ) : (
              <div className="prapp__rendered" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        )}

        {error !== null && <p className="sheet__error">{error}</p>}
      </div>

      <footer className="sheet__foot prapp__foot">
        <label
          className={`prapp__agree${!ready || !readToEnd ? ' is-locked' : ''}`}
          title={
            !ready
              ? 'There are no guidelines to approve yet'
              : !readToEnd
                ? 'Scroll to the end of the document first'
                : undefined
          }
        >
          <input
            type="checkbox"
            checked={agreed}
            disabled={!ready || !readToEnd || busy}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I have read these guidelines and accept them as the instructions SUNA follows when
            it drafts replies on my behalf.
            {ready && !readToEnd && <em>Scroll to the end to continue.</em>}
          </span>
        </label>
        <div className="sheet__actions">
          <button onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button className="is-primary" onClick={() => void approve()} disabled={!agreed || busy}>
            {busy ? 'Saving…' : 'Approve'}
          </button>
        </div>
      </footer>
    </Sheet>
  )
}
