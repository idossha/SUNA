import { useEffect, useState, type JSX } from 'react'
import {
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  LitResultSchema,
  type LitProviderId,
  type LitResult
} from '@suna/core'
import { appendLitResultToBib } from '@suna/bib'
import { useProjectStore } from '../../state/project'
import { useUiStore } from '../../state/ui'
import { suggestionFor } from './provider-hint'
import { ResultCard } from './ResultCard'

/** A "Find similar" request from the Library tab: search by DOI first, title second. */
export interface FindSimilarSeed {
  nonce: number
  doi: string | null
  title: string
}

interface ProviderStatus {
  id: LitProviderId
  hasKey: boolean
  keyless: boolean
}

function cardId(result: LitResult): string {
  return `${result.source}:${result.id}`
}

function parseResults(raw: readonly unknown[]): LitResult[] {
  const out: LitResult[] = []
  for (const item of raw) {
    const parsed = LitResultSchema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export function SearchTab({ seed }: { seed: FindSimilarSeed | null }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const noteFileSaved = useProjectStore((s) => s.noteFileSaved)
  const setStatusNote = useUiStore((s) => s.setStatusNote)

  const [provider, setProvider] = useState<LitProviderId>('crossref')
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LitResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.suna
      .invoke('lit:providers', {})
      .then((res) => setProviderStatus(res.providers))
      .catch(() => {
        // Settings can't show live status either in this case; the picker
        // still works, it just won't show hasKey badges.
      })
  }, [])

  async function runSearch(p: LitProviderId, q: string): Promise<void> {
    if (q.trim() === '') return
    setLoading(true)
    setError(null)
    try {
      const res = await window.suna.invoke('lit:search', { provider: p, query: q, limit: 20 })
      setResults(parseResults(res.results))
      setError(res.error)
    } catch (err) {
      setResults([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // "Find similar" from the Library tab: DOI lookup first, title search as fallback.
  useEffect(() => {
    if (seed === null) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      setResults([])
      setQuery(seed.title)
      if (seed.doi !== null) {
        try {
          const res = await window.suna.invoke('lit:by-doi', { provider, doi: seed.doi })
          if (cancelled) return
          const parsed = res.result === null ? null : LitResultSchema.safeParse(res.result)
          if (parsed !== null && parsed.success) {
            setResults([parsed.data])
            setLoading(false)
            return
          }
          if (res.error !== null) setError(res.error)
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        }
      }
      if (!cancelled) await runSearch(provider, seed.title)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  async function handleAdd(result: LitResult): Promise<void> {
    if (rootDir === null) return
    const id = cardId(result)
    setAddingId(id)
    try {
      const path = `${rootDir}/manuscript/references.bib`
      let current = ''
      try {
        const { content } = await window.suna.invoke('fs:read-text', { path })
        current = content
      } catch {
        current = '' // no references.bib yet — the add creates it
      }
      const outcome = appendLitResultToBib(current, result)
      await window.suna.invoke('fs:write-text', { path, content: outcome.text })
      noteFileSaved(path)
      setAddedIds((prev) => new Set(prev).add(id))
      setStatusNote(`Added ${outcome.key} to references.bib`)
    } catch (err) {
      setStatusNote(
        `Could not add to references.bib — ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setAddingId(null)
    }
  }

  function handleCopyDoi(doi: string | null): void {
    if (doi === null) return
    void navigator.clipboard.writeText(doi)
    setStatusNote(`Copied DOI ${doi}`)
  }

  const currentStatus = providerStatus.find((p) => p.id === provider)

  return (
    <div className="lit-search">
      <div className="lit-search__providers" role="group" aria-label="Literature provider">
        {LIT_PROVIDER_IDS.map((id) => {
          const status = providerStatus.find((p) => p.id === id)
          return (
            <button
              key={id}
              className="refs__style"
              aria-pressed={provider === id}
              onClick={() => setProvider(id)}
            >
              {LIT_PROVIDER_META[id].label}
              {id === 'crossref' && <span className="lit-search__provider-hint"> · no key needed</span>}
              {id !== 'crossref' && status?.hasKey === true && (
                <span className="lit-search__provider-hint"> · key set</span>
              )}
            </button>
          )
        })}
      </div>
      <p className="view__hint">
        {LIT_PROVIDER_META[provider].note}
        {currentStatus?.keyless === false && currentStatus.hasKey === false && ' Add one in Settings.'}
      </p>

      <div className="lit-search__query">
        <input
          className="view__input"
          type="search"
          placeholder={`Search ${LIT_PROVIDER_META[provider].label}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch(provider, query)
          }}
        />
        <button className="lit-search__go" onClick={() => void runSearch(provider, query)} disabled={loading}>
          Search
        </button>
      </div>

      {loading && <p className="view__hint">Searching {LIT_PROVIDER_META[provider].label}…</p>}

      {error !== null && (
        <div className="view__error">
          <div>
            {LIT_PROVIDER_META[provider].label}: {error}
          </div>
          <div className="lit-search__suggestion">{suggestionFor(provider)}</div>
        </div>
      )}

      {!loading && error === null && results.length === 0 && query.trim() !== '' && (
        <p className="view__hint">No results.</p>
      )}

      {results.length > 0 && (
        <ul className="lit-search__results">
          {results.map((result) => {
            const id = cardId(result)
            return (
              <ResultCard
                key={id}
                result={result}
                added={addedIds.has(id)}
                adding={addingId === id}
                onAdd={() => void handleAdd(result)}
                onCopyDoi={() => handleCopyDoi(result.doi)}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
