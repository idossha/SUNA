import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Manuscript, OversizedBlock, PublisherProfile } from '@suna/core'
import { HtmlPageFrame } from '../viewer/HtmlPageFrame'
import { oversizedMessage } from './oversized'
import { PagedDocument } from './PagedDocument'
import { rasterizeManuscriptFigures } from './rasterizeFigures'

/**
 * The export page's live preview: what the file will look like, before it
 * exists.
 *
 * It renders nothing of its own. Every pixel here comes from the
 * 'export:preview' channel, which runs the SAME builders 'export:pdf' and
 * 'export:html' run and hands the bytes back instead of writing them — so
 * this panel cannot show a layout the export would not produce. A Word
 * export previews as its own page geometry rendered to PDF — both writers
 * share export-style.ts.
 *
 * The pages themselves are drawn by PagedDocument, which the editors' Pages
 * mode mounts too — one page renderer in the app, so a preview and a page
 * view cannot disagree about what the export looks like.
 *
 * Speed comes from three places, none of them a shortcut in fidelity:
 *  - figures rasterize at preview resolution and are cached by their SVG
 *    text, so an unchanged figure is never re-encoded (rasterizeFigures.ts);
 *  - main reuses one hidden window for the print pass (export-preview.ts);
 *  - renders are debounced, and a stale one is dropped by generation rather
 *    than cancelled — the last request always wins.
 */

/** How long a styling change waits before it costs a render. */
const DEBOUNCE_MS = 250

export function ExportPreview({
  rootDir,
  manuscript,
  profile,
  profileId,
  format,
  target,
  doubleSpacing,
  lineNumbers,
  pageNumbers,
  theme
}: {
  rootDir: string
  manuscript: Manuscript
  profile: PublisherProfile
  profileId: string
  format: 'docx' | 'pdf' | 'html'
  target: 'manuscript' | 'supplement'
  // The submission options arrive as primitives, not as one options object:
  // a fresh object literal from the parent would change identity on every
  // render and re-trigger the render effect forever.
  doubleSpacing: boolean
  lineNumbers: boolean
  pageNumbers: boolean
  theme?: string
}): JSX.Element {
  const [pdfData, setPdfData] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [oversized, setOversized] = useState<readonly OversizedBlock[]>([])
  const [ms, setMs] = useState<number | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (): Promise<void> => {
    setRendering(true)
    setError(null)
    try {
      // Preview resolution, cached by figure SVG: the submission-resolution
      // rasters are the real export's business, not a preview's.
      const figurePngPaths = await rasterizeManuscriptFigures(rootDir, manuscript, profile, {
        compress: true,
        cache: true
      })
      const res = await window.suna.invoke('export:preview', {
        dir: rootDir,
        profileId,
        format,
        figurePngPaths,
        options: { doubleSpacing, lineNumbers, pageNumbers, theme },
        target
      })
      setOversized(res.oversized)
      setMs(res.ms)
      if (res.kind === 'html') {
        setHtml(res.data)
        setPdfData(null)
      } else {
        setPdfData(res.data)
        setHtml(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRendering(false)
    }
  }, [rootDir, manuscript, profile, profileId, format, target, doubleSpacing, lineNumbers, pageNumbers, theme])

  // Debounced: a burst of checkbox clicks costs one render, not five.
  useEffect(() => {
    const timer = setTimeout(() => {
      void run()
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [run])

  const banner =
    oversized.length > 0 ? (
      <ul className="export-preview__oversized">
        {oversized.map((block, i) => (
          <li key={`${block.label}-${i}`}>{oversizedMessage(block)}</li>
        ))}
      </ul>
    ) : null

  const status = (
    <>
      {error !== null ? 'Preview failed' : rendering ? 'Rendering…' : 'Preview'}
      {ms !== null && !rendering && error === null && <span className="paged-doc__ms">{ms} ms</span>}
    </>
  )

  // A web page has no pages to draw, so the HTML format shows the page itself
  // rather than a paginated render of it.
  if (html !== null) {
    return (
      <div className="export-preview">
        <div className="paged-doc__bar">
          <span className="paged-doc__status">{status}</span>
        </div>
        {banner}
        <div className="paged-doc__scroll">
          <HtmlPageFrame html={html} title="Web page preview" />
        </div>
      </div>
    )
  }

  return (
    <div className="export-preview">
      <PagedDocument
        data={pdfData}
        rendering={rendering}
        error={error}
        status={status}
        banner={banner}
        emptyLabel="Rendering the first preview…"
      />
    </div>
  )
}
