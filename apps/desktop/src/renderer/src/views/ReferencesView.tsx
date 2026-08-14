import { useEffect, useMemo, useState, type JSX } from 'react'
import { assignNumbers, formatReference, parseBibtex, renderCluster, type BibEntry, type Run } from '@suna/bib'
import { getBundledProfile, BUNDLED_PROFILE_IDS, type BundledProfileId } from '@suna/formatter'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { citeStyleOf, entryMatches, firstAuthorOf, maxAuthorsFor } from './refs'
import './views.css'

const PROFILE_LABELS: Record<BundledProfileId, string> = {
  'nature-astronomy': 'Nat. Astron.',
  science: 'Science',
  'apj-aas': 'ApJ (AAS)',
  mnras: 'MNRAS'
}

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<BundledProfileId>('nature-astronomy')

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

  const filtered = useMemo(
    () => entries.filter((e) => entryMatches(e, filter)),
    [entries, filter]
  )
  const numbers = useMemo(() => assignNumbers(entries.map((e) => [e.key])), [entries])
  const entryMap = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries])

  const selected =
    (selectedKey !== null ? entries.find((e) => e.key === selectedKey) : undefined) ??
    filtered[0] ??
    entries[0]

  const profile = getBundledProfile(profileId)

  const copyKey = (key: string): void => {
    void navigator.clipboard.writeText(`[@${key}]`)
    setStatusNote(`Copied [@${key}]`)
  }

  if (entries.length === 0) {
    return (
      <div className="view refs">
        {loadError !== null ? (
          <div className="view__error">{loadError}</div>
        ) : (
          <p className="view__hint">references.bib has no entries yet.</p>
        )}
      </div>
    )
  }

  return (
    <div className="view refs">
      <input
        className="view__input"
        type="search"
        placeholder={`Filter ${entries.length} references…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {loadError !== null && <div className="view__error">{loadError}</div>}

      <div className="refs__list">
        {filtered.map((entry) => (
          <button
            key={entry.key}
            className="refs__row"
            aria-selected={selected !== undefined && selected.key === entry.key}
            onClick={() => setSelectedKey(entry.key)}
          >
            <span className="refs__row-main">
              <span className="refs__key">{entry.key}</span>
              <span className="refs__authoryear">
                {firstAuthorOf(entry)}
                {entry.year !== undefined ? ` · ${entry.year}` : ''}
              </span>
              <span className="refs__title">{entry.title}</span>
            </span>
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
        ))}
        {filtered.length === 0 && <p className="view__hint" style={{ padding: 8 }}>No matches.</p>}
      </div>

      {selected !== undefined && profile !== null && (
        <div>
          <div className="view__section-title">Rendered as</div>
          <div className="refs__styles">
            {BUNDLED_PROFILE_IDS.map((id) => (
              <button
                key={id}
                className="refs__style"
                aria-pressed={id === profileId}
                onClick={() => setProfileId(id)}
              >
                {PROFILE_LABELS[id]}
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
              {numbers.get(selected.key) !== undefined && (
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
    </div>
  )
}
