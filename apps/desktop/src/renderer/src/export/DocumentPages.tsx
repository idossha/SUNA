import { useCallback, useEffect, useState, type JSX } from 'react'
import { getBundledProfile } from '@suna/formatter'
import type { OversizedBlock } from '@suna/core'
import { useEditorSettings } from '../editor/settings'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { usePreviewProfileId } from '../state/renderProfile'
import { oversizedMessage } from './oversized'
import { PagedDocument } from './PagedDocument'
import { rasterizeManuscriptFigures } from './rasterizeFigures'

/**
 * Pages mode: the document as the pages it will be exported as
 * (feature-plan-13 §B).
 *
 * A manuscript is written in a continuous scroll, but it is SUBMITTED as
 * paper — and page count, where a figure lands, and whether a table survives
 * a page boundary are all invisible until something paginates it. This is
 * that something, and it is deliberately not a second renderer: the pages
 * come from 'export:preview', which runs the very builders 'export:pdf' runs
 * and hands back the bytes instead of writing them. The breaks on screen are
 * the breaks in the file, because they are the same print pass.
 *
 * It is READ-ONLY. That is the whole trade the mode makes, and the reason it
 * is small: an editable page view would need a page-frame stylesheet, break
 * widgets inside CodeMirror and a way to map a page back to a source offset,
 * to end up with a WEAKER promise than "these are the export's own pages".
 * The tabs remove their editor entirely in this mode rather than disabling
 * it — a disabled CodeMirror still shows a caret and takes focus, which
 * invites typing that silently does nothing.
 *
 * What it renders with is not a new set of choices: the profile is the same
 * `usePreviewProfileId()` the References block and reading mode already use,
 * and the submission options come from that profile's own stated
 * `submissionFormat` — which is exactly where the export dialog initializes
 * its checkboxes from. So the page view agrees with both without either
 * reading the other's state.
 */

/** How long an out-of-band change waits before it costs a render. */
const DEBOUNCE_MS = 250

/**
 * Which document to lay out. A manuscript goes through the profile-driven
 * export pipeline; a letter goes through its own simpler one, and says so
 * rather than pretending a letter has a journal profile and figures.
 */
export type PagesSource = { kind: 'manuscript' } | { kind: 'letter'; documentId: string }

export function DocumentPages({ source }: { source: PagesSource }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  // An edit that reached disk — from another tab, an agent, or git — is the
  // only thing that can change these pages, since this mode cannot type.
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const profileId = usePreviewProfileId()
  const theme = useEditorSettings().editorTheme

  const [data, setData] = useState<string | null>(null)
  const [oversized, setOversized] = useState<readonly OversizedBlock[]>([])
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (): Promise<void> => {
    if (rootDir === null) return
    if (source.kind === 'letter') {
      setRendering(true)
      setError(null)
      try {
        const res = await window.suna.invoke('letter:preview', {
          dir: rootDir,
          documentId: source.documentId
        })
        setOversized([])
        setData(res.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRendering(false)
      }
      return
    }
    if (manuscript === null) return
    const profile = getBundledProfile(profileId)
    if (profile === null || profile === undefined) {
      setError(`no bundled profile "${profileId}"`)
      return
    }
    setRendering(true)
    setError(null)
    try {
      const figurePngPaths = await rasterizeManuscriptFigures(rootDir, manuscript, profile, {
        compress: true,
        cache: true
      })
      // The options a submitted manuscript is set with are the profile's own
      // stated ones — not a second set of switches for the author to keep in
      // sync with the export dialog's.
      const submission = profile.manuscript.submissionFormat
      const res = await window.suna.invoke('export:preview', {
        dir: rootDir,
        profileId,
        format: 'pdf',
        figurePngPaths,
        options: {
          doubleSpacing: submission.doubleSpacing ?? true,
          lineNumbers: submission.lineNumbers ?? true,
          pageNumbers: submission.pageNumbers ?? true,
          theme
        },
        target: 'manuscript'
      })
      setOversized(res.oversized)
      if (res.kind === 'pdf') setData(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRendering(false)
    }
  }, [rootDir, source, manuscript, profileId, theme])

  // Debounced, and re-run when something reaches disk. In practice this fires
  // on entering the mode and rarely after: the mode cannot type, so only an
  // edit from elsewhere moves these pages.
  useEffect(() => {
    const timer = setTimeout(() => {
      void run()
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [run, saveBump])

  const status = (
    <>
      {error !== null ? 'Could not render pages' : rendering ? 'Rendering…' : 'Pages'}
      <span className="paged-doc__note">as exported · read-only</span>
    </>
  )

  const banner =
    oversized.length > 0 ? (
      <ul className="export-preview__oversized">
        {oversized.map((block, i) => (
          <li key={`${block.label}-${i}`}>{oversizedMessage(block)}</li>
        ))}
      </ul>
    ) : undefined

  return (
    <PagedDocument
      data={data}
      rendering={rendering}
      error={error}
      status={status}
      banner={banner}
      fit="page"
      emptyLabel={source.kind === 'letter' ? 'Laying the letter out as pages…' : 'Laying the manuscript out as pages…'}
    />
  )
}
