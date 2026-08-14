import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { AGENT_PROVIDERS, useAgentChatStore, type AgentProvider } from '../state/agentChat'
import { useProjectStore } from '../state/project'
import { openTerminalWithCommand } from '../terminal/sessions'
import './views.css'
import './agent-cli.css'

const CLI_COLLABORATORS = [
  { command: 'claude', label: 'Claude Code' },
  { command: 'codex', label: 'Codex CLI' }
] as const

/**
 * Subscription-path CLI launcher (flux pattern): write the project's MCP
 * config, then launch the CLI in a terminal tab at the project cwd, so the
 * user's own subscription login applies — no API key involved.
 */
function CliCollaborators(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const launch = async (command: string, label: string): Promise<void> => {
    setError(null)
    if (rootDir === null) {
      setError('Open a project first — the CLI runs in the project folder.')
      return
    }
    try {
      await window.suna.invoke('agent:write-mcp-config', { dir: rootDir })
    } catch (err) {
      setError(
        `Could not write the MCP config: ${err instanceof Error ? err.message : String(err)}`
      )
      return
    }
    openTerminalWithCommand(command)
    setNote(
      `${label} is starting in the terminal with SUNA's manuscript tools exposed over MCP. ` +
        `Sign-in and billing use your own ${label} subscription.`
    )
  }

  return (
    <div className="agent-cli">
      <div className="view__section-title">CLI collaborators</div>
      <div className="agent-cli__buttons">
        {CLI_COLLABORATORS.map(({ command, label }) => (
          <button key={command} className="btn" onClick={() => void launch(command, label)}>
            Open {label} here
          </button>
        ))}
      </div>
      {error !== null && <div className="view__error">{error}</div>}
      {note !== null && <p className="agent-cli__note agent-cli__note--ok">{note}</p>}
      <p className="agent-cli__note">
        Launches the CLI in the project folder using your own subscription login. SUNA&#39;s
        manuscript tools (sections, references, figures) are exposed to it via MCP.
      </p>
    </div>
  )
}

export function AgentView(): JSX.Element {
  const provider = useAgentChatStore((s) => s.provider)
  const configured = useAgentChatStore((s) => s.configured)
  const statusLoaded = useAgentChatStore((s) => s.statusLoaded)
  const messages = useAgentChatStore((s) => s.messages)
  const busy = useAgentChatStore((s) => s.busy)
  const error = useAgentChatStore((s) => s.error)
  const setProvider = useAgentChatStore((s) => s.setProvider)
  const refreshStatus = useAgentChatStore((s) => s.refreshStatus)
  const saveKey = useAgentChatStore((s) => s.saveKey)
  const send = useAgentChatStore((s) => s.send)

  const [keyDraft, setKeyDraft] = useState('')
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const needsKey = provider !== 'ollama'
  const ready = !needsKey || configured[provider]

  const submit = (): void => {
    if (draft.trim() === '' || busy) return
    void send(draft)
    setDraft('')
  }

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="view agent">
      <CliCollaborators />
      <div className="agent__setup">
        <div className="view__section-title">API providers</div>
        <div className="agent__provider-row">
          <select
            className="view__select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as AgentProvider)}
          >
            {AGENT_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="agent__status">
            <span className={ready ? 'agent__dot agent__dot--ok' : 'agent__dot'} />
            {!statusLoaded ? '…' : needsKey ? (configured[provider] ? 'key saved' : 'no key') : 'local'}
          </span>
        </div>
        {needsKey ? (
          <div className="agent__key-row">
            <input
              className="view__input"
              type="password"
              placeholder={`${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && keyDraft.trim() !== '') {
                  void saveKey(keyDraft)
                  setKeyDraft('')
                }
              }}
            />
            <button
              className="btn"
              disabled={keyDraft.trim() === ''}
              onClick={() => {
                void saveKey(keyDraft)
                setKeyDraft('')
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <p className="view__hint">Ollama runs locally — no key required.</p>
        )}
      </div>

      <div className="agent__messages" ref={scrollRef}>
        {messages.length === 0 && !busy && (
          <p className="view__hint">
            Ask for a tighter abstract, a clearer figure caption, or a restructured argument.
            Cmd-Enter sends.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`agent__bubble agent__bubble--${msg.role === 'user' ? 'user' : 'assistant'}`}
          >
            {msg.content}
          </div>
        ))}
        {busy && (
          <div className="agent__bubble agent__bubble--assistant agent__bubble--busy">Thinking…</div>
        )}
        {error !== null && <div className="view__error">{error}</div>}
      </div>

      <div className="agent__composer">
        <textarea
          className="view__textarea"
          placeholder={ready ? 'Message your collaborator…' : 'Save an API key to start chatting'}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKeyDown}
        />
        <button
          className="btn btn--primary"
          disabled={busy || draft.trim() === ''}
          onClick={submit}
        >
          {busy ? 'Thinking…' : 'Send'}
        </button>
        <div className="agent__composer-hint">⌘⏎ to send</div>
      </div>
    </div>
  )
}
