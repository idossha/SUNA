import { useEffect, useState, type JSX } from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { PagedDocument } from '../export/PagedDocument'
import { openWithOs } from '../shell/os-actions'
import { paperLabel } from './paperSize'
import './viewer.css'

interface Geometry {
  widthIn: number
  heightIn: number
}

/**
 * Word viewer: a .docx in the project — an export in output/, a co-author's
 * revision — shown as pages instead of as a zip the editor cannot read.
 *
 * Nothing renders Word natively, so main converts the file's text and images
 * and prints them on the file's OWN page setup ('docx:preview'), and the
 * pages here are drawn by PagedDocument — the same component the export
 * preview and the editors' Pages mode use, so a Word file and a Word preview
 * cannot look like two different apps.
 *
 * The render is faithful, not identical, and the toolbar says so: Word breaks
 * lines itself, and equations, text boxes and headers/footers do not survive
 * the conversion. "Open in Word" is there for the moment that matters.
 */
export function DocxTab({ params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path

  const [data, setData] = useState<string | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [warnings, setWarnings] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let disposed = false
    setData(null)
    setGeometry(null)
    setWarnings([])
    setError(null)
    setRendering(true)
    void (async () => {
      try {
        const res = await window.suna.invoke('docx:preview', { path })
        if (disposed) return
        setData(res.data)
        setGeometry(res.geometry)
        setWarnings(res.warnings)
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!disposed) setRendering(false)
      }
    })()
    return () => {
      disposed = true
    }
  }, [path])

  const status = (
    <>
      <span className="docview__filename" title={path}>
        {fileName}
      </span>
      {geometry !== null && <span className="paged-doc__ms">{paperLabel(geometry)}</span>}
      {rendering && <span className="paged-doc__ms">Rendering…</span>}
      <button className="docview__btn" onClick={() => void openWithOs(path)}>
        Open in Word
      </button>
    </>
  )

  const banner = (
    <div className="docview__notes">
      <p className="docview__note">
        Approximate render of the file: its page size, margins and body face, but Word breaks lines
        itself, and equations, text boxes and headers/footers are not shown. Open it in Word for the
        exact document.
      </p>
      {warnings.map((warning, i) => (
        <p className="docview__note docview__note--warn" key={`${warning}-${i}`}>
          {warning}
        </p>
      ))}
    </div>
  )

  return (
    <div className="docview">
      <PagedDocument
        data={data}
        rendering={rendering}
        error={error}
        status={status}
        banner={banner}
        emptyLabel={`Rendering ${fileName}…`}
      />
    </div>
  )
}
