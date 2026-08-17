import { useEffect, useMemo, useState, type JSX } from 'react'
import { assignNumbers, formatReference, parseBibtex, renderCluster, type BibEntry, type Run } from '@suna/bib'
import { PICKER_PROFILE_IDS, getBundledProfile, type BundledProfileId } from '@suna/formatter'
import { orderedReferences } from '../manuscript/citations'
import { openViewerInSide } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useReferencePdfs } from '../state/referencePdfs'
import { profileLabel, usePreviewProfileId, useRenderProfileStore } from '../state/renderProfile'
import { useSettingsStore } from '../state/settings'
import { useUiStore } from '../state/ui'
import { autoOpenPdfPath, citeStyleOf, entryMatches, firstAuthorOf, maxAuthorsFor, pdfBadgeTitle } from './refs'
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
  const [findSimilarSeed, setFindSimilarSeed] = useState<FindSimilarSeed | null>(null)
  const [attachingKey, setAttachingKey] = useState<string | null>(null)
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

  const copyKey = (key: string): void => {
    void navigator.clipboard.writeText(`[@${key}]`)
    setStatusNote(`Copied [@${key}]`)
  }

  /** Select a row and, when 'references.autoOpenPdf' is on and a PDF
   *  resolves, open it in the side group — replacing whatever was there
   *  (openViewerInSide), never stacking (feature-plan-4.md §4). */
  const selectEntry = (key: string): void => {
    setSelectedKey(key)
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

  const findSimilar = (entry: BibEntry): void => {
    setFindSimilarSeed({ nonce: Date.now(), doi: entry.doi ?? null, title: entry.title })
    setActiveTab('search')
  }

  return (
    <div className="view refs">
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
                        PDF
                      </span>
                    ) : (
                      <span
                        className="refs__attach-pdf"
                        role="button"
                        title="Attach a PDF for this reference (copied in, never moved)"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (attachingKey === null) void attachPdf(entry)
                        }}
                      >
                        {attachingKey === entry.key ? 'Attaching…' : 'Attach PDF…'}
                      </span>
                    )}
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
