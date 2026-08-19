import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  assignNumbers,
  formatReference,
  parseBibtex,
  removeEntryFromBib,
  renderCluster,
  type BibEntry,
  type Run
} from '@suna/bib'
import { REFERENCE_NOTES_DIR, ReferenceNotesFileSchema } from '@suna/core'
import { PICKER_PROFILE_IDS, getBundledProfile, type BundledProfileId } from '@suna/formatter'
import { orderedReferences } from '../manuscript/citations'
import { openReadingNotesTab, openViewerInSide } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useReferencePdfs } from '../state/referencePdfs'
import { useRefNotesStore } from '../state/refnotes'
import { profileLabel, usePreviewProfileId, useRenderProfileStore } from '../state/renderProfile'
import { useSettingsStore } from '../state/settings'
import { useUiStore } from '../state/ui'
import {
  acquireNote,
  autoOpenPdfPath,
  citeStyleOf,
  entryMatches,
  FIND_PDF_BUSY_LABEL,
  FIND_PDF_HINT,
  FIND_PDF_LABEL,
  firstAuthorOf,
  litResultForEntry,
  maxAuthorsFor,
  PDF_BADGE_LABEL,
  pdfBadgeTitle,
  REMOVE_BUSY_LABEL,
  REMOVE_CONFIRM_LABEL,
  REMOVE_HINT,
  REMOVE_LABEL,
  removablePdfPath,
  removeNote
} from './refs'
import { useCitedKeys } from './useCitedKeys'
import { SearchTab, type FindSimilarSeed } from './lit/SearchTab'
import './views.css'

type RefsTab = 'library' | 'search'

type UsageFilter = 'all' | 'cited' | 'uncited'

function RunSpans({ runs }: { runs: readonly Run[] }): JSX.Element {
  return (
    <>
      {runs.map((run, i) => {
        const inner =
          run.link !== undefined && 'url' in run.link ? (
            <a href={run.link.url} onClick={(e) => e.preventDefault()} title={run.link.url}>
              {run.text}
            </a>
          ) : run.link !== undefined ? (
            <span className="refs__cite-link">{run.text}</span>
          ) : (
            run.text
          )
        if (run.style === 'italic') return <em key={i}>{inner}</em>
        if (run.style === 'bold') return <strong key={i}>{inner}</strong>
        return <span key={i}>{inner}</span>
      })}
    </>
  )
}

export function ReferencesView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const setStatusNote = useUiStore((s) => s.setStatusNote)

  const [entries, setEntries] = useState<BibEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [usage, setUsage] = useState<UsageFilter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<RefsTab>('library')

  /**
   * How many highlights exist across every paper, so the button says whether
   * there is anything behind it. Failures are swallowed on purpose: the count
   * is a nicety, and a background process older than the channel must not put
   * an error in the References panel over one.
   */
  const [noteCount, setNoteCount] = useState(0)
  const refNotesRevision = useRefNotesStore((s) => s.revision)
  useEffect(() => {
    if (rootDir === null) {
      setNoteCount(0)
      return
    }
    let cancelled = false
    void window.suna
      .invoke('refnotes:list-all', { dir: rootDir })
      .then(({ papers }) => {
        if (cancelled) return
        setNoteCount(
          papers.reduce(
            (total, paper) => total + ReferenceNotesFileSchema.parse(paper.file).notes.length,
            0
          )
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [rootDir, refNotesRevision, saveBump])
  const [findSimilarSeed, setFindSimilarSeed] = useState<FindSimilarSeed | null>(null)
  const [attachingKey, setAttachingKey] = useState<string | null>(null)
  const [findingKey, setFindingKey] = useState<string | null>(null)
  // Two-step removal: the first click arms the row (label flips to "Remove?"),
  // the second does it. A confirmation the row itself carries, rather than a
  // modal — deleting a PDF is not undoable, so it must not be one stray click.
  const [pendingRemoveKey, setPendingRemoveKey] = useState<string | null>(null)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const cited = useCitedKeys()
  // Reference PDFs (feature-plan-4 §3/§4): resolved once per project (and on
  // saveBump) independent of this view ever mounting — see state/referencePdfs.
  const referencePdfs = useReferencePdfs()
  const autoOpenPdf = useSettingsStore((s) => s.settings['references.autoOpenPdf'])
  // Shared with the combined manuscript tab (state/renderProfile) — this is
  // the one 'Rendered as' control, so switching it here also switches the
  // manuscript body's in-text citation style and reference-list order.
  const previewProfileId = usePreviewProfileId()

  useEffect(() => {
    if (rootDir === null) return
    let cancelled = false
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', {
          path: `${rootDir}/manuscript/references.bib`
        })
        const result = parseBibtex(content)
        if (cancelled) return
        setEntries(result.entries)
        setLoadError(
          result.errors.length > 0
            ? `${result.errors.length} entr${result.errors.length === 1 ? 'y' : 'ies'} could not be parsed.`
            : null
        )
      } catch {
        if (!cancelled) {
          setEntries([])
          setLoadError('No manuscript/references.bib in this project.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rootDir, saveBump])

  const citedCount = useMemo(
    () => entries.filter((e) => cited.set.has(e.key)).length,
    [entries, cited.set]
  )
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!entryMatches(e, filter)) return false
        if (usage === 'cited') return cited.set.has(e.key)
        if (usage === 'uncited') return !cited.set.has(e.key)
        return true
      }),
    [entries, filter, usage, cited.set]
  )
  /** Keys cited in prose with no matching bib entry — a real manuscript bug. */
  const missing = useMemo(
    () => cited.keys.filter((key) => !entries.some((e) => e.key === key)),
    [cited.keys, entries]
  )
  const numbers = useMemo(() => assignNumbers(entries.map((e) => [e.key])), [entries])
  const entryMap = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries])

  const profile = getBundledProfile(previewProfileId)

  // Display order follows the profile's reference-list sortOrder: appearance
  // (bib-file order here, since this view has no manuscript body to scan)
  // for numeric profiles, alphabetical-by-first-author for author-year ones.
  // orderedReferences also decides whether a row gets a number at all.
  const orderedRows = useMemo(
    () =>
      profile === null
        ? []
        : orderedReferences(numbers, entryMap, profile.citations.referenceList.sortOrder),
    [numbers, entryMap, profile]
  )
  const displayRows = useMemo(() => {
    const filteredKeys = new Set(filtered.map((e) => e.key))
    return orderedRows.filter((row) => filteredKeys.has(row.key))
  }, [orderedRows, filtered])
  const numbered = profile !== null && profile.citations.mode !== 'author-year'

  const selected =
    (selectedKey !== null ? entries.find((e) => e.key === selectedKey) : undefined) ??
    displayRows[0]?.entry ??
    entries[0]

  // Both PDF actions write the same references/<key>.pdf, so one gate covers
  // them: while either is running, neither can be started again.
  const busyKey = attachingKey ?? findingKey

  const copyKey = (key: string): void => {
    void navigator.clipboard.writeText(`[@${key}]`)
    setStatusNote(`Copied [@${key}]`)
  }

  /** Select a row and, when 'references.autoOpenPdf' is on and a PDF
   *  resolves, open it in the side group — replacing whatever was there
   *  (openViewerInSide), never stacking (feature-plan-4.md §4). */
  const selectEntry = (key: string): void => {
    setSelectedKey(key)
    setPendingRemoveKey(null)
    const path = autoOpenPdfPath(referencePdfs.map.get(key), autoOpenPdf)
    if (path !== null) openViewerInSide(path)
  }

  /** "Attach PDF…": picks a file anywhere on disk and COPIES it (never
   *  moves — the user's original stays put) to the conventional
   *  references/<citekey>.pdf path, then rescans so the badge appears. */
  const attachPdf = async (entry: BibEntry): Promise<void> => {
    if (rootDir === null) return
    setAttachingKey(entry.key)
    try {
      const { path } = await window.suna.invoke('dialog:pick-file', {
        title: `Attach a PDF for ${entry.key}`,
        extensions: ['pdf']
      })
      if (path === null) return
      await window.suna.invoke('fs:copy-file', {
        from: path,
        to: `${rootDir}/references/${entry.key}.pdf`
      })
      referencePdfs.rescan()
      setStatusNote(`Attached PDF for ${entry.key}`)
    } catch (error) {
      setStatusNote(
        `Could not attach PDF for ${entry.key}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setAttachingKey(null)
    }
  }

  /** "Find PDF": feature-plan-10's acquisition ladder, run in the main
   *  process in its strict preference order — the project's own
   *  references/<key>.pdf, then this machine's configured library roots, then
   *  an open-access/publisher download, then metadata-only. Reads may leave
   *  the project (that is the point); the write never does.
   *
   *  `policy: null` means "whatever ~/SunaConfig/library.json says": how far a
   *  download may reach is the Settings pane's choice, not this row's. And the
   *  outcome is always named — a `metadata-only` with weak matches says so
   *  rather than claiming nothing was found. */
  const findPdf = async (entry: BibEntry): Promise<void> => {
    if (rootDir === null) return
    const { result, error: why } = litResultForEntry(entry)
    if (result === null) {
      setStatusNote(`Cannot search for a PDF for ${entry.key}: ${why ?? 'the entry is too incomplete'}`)
      return
    }
    setFindingKey(entry.key)
    try {
      const outcome = await window.suna.invoke('library:acquire-pdf', {
        result,
        citekey: entry.key,
        projectRoot: rootDir,
        policy: null
      })
      // Only the three rungs that end with a file in references/ change what
      // the badge resolves to; metadata-only left the project untouched.
      if (outcome.acquisition !== null && outcome.acquisition !== 'metadata-only') {
        referencePdfs.rescan()
      }
      setStatusNote(acquireNote(entry.key, outcome))
    } catch (error) {
      setStatusNote(
        `Could not find a PDF for ${entry.key}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setFindingKey(null)
    }
  }

  /** "Remove": takes the entry out of references.bib and deletes its PDF when
   *  that PDF lives in the project's own references/ folder. Both steps are
   *  real deletions, hence the two-click arm above.
   *
   *  The bib file is re-read immediately before the edit and the returned text
   *  written straight back (removeEntryFromBib's contract) — never the copy in
   *  `entries`, which may be minutes old. Only the matched entry's text is
   *  cut, so entries the parser could not read survive untouched. */
  const removeEntry = async (entry: BibEntry): Promise<void> => {
    if (rootDir === null) return
    setRemovingKey(entry.key)
    setPendingRemoveKey(null)
    const bibPath = `${rootDir}/manuscript/references.bib`
    try {
      const { content } = await window.suna.invoke('fs:read-text', { path: bibPath })
      const outcome = removeEntryFromBib(content, entry.key)
      if (!outcome.removed) {
        setStatusNote(`${entry.key} is not in references.bib`)
        return
      }
      await window.suna.invoke('fs:write-text', { path: bibPath, content: outcome.text })

      const pdfPath = removablePdfPath(referencePdfs.map.get(entry.key), rootDir)
      let deletedPdf = false
      if (pdfPath !== null) {
        try {
          await window.suna.invoke('fs:delete', { path: pdfPath })
          deletedPdf = true
        } catch (error) {
          // The citation is already gone; say what didn't happen rather than
          // reporting the whole removal as a failure.
          setStatusNote(
            `Removed ${entry.key}, but its PDF could not be deleted: ${error instanceof Error ? error.message : String(error)}`
          )
          referencePdfs.rescan()
          return
        }
      }

      // The reading notes go with the paper. Left behind they are invisible:
      // nothing lists `references/notes/`, so an orphaned sidecar would sit
      // there until someone opened the folder, and would silently re-attach if
      // the same citekey were ever added again (ADR-008).
      try {
        await window.suna.invoke('fs:delete', {
          path: `${rootDir}/${REFERENCE_NOTES_DIR}/${entry.key}.json`
        })
      } catch {
        // No notes for this paper, which is the common case.
      }

      setEntries((current) => current.filter((e) => e.key !== entry.key))
      if (selectedKey === entry.key) setSelectedKey(null)
      referencePdfs.rescan()
      setStatusNote(removeNote(entry.key, deletedPdf))
    } catch (error) {
      setStatusNote(
        `Could not remove ${entry.key}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setRemovingKey(null)
    }
  }

  const findSimilar = (entry: BibEntry): void => {
    setFindSimilarSeed({ nonce: Date.now(), doi: entry.doi ?? null, title: entry.title })
    setActiveTab('search')
  }

  return (
    <div className="view refs">
      <div className="refs__tabrow">
        <div className="refs__tabs" role="tablist" aria-label="References">
          <button
            role="tab"
            className="refs__tab"
            aria-selected={activeTab === 'library'}
            onClick={() => setActiveTab('library')}
          >
            Library
          </button>
          <button
            role="tab"
            className="refs__tab"
            aria-selected={activeTab === 'search'}
            onClick={() => setActiveTab('search')}
          >
            Search
          </button>
        </div>
        {/* An action, not a third tab: it opens a document rather than
            switching this panel. Kept OUT of the tablist for that reason, and
            styled to the tab row's own metrics so it sits on the same
            baseline instead of floating above it. */}
        <button
          className="refs__notesbtn"
          title="Reading notes — every highlight across every paper"
          disabled={rootDir === null}
          onClick={() => {
            if (rootDir !== null) openReadingNotesTab(rootDir)
          }}
        >
          Notes
          {noteCount > 0 && <span className="refs__notescount">{noteCount}</span>}
        </button>
      </div>

      <div className={activeTab === 'library' ? 'refs__tabpanel' : 'refs__tabpanel refs__tabpanel--hidden'}>
        {entries.length === 0 ? (
          loadError !== null ? (
            <div className="view__error">{loadError}</div>
          ) : (
            <p className="view__hint">
              references.bib has no entries yet. Use the Search tab to find and add one.
            </p>
          )
        ) : (
          <>
            <input
              className="view__input"
              type="search"
              placeholder={`Filter ${entries.length} references…`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {loadError !== null && <div className="view__error">{loadError}</div>}

            <div className="refs__usage" role="group" aria-label="Filter by use in the manuscript">
              {(
                [
                  ['all', 'All', entries.length],
                  ['cited', 'Cited', citedCount],
                  ['uncited', 'Uncited', entries.length - citedCount]
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  className="refs__usage-btn"
                  aria-pressed={usage === id}
                  onClick={() => setUsage(id)}
                >
                  {label} <span className="refs__usage-count">{count}</span>
                </button>
              ))}
            </div>

            {missing.length > 0 && (
              <div className="refs__missing">
                {missing.length === 1 ? '1 citation has' : `${missing.length} citations have`} no bib
                entry: {missing.join(', ')}
              </div>
            )}

            <div className="refs__list">
              {displayRows.map((row) => {
                const entry = row.entry
                if (entry === undefined) return null
                const resolution = referencePdfs.map.get(entry.key)
                return (
                  <button
                    key={row.key}
                    className="refs__row"
                    aria-selected={selected !== undefined && selected.key === row.key}
                    onClick={() => selectEntry(row.key)}
                  >
                    {numbered && <span className="refs__num">{row.number}.</span>}
                    <span className="refs__row-main">
                      <span className="refs__row-line">
                        <span className="refs__key">
                          {entry.key}
                          {!cited.set.has(entry.key) && (
                            <span className="refs__uncited-dot" title="Not cited in the manuscript" />
                          )}
                        </span>
                        <span className="refs__authoryear">
                          {firstAuthorOf(entry)}
                          {entry.year !== undefined ? ` · ${entry.year}` : ''}
                        </span>
                      </span>
                      <span className="refs__title">{entry.title}</span>
                    </span>
                    {resolution ? (
                      <span className="refs__pdf-badge" title={pdfBadgeTitle(resolution.how)}>
                        {PDF_BADGE_LABEL}
                      </span>
                    ) : (
                      // Stacked, not side by side: the sidebar row is ~230px
                      // wide and both pills are nowrap/flex-shrink:0, so in a
                      // line they collapse .refs__row-main to nothing and the
                      // cite key overlaps them. A column is as wide as the
                      // wider pill, so it costs one row of height and leaves
                      // .refs__row-main exactly the width it had when "Attach
                      // PDF…" stood there alone.
                      <span
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          flexShrink: 0,
                          gap: 3
                        }}
                      >
                        <span
                          className="refs__attach-pdf"
                          role="button"
                          title={FIND_PDF_HINT}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (busyKey === null) void findPdf(entry)
                          }}
                        >
                          {findingKey === entry.key ? FIND_PDF_BUSY_LABEL : FIND_PDF_LABEL}
                        </span>
                        <span
                          className="refs__attach-pdf"
                          role="button"
                          title="Attach a PDF for this reference (copied in, never moved)"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (busyKey === null) void attachPdf(entry)
                          }}
                        >
                          {attachingKey === entry.key ? 'Attaching…' : 'Attach PDF…'}
                        </span>
                      </span>
                    )}
                    {/* Stacked, right-hand column: [@] on top with Remove
                        directly under it, so the two row actions cost one
                        column of width instead of two (the PDF pills to their
                        left already own a column). */}
                    <span className="refs__row-actions">
                      <span
                        className="refs__copy"
                        role="button"
                        title={`Copy [@${entry.key}]`}
                        onClick={(e) => {
                          e.stopPropagation()
                          copyKey(entry.key)
                        }}
                      >
                        [@]
                      </span>
                      <span
                        className="refs__remove"
                        role="button"
                        title={
                          cited.set.has(entry.key)
                            ? `${REMOVE_HINT} — warning: this reference IS cited in the manuscript`
                            : REMOVE_HINT
                        }
                        aria-pressed={pendingRemoveKey === entry.key}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (removingKey !== null) return
                          if (pendingRemoveKey === entry.key) void removeEntry(entry)
                          else setPendingRemoveKey(entry.key)
                        }}
                      >
                        {removingKey === entry.key
                          ? REMOVE_BUSY_LABEL
                          : pendingRemoveKey === entry.key
                            ? REMOVE_CONFIRM_LABEL
                            : REMOVE_LABEL}
                      </span>
                    </span>
                  </button>
                )
              })}
              {displayRows.length === 0 && (
                <p className="view__hint" style={{ padding: 8 }}>
                  No matches.
                </p>
              )}
            </div>

            {selected !== undefined && profile !== null && (
              <div>
                <div className="refs__preview-header">
                  <div className="view__section-title">Rendered as</div>
                  <button className="refs__find-similar" onClick={() => findSimilar(selected)}>
                    Find similar
                  </button>
                </div>
                <div className="refs__styles">
                  {/* hidden profiles stay selectable when they ARE the current choice */}
                  {(PICKER_PROFILE_IDS.includes(previewProfileId)
                    ? PICKER_PROFILE_IDS
                    : [...PICKER_PROFILE_IDS, previewProfileId]
                  ).map((id) => (
                    <button
                      key={id}
                      className="refs__style"
                      aria-pressed={id === previewProfileId}
                      onClick={() => {
                        if (rootDir !== null) useRenderProfileStore.getState().setPreviewProfile(rootDir, id)
                      }}
                    >
                      {profileLabel(id)}
                    </button>
                  ))}
                </div>

                <div className="refs__preview" style={{ marginTop: 8 }}>
                  <div className="refs__preview-label">In text — {profile.citations.mode}</div>
                  <div className="refs__rendered">
                    {(() => {
                      const rendering = renderCluster(
                        { keys: [selected.key], narrative: false },
                        numbers,
                        citeStyleOf(profile.citations),
                        entryMap
                      )
                      return rendering.form === 'superscript' ? (
                        <>
                          …as shown in earlier work
                          <sup>
                            <RunSpans runs={rendering.inline} />
                          </sup>
                          .
                        </>
                      ) : (
                        <>
                          …as shown in earlier work <RunSpans runs={rendering.inline} />.
                        </>
                      )
                    })()}
                  </div>

                  <div className="refs__preview-label">Reference list</div>
                  <div className="refs__rendered">
                    {numbered && numbers.get(selected.key) !== undefined && (
                      <span className="refs__cite-link">{numbers.get(selected.key)}. </span>
                    )}
                    <RunSpans
                      runs={formatReference(selected, {
                        maxAuthors: maxAuthorsFor(
                          profile.citations.referenceList.authorTruncation,
                          selected.authors.length
                        )
                      })}
                    />
                  </div>
                </div>
                <p className="view__hint" style={{ marginTop: 6 }}>
                  {profile.journalName} · et al.{' '}
                  {profile.citations.referenceList.authorTruncation.truncateWhenMoreThan !== null
                    ? `after ${profile.citations.referenceList.authorTruncation.truncateWhenMoreThan} authors`
                    : 'not applied'}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className={activeTab === 'search' ? 'refs__tabpanel' : 'refs__tabpanel refs__tabpanel--hidden'}>
        <SearchTab seed={findSimilarSeed} />
      </div>
    </div>
  )
}
