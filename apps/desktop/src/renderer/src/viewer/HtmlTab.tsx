import { useEffect, useState, type JSX } from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openWithOs } from '../shell/os-actions'
import { HtmlPageFrame } from './HtmlPageFrame'
import './viewer.css'

/**
 * Web-page viewer: an .html file in the project — an export in output/,
 * principally — shown as the page it is rather than as its source.
 *
 * The page itself is drawn by HtmlPageFrame — the same sandboxed frame the
 * export dialog previews a web export in, and where the reasoning about that
 * sandbox lives. One consequence is worth naming here: the reader script an
 * export carries does not run, and it only smooth-scrolls anchor clicks the
 * browser handles natively anyway. "Open in browser" hands the file to a real
 * browser when the live page is wanted.
 *
 * Source is one click away, read-only: the point of this tab is the rendered
 * page, and an .html file that someone means to EDIT is opened from the
 * explorer's "Open with…" path or an editor split, not by defeating the
 * viewer.
 */
export function HtmlTab({ params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path

  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'page' | 'source'>('page')

  useEffect(() => {
    let disposed = false
    setHtml(null)
    setError(null)
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', { path })
        if (!disposed) setHtml(content)
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      disposed = true
    }
  }, [path])

  return (
    <div className="docview">
      <div className="docview__toolbar">
        <span className="docview__filename" title={path}>
          {fileName}
        </span>
        <span className="docview__modes">
          <button
            className="docview__btn"
            aria-pressed={mode === 'page'}
            onClick={() => setMode('page')}
          >
            Page
          </button>
          <button
            className="docview__btn"
            aria-pressed={mode === 'source'}
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </span>
        <button className="docview__btn" onClick={() => void openWithOs(path)}>
          Open in browser
        </button>
      </div>
      {error !== null ? (
        <div className="docview__error">
          Could not open {fileName}: {error}
        </div>
      ) : html === null ? (
        <div className="docview__loading">Loading {fileName}…</div>
      ) : mode === 'source' ? (
        <pre className="docview__source">{html}</pre>
      ) : (
        <HtmlPageFrame html={html} title={`${fileName} (rendered)`} />
      )}
    </div>
  )
}
