import { useEffect, useState, type JSX } from 'react'
import type { LitCliId } from '@suna/core'
import { AGENT_PROVIDER_IDS, type AgentProviderId, type StepProps } from '../types'

const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama (local)'
}

function cliDisplayName(id: LitCliId): string {
  return id === 'claude' ? 'Claude Code' : 'Codex'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Step 5 — AI (feature-plan-5 §5). CLI detection is shared with the
 * literature-search picker ('lit:cli-status') rather than a second detector.
 * An API key card writes immediately through the existing global key
 * channel — like the Settings page's provider rows — since a keychain entry
 * isn't project state; `.mcp.json` (which is) waits for step 7.
 */
export function Step5Ai({ state, update }: StepProps): JSX.Element {
  const [keyDraft, setKeyDraft] = useState('')
  const [keyStatus, setKeyStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [keyError, setKeyError] = useState<string | null>(null)

  useEffect(() => {
    if (state.clisScanned) return
    update({ clisScanned: true })
    void window.suna
      .invoke('lit:cli-status', {})
      .then((res) => {
        update({ detectedClis: res.available })
        if (res.available.length > 0) {
          update({ aiCliCommand: res.available[0] ?? null })
        }
      })
      .catch(() => update({ detectedClis: [] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.clisScanned])

  const saveKey = async (): Promise<void> => {
    if (state.apiProvider === null || keyDraft.trim() === '') return
    setKeyStatus('saving')
    setKeyError(null)
    try {
      await window.suna.invoke('agent:set-key', { provider: state.apiProvider, key: keyDraft })
      setKeyStatus('saved')
      setKeyDraft('')
    } catch (error) {
      setKeyStatus('error')
      setKeyError(errorMessage(error))
    }
  }

  return (
    <div className="onboard__step-page">
      <h2 className="onboard__step-title">AI</h2>
      <p className="onboard__step-sub">
        How SUNA&apos;s AI features (literature search, the palette&apos;s &quot;?&quot; ask) reach a
        model for this project.
      </p>

      <label className="onboard__choice">
        <input
          type="radio"
          name="onboard-ai"
          checked={state.aiChoice === 'cli'}
          onChange={() => update({ aiChoice: 'cli' })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Agent CLI (recommended)</div>
          <div className="onboard__choice-hint">
            Uses your existing Claude Code / Codex subscription — no API key stored.{' '}
            {!state.clisScanned && 'Checking…'}
            {state.clisScanned && state.detectedClis.length === 0 && 'Neither was found on PATH.'}
            {state.clisScanned &&
              state.detectedClis.length > 0 &&
              `Detected: ${state.detectedClis.map(cliDisplayName).join(', ')}.`}
          </div>
        </div>
      </label>

      {state.aiChoice === 'cli' && state.detectedClis.length > 1 && (
        <div className="onboard__sublist">
          {state.detectedClis.map((cli) => (
            <label className="onboard__choice" key={cli} style={{ padding: '6px 0' }}>
              <input
                type="radio"
                name="onboard-ai-cli"
                checked={state.aiCliCommand === cli}
                onChange={() => update({ aiCliCommand: cli })}
              />
              <div className="onboard__choice-body">
                <div className="onboard__choice-title">{cliDisplayName(cli)}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <label className="onboard__choice">
        <input
          type="radio"
          name="onboard-ai"
          checked={state.aiChoice === 'api'}
          onChange={() => update({ aiChoice: 'api' })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">API key</div>
          <div className="onboard__choice-hint">Stored in the OS keychain, billed per token.</div>
        </div>
      </label>

      {state.aiChoice === 'api' && (
        <div className="onboard__sublist">
          <div className="onboard__row">
            <select
              value={state.apiProvider ?? ''}
              onChange={(e) => {
                update({ apiProvider: (e.target.value || null) as AgentProviderId | null })
                setKeyStatus('idle')
              }}
            >
              <option value="">Choose a provider…</option>
              {AGENT_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="API key"
              value={keyDraft}
              onChange={(e) => {
                setKeyDraft(e.target.value)
                setKeyStatus('idle')
              }}
              style={{
                flex: 1,
                padding: '6px 9px',
                fontFamily: 'var(--s-font-mono)',
                fontSize: 'var(--s-text-xs)',
                background: 'var(--s-bg-raised)',
                border: '1px solid var(--s-border)',
                borderRadius: 'var(--s-radius)',
                color: 'var(--s-ink)'
              }}
            />
            <button
              className="btn"
              disabled={state.apiProvider === null || keyDraft.trim() === '' || keyStatus === 'saving'}
              onClick={() => void saveKey()}
            >
              {keyStatus === 'saving' ? 'Saving…' : 'Save key'}
            </button>
          </div>
          {keyStatus === 'saved' && (
            <div className="onboard__field-hint">Key saved to the keychain.</div>
          )}
          {keyStatus === 'error' && <div className="onboard__field-error">{keyError}</div>}
        </div>
      )}

      <label className="onboard__choice">
        <input
          type="radio"
          name="onboard-ai"
          checked={state.aiChoice === 'skip'}
          onChange={() => update({ aiChoice: 'skip' })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Skip</div>
          <div className="onboard__choice-hint">Set this up later from Settings.</div>
        </div>
      </label>

      <label className="onboard__choice" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={state.writeMcpConfig}
          onChange={(e) => update({ writeMcpConfig: e.target.checked })}
        />
        <div className="onboard__choice-body">
          <div className="onboard__choice-title">Also write .mcp.json</div>
          <div className="onboard__choice-hint">
            Lets an agent CLI running in this project use SUNA&apos;s own tools (edit sections,
            manage figures, search references) via MCP. Written on Create project, alongside the
            rest of the project.
          </div>
        </div>
      </label>
    </div>
  )
}
