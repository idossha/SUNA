import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  NOTE_COLORS,
  ReferenceNotesFileSchema,
  isDetached,
  noteQuote,
  notePage,
  sortNotes,
  type NoteColor,
  type PdfNote,
  type ReferenceNotesFile
} from '@suna/core'
import { parseBibtex, type BibEntry } from '@suna/bib'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openViewerInSide } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useRefNotesStore } from '../state/refnotes'
import { citedPageLabel, quoteWithCitation } from './pdfSelection'
import '../comments/comments.css'
import './viewer.css'

/**
 * Every highlight in the project, across every paper (ADR-008).
 *
 * Reading notes are stored per paper because a highlight should be a small
 * write and `git diff` on a paper should show that paper's reading. The cost
 * of that is a silo, and the research phase is exactly where the silo hurts:
 * synthesis happens ACROSS papers, not inside one. This is the other half of
 * the trade — one surface for the whole literature, filterable by colour and
 * tag, exportable as a literature note.
 *
 * Deliberately read-only. Editing a note means seeing the passage it came
 * from, so a card links back to its page instead of pretending the quote is
 * the whole context.
 */

interface PaperGroup {
  citekey: string
  entry: BibEntry | undefined
  notes: PdfNote[]
  /**
   * The paper's own printed-page correction.
   *
   * Carried because a note cited three different pages depending on where you
   * asked: the popover applied the offset, this view and the MCP verb printed
   * the raw sheet number — and the one that gets pasted into a manuscript was
   * the wrong one.
   */
  pageLabelOffset: number
}

function paperLabel(citekey: string, entry: BibEntry | undefined): string {
  if (entry === undefined) return citekey
  const names = entry.authors
    .map((author) => (author.kind === 'person' ? author.family : author.literal).trim())
    .filter((name) => name !== '')
  const who = names.length === 0 ? '' : names.length <= 2 ? names.join(' & ') : `${names[0]} et al.`
  const year = entry.year === undefined ? '' : ` (${entry.year})`
  return who === '' ? citekey : `${who}${year}`
}

/** The whole selection as a literature note, ready to paste or keep. */
export function notesAsMarkdown(groups: readonly PaperGroup[]): string {
  const out: string[] = ['# Reading notes', '']
  for (const group of groups) {
    out.push(`## ${paperLabel(group.citekey, group.entry)} [@${group.citekey}]`)
    if (group.entry !== undefined && group.entry.title.trim() !== '') {
      out.push('', `*${group.entry.title.trim()}*`)
    }
    out.push('')
    for (const note of group.notes) {
      const page = citedPageLabel(notePage(note), null, group.pageLabelOffset)
      out.push(`- ${quoteWithCitation(noteQuote(note), group.citekey, page)}`)
      if (note.body.trim() !== '') {
        for (const line of note.body.trim().split('\n')) out.push(`  ${line}`)
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}

/**
 * Turn an IPC failure into something a person can act on.
 *
 * A channel the main process does not know about is almost always a stale
 * process rather than a bug: Electron's main does not hot-swap, so a window
 * reloaded after a pull still talks to the background process that started
 * before the feature existed. The raw message ("No handler registered for
 * 'refnotes:list-all'") names the symptom and hides the fix.
 */
export function describeIpcFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/No handler registered/i.test(message)) {
    return 'This needs a restart — SUNA\'s background process started before reading notes existed, and Electron does not reload it with the window. Quit SUNA and start it again.'
  }
  return `Could not read notes: ${message}`
}

export function ReadingNotesTab({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')
  const [papers, setPapers] = useState<{ citekey: string; file: ReferenceNotesFile }[] | null>(null)
  const [entries, setEntries] = useState<BibEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [colorFilter, setColorFilter] = useState<NoteColor | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [withBodyOnly, setWithBodyOnly] = useState(false)

  // A highlight made while this tab is open must show up here without being
  // asked for. `revision` catches every write this renderer makes; `saveBump`
  // catches the ones it does not, such as a reference being removed with its
  // notes.
  const revision = useRefNotesStore((s) => s.revision)
  const saveBump = useProjectStore((s) => s.saveBump)

  useEffect(() => {
    if (rootDir === '') return
    let cancelled = false
    void (async () => {
      try {
        const { papers: found } = await window.suna.invoke('refnotes:list-all', { dir: rootDir })
        if (cancelled) return
        setPapers(
          found.map((p) => ({ citekey: p.citekey, file: ReferenceNotesFileSchema.parse(p.file) }))
        )
      } catch (err) {
        if (!cancelled) setError(describeIpcFailure(err))
      }
      try {
        const { content } = await window.suna.invoke('fs:read-text', {
          path: `${rootDir}/manuscript/references.bib`
        })
        if (!cancelled) setEntries(parseBibtex(content).entries)
      } catch {
        // No bibliography yet — notes still list, without paper titles.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rootDir, revision, saveBump])

  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const paper of papers ?? []) for (const n of paper.file.notes) for (const t of n.tags) tags.add(t)
    return [...tags].sort()
  }, [papers])

  const groups: PaperGroup[] = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const out: PaperGroup[] = []
    for (const paper of papers ?? []) {
      const notes = sortNotes(paper.file.notes).filter((n) => {
        if (colorFilter !== null && n.color !== colorFilter) return false
        if (tagFilter !== null && !n.tags.includes(tagFilter)) return false
        if (withBodyOnly && n.body.trim() === '') return false
        if (needle === '') return true
        return (
          noteQuote(n).toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle)
        )
      })
      if (notes.length > 0) {
        out.push({
          citekey: paper.citekey,
          entry: byKey.get(paper.citekey),
          notes,
          pageLabelOffset: paper.file.source?.pageLabelOffset ?? 0
        })
      }
    }
    return out
  }, [papers, byKey, query, colorFilter, tagFilter, withBodyOnly])

  const total = groups.reduce((n, g) => n + g.notes.length, 0)

  const copyAll = (): void => {
    void navigator.clipboard.writeText(notesAsMarkdown(groups)).then(
      () => setNote(`Copied ${total} note${total === 1 ? '' : 's'} as Markdown.`),
      () => setNote('Could not write to the clipboard.')
    )
  }

  if (error !== null) {
    return (
      <div className="rnotes">
        <div className="pdfview__error">{error}</div>
      </div>
    )
  }

  return (
    <div className="rnotes">
      <div className="rnotes__bar">
        <input
          className="rnotes__search"
          placeholder="Search quotes and notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search reading notes"
        />
        <div className="rnotes__colors" role="group" aria-label="Filter by colour">
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              className="pdfnotes__swatch"
              data-color={color}
              aria-pressed={colorFilter === color}
              title={color}
              aria-label={`Filter: ${color}`}
              onClick={() => setColorFilter((current) => (current === color ? null : color))}
            />
          ))}
        </div>
        {allTags.length > 0 && (
          <select
            className="rnotes__tags"
            value={tagFilter ?? ''}
            aria-label="Filter by tag"
            onChange={(e) => setTagFilter(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        )}
        <label className="rnotes__toggle">
          <input
            type="checkbox"
            checked={withBodyOnly}
            onChange={(e) => setWithBodyOnly(e.target.checked)}
          />
          Written on
        </label>
        <span className="rnotes__count">
          {total} note{total === 1 ? '' : 's'} · {groups.length} paper{groups.length === 1 ? '' : 's'}
        </span>
        <button className="cmt__btn" onClick={copyAll} disabled={total === 0}>
          Copy as Markdown
        </button>
      </div>

      <div className="rnotes__body">
        {papers === null ? (
          <p className="pdfnotes__empty">Reading notes…</p>
        ) : total === 0 ? (
          <p className="pdfnotes__empty">
            {papers.length === 0
              ? 'No reading notes yet. Open a reference PDF and highlight a passage.'
              : 'No notes match these filters.'}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.citekey} className="rnotes__paper">
              <header className="rnotes__paperhead">
                <button
                  className="rnotes__papertitle"
                  title="Open this paper"
                  onClick={() => openViewerInSide(`${rootDir}/references/${group.citekey}.pdf`)}
                >
                  {paperLabel(group.citekey, group.entry)}
                </button>
                <code className="rnotes__key">[@{group.citekey}]</code>
                <span className="rnotes__papercount">{group.notes.length}</span>
              </header>
              {group.entry !== undefined && group.entry.title.trim() !== '' && (
                <p className="rnotes__papersub">{group.entry.title}</p>
              )}
              <div className="rnotes__list">
                {group.notes.map((n) => (
                  <article key={n.id} className="cmt-card rnotes__card">
                    <div className="cmt__card-head">
                      <span className="pdfnotes__dot" data-color={n.color} aria-hidden="true" />
                      <span className="cmt__time">
                        p. {citedPageLabel(notePage(n), null, group.pageLabelOffset)}
                      </span>
                      {n.tags.map((tag) => (
                        <span key={tag} className="rnotes__tag">
                          {tag}
                        </span>
                      ))}
                      {isDetached(n) && <span className="cmt__badge cmt__badge--resolved">detached</span>}
                    </div>
                    <div className="cmt__quote">{noteQuote(n)}</div>
                    {n.body.trim() !== '' && <div className="cmt__body">{n.body}</div>}
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {note !== null && (
        <div className="pdfview__note" role="status" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
    </div>
  )
}
