import { useEffect, useRef, useState, type JSX } from 'react'
import {
  AI_CLI_LABEL,
  LIT_PROVIDER_META,
  UI_LIT_PROVIDER_IDS,
  LitResultSchema,
  type LitCliId,
  type LitProviderId,
  type LitResult,
  type UiLitProviderId
} from '@suna/core'
import { appendLitResultToBib } from '@suna/bib'
import { useProjectStore } from '../../state/project'
import { useSettingsStore } from '../../state/settings'
import { useUiStore } from '../../state/ui'
import { hintFor, suggestionFor } from './provider-hint'
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

/**
 * How many papers an ai-cli search asks the agent for.
 *
 * Deliberately much smaller than the 20 the HTTP providers request. An agent
 * CLI *works* for each result — a web search, then reading sources to verify
 * the DOI — so the request size sets the runtime almost linearly, and the
 * adapter has a hard 180 s budget (AI_CLI_SEARCH_TIMEOUT_MS). Measured on
 * this machine: `limit: 20` ran past 180 s and was killed by that timeout,
 * returning nothing; the plan's own ground-truth probe (feature-plan-3 §2.0)
 * took 30–60 s for 3 results. 8 keeps a comfortable margin while still
 * clearing the "≥3 results with DOIs" bar.
 */
const AI_CLI_RESULT_LIMIT = 8

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

function providerLabel(id: UiLitProviderId): string {
  return id === 'ai-cli' ? AI_CLI_LABEL : LIT_PROVIDER_META[id].label
}

export function SearchTab({ seed }: { seed: FindSimilarSeed | null }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const noteFileSaved = useProjectStore((s) => s.noteFileSaved)
  const setStatusNote = useUiStore((s) => s.setStatusNote)
  const cliPreference = useSettingsStore((s) => s.settings['lit.cli'])

  const [provider, setProviderState] = useState<UiLitProviderId>('crossref')
  const providerTouched = useRef(false)

  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([])
  const [availableClis, setAvailableClis] = useState<LitCliId[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LitResult[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  // The active ai-cli run: searchId + its event unsubscribers, so a provider
  // switch, a new search, or the tab unmounting can cancel/clean it up
  // (feature-plan-3 §2: "the child is killed on cancel or tab close").
  const activeAiSearch = useRef<{ searchId: string; unsubscribe: () => void } | null>(null)
  const [cancelling, setCancelling] = useState(false)

  function stopActiveAiSearch(): void {
    const active = activeAiSearch.current
    if (active === null) return
    active.unsubscribe()
    activeAiSearch.current = null
    void window.suna.invoke('lit:cancel', { searchId: active.searchId }).catch(() => {
      // best-effort — the child may already have exited
    })
  }

  // Switching away from ai-cli abandons its in-flight search: stop listening
  // AND reset the loading state (nothing else will now clear it, since the
  // 'lit:done' listener that normally does that was just unsubscribed).
  function setProvider(id: UiLitProviderId): void {
    providerTouched.current = true
    if (id !== 'ai-cli' && activeAiSearch.current !== null) {
      stopActiveAiSearch()
      setLoading(false)
      setProgress(null)
      setCancelling(false)
    }
    setProviderState(id)
  }

  useEffect(() => {
    void window.suna
      .invoke('lit:providers', {})
      .then((res) => setProviderStatus(res.providers))
      .catch(() => {
        // Settings can't show live status either in this case; the picker
        // still works, it just won't show hasKey badges.
      })
    void window.suna
      .invoke('lit:cli-status', {})
      .then((res) => {
        setAvailableClis(res.available)
        // ai-cli becomes the default only once, and only if the user hasn't
        // already picked a provider (feature-plan-3 §2 BUILD step 4).
        if (res.available.length > 0 && !providerTouched.current) setProviderState('ai-cli')
      })
      .catch(() => {
        // No CLI status: the picker still shows ai-cli, it just won't be the default.
      })
    // Cancel + clean up any in-flight ai-cli search when the tab unmounts.
    return () => stopActiveAiSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function runAiCliSearch(q: string): void {
    if (rootDir === null) {
      setError('Open a project first — the AI CLI runs with the project directory as its cwd.')
      return
    }
    stopActiveAiSearch()
    setLoading(true)
    setError(null)
    setResults([])
    setProgress('Starting…')
    setCancelling(false)

    void window.suna
      .invoke('lit:ai-search', { provider: 'ai-cli', query: q, limit: AI_CLI_RESULT_LIMIT, dir: rootDir })
      .then(({ searchId }) => {
        const unsubProgress = window.suna.onLitProgress(searchId, (status) => setProgress(status))
        const unsubDone = window.suna.onLitDone(searchId, (outcome) => {
          unsubProgress()
          unsubDone()
          activeAiSearch.current = null
          setLoading(false)
          setCancelling(false)
          setProgress(null)
          setResults(parseResults(outcome.results))
          setError(outcome.error)
        })
        activeAiSearch.current = {
          searchId,
          unsubscribe: () => {
            unsubProgress()
            unsubDone()
          }
        }
      })
      .catch((err: unknown) => {
        setLoading(false)
        setProgress(null)
        setResults([])
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  async function runHttpSearch(p: LitProviderId, q: string): Promise<void> {
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

  async function runSearch(p: UiLitProviderId, q: string): Promise<void> {
    if (q.trim() === '') return
    if (p === 'ai-cli') {
      runAiCliSearch(q)
      return
    }
    await runHttpSearch(p, q)
  }

  /**
   * User pressed Cancel. Unlike stopActiveAiSearch (used when the tab
   * unmounts or the provider changes and nothing is left to render into),
   * this deliberately KEEPS the 'lit:done' subscription alive: killing the
   * child makes the main process resolve the search with
   * `error: 'Search was cancelled.'`, and that event is what clears
   * `loading`/`progress` and tells the user what happened. Unsubscribing
   * first — as this used to — removed the only listener that could leave the
   * loading state, so the panel sat on "Cancelling…" with a live Cancel
   * button forever.
   */
  function handleCancel(): void {
    const active = activeAiSearch.current
    if (active === null) return
    setCancelling(true)
    void window.suna.invoke('lit:cancel', { searchId: active.searchId }).catch(() => {
      // best-effort — the child may already have exited; if the kill never
      // lands, main's 180s timeout resolves the same subscription.
    })
  }

  // "Find similar" from the Library tab: DOI lookup first, title search as fallback.
  // ai-cli has no DOI lookup path (it only ever runs a fresh web search), so
  // the seed goes straight to the title search for that provider.
  useEffect(() => {
    if (seed === null) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      setResults([])
      setQuery(seed.title)
      if (seed.doi !== null && provider !== 'ai-cli') {
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

  const currentStatus = provider === 'ai-cli' ? undefined : providerStatus.find((p) => p.id === provider)
  const cliInstallHint =
    availableClis.length === 0
      ? 'Install Claude Code or Codex, or use Crossref (no key needed).'
      : `Uses ${availableClis.map((id) => (id === 'claude' ? 'Claude Code' : 'Codex')).join(' or ')} (preference: ${cliPreference}).`

  return (
    <div className="lit-search">
      <div className="lit-search__providers" role="group" aria-label="Literature provider">
        {UI_LIT_PROVIDER_IDS.map((id) => {
          const status = id === 'ai-cli' ? undefined : providerStatus.find((p) => p.id === id)
          return (
            <button
              key={id}
              className="refs__style"
              aria-pressed={provider === id}
              onClick={() => setProvider(id)}
            >
              {providerLabel(id)}
              <span className="lit-search__provider-hint"> · {hintFor(id)}</span>
              {id !== 'ai-cli' && id !== 'crossref' && status?.hasKey === true && (
                <span className="lit-search__provider-hint"> · key set</span>
              )}
            </button>
          )
        })}
      </div>
      <p className="view__hint">
        {provider === 'ai-cli' ? cliInstallHint : LIT_PROVIDER_META[provider].note}
        {currentStatus?.keyless === false && currentStatus.hasKey === false && ' Add one in Settings.'}
      </p>

      <div className="lit-search__query">
        <input
          className="view__input"
          type="search"
          placeholder={`Search ${providerLabel(provider)}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch(provider, query)
          }}
        />
        <button className="lit-search__go" onClick={() => void runSearch(provider, query)} disabled={loading}>
          Search
        </button>
        {loading && provider === 'ai-cli' && (
          <button className="lit-search__go lit-search__cancel" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>

      {loading && (
        <p className="view__hint">
          {provider === 'ai-cli' ? (progress ?? `Searching with ${providerLabel(provider)}…`) : `Searching ${providerLabel(provider)}…`}
        </p>
      )}

      {error !== null && (
        <div className="view__error">
          <div>
            {providerLabel(provider)}: {error}
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
