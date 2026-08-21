import { useEffect, useMemo, useState, type JSX } from 'react'
import katex from 'katex'
import { outlineFromMarkdown, type OutlineSection } from '@suna/markdown'
import { formatVersionId, workingVersion } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useDocumentsStore } from '../state/documents'
import { LogVersionSheet } from '../documents/LogVersionSheet'
import { useManuscriptStore } from '../state/manuscript'
import { activeSlice, countWords, useManuscriptDocStore } from '../state/manuscriptDoc'
import { openManuscriptTab } from '../state/dock'
import { splitTexSpans } from '../manuscript/title-page'
import { OutlineList } from './OutlineList'
import './views.css'
import './manuscript-view.css'

/**
 * Prose with $...$ spans rendered through KaTeX, matching how the title page
 * itself renders the manuscript title (manuscript/TitlePage's TexText) —
 * the sidebar summary is otherwise the one place still showing raw "$...$".
 */
function TexText({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => splitTexSpans(text), [text])
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'math' ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(segment.value, { throwOnError: false })
            }}
          />
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </>
  )
}

/**
 * Manuscript sidebar: title/authors/abstract summary plus the outline —
 * clicking a row opens (or focuses) the combined manuscript tab and scrolls
 * it to that heading (feature-plan-7 §2 — activating the Manuscript view
 * itself, via the activity bar, also opens the tab; see state/ui.ts).
 */
export function ManuscriptView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const error = useManuscriptStore((s) => s.error)
  const authors = useManuscriptStore((s) => s.authors)
  const refresh = useManuscriptStore((s) => s.refresh)

  // The sidebar follows whichever document tab was activated last.
  const activeDocumentId = useManuscriptDocStore((s) => s.activeDocumentId)
  const liveOutline = useManuscriptDocStore((s) => activeSlice(s).outline)
  const activeSectionIndex = useManuscriptDocStore((s) => activeSlice(s).activeSectionIndex)
  const tabActive = useManuscriptDocStore((s) => activeSlice(s).tabActive)
  const tabMounted = useManuscriptDocStore((s) => activeSlice(s).tabMounted)

  const [diskOutline, setDiskOutline] = useState<OutlineSection[]>([])

  // The version the working copy carries, and the one button that freezes it.
  // Both live here rather than on the document list above, because what is
  // being logged is THIS manuscript — the one this panel summarises.
  const versions = useDocumentsStore((s) => s.versions)
  const [logging, setLogging] = useState(false)
  const working = formatVersionId(workingVersion(versions))

  useEffect(() => {
    void refresh()
  }, [refresh, rootDir, saveBump])

  // While the combined tab is closed, the outline comes from a disk read of
  // the manuscript file; once the tab is mounted, its live editor owns the
  // outline (state/manuscriptDoc) and tracks unsaved edits too.
  useEffect(() => {
    if (tabMounted || rootDir === null || manuscript === null) return
    let cancelled = false
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', {
          path: `${rootDir}/manuscript/${manuscript.manuscriptFile}`
        })
        if (!cancelled) setDiskOutline(outlineFromMarkdown(content))
      } catch {
        // no prose file yet
        if (!cancelled) setDiskOutline([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tabMounted, rootDir, manuscript, saveBump])

  const sections = tabMounted ? liveOutline : diskOutline

  const significanceWords =
    manuscript?.significance == null ? 0 : countWords(manuscript.significance)
  const highlightCount = manuscript?.highlights?.length ?? 0

  if (error !== null) {
    return (
      <div className="view">
        <div className="view__error">{error}</div>
      </div>
    )
  }
  if (!manuscript) {
    return (
      <p className="sidebar__empty">
        This project has no manuscript/manuscript.json yet.
      </p>
    )
  }

  return (
    <div className="view">
      {logging && <LogVersionSheet onClose={() => setLogging(false)} />}
      <div>
        {/*
          The manuscript's own title lives on the title page and in the tab;
          repeating it here cost three wrapped lines of a narrow sidebar and
          told the user nothing they were not already looking at.
        */}
        <div className="ms__title-row">
          <div className="ms__title">Manuscript</div>
          <span className="docs__version" title={`Working version — a log would freeze it as ${working}`}>
            {working}
          </span>
          <button
            className="docs__row-action"
            onClick={() => setLogging(true)}
            disabled={rootDir === null}
            title="Copy the manuscript as it stands into manuscript/archive/"
          >
            Log version
          </button>
        </div>
        <div className="ms__meta">
          <span>
            <strong>{authors.authors.length}</strong>{' '}
            {authors.authors.length === 1 ? 'author' : 'authors'}
          </span>
          <span>
            abstract <strong>{countWords(manuscript.abstract.content)}</strong> words
          </span>
          {/*
            Significance and highlights are optional front-matter — journals
            that want them cap them, so their size belongs in this summary.
            Absent (or empty), they stay out of it entirely.
          */}
          {significanceWords > 0 && (
            <span>
              significance <strong>{significanceWords}</strong> words
            </span>
          )}
          {highlightCount > 0 && (
            <span>
              <strong>{highlightCount}</strong>{' '}
              {highlightCount === 1 ? 'highlight' : 'highlights'}
            </span>
          )}
        </div>
      </div>

      <OutlineList
        title="Outline"
        sections={sections}
        activeIndex={activeSectionIndex}
        highlightActive={tabActive}
        disabled={rootDir === null}
        emptyLabel="No headings in the manuscript yet."
        onPick={(index) => {
          if (rootDir === null) return
          // Opening the tab FIRST: a click here means "take me to this
          // section", which is meaningless while the document it belongs to
          // is not on screen.
          openManuscriptTab(rootDir)
          if (activeDocumentId !== null)
            useManuscriptDocStore.getState().requestScroll(activeDocumentId, index)
        }}
      />

      <div className="ms__meta">
        <span>
          <strong>{manuscript.figures.length}</strong>{' '}
          {manuscript.figures.length === 1 ? 'figure' : 'figures'}
        </span>
        <span>
          <strong>{manuscript.tables.length}</strong>{' '}
          {manuscript.tables.length === 1 ? 'table' : 'tables'}
        </span>
      </div>
    </div>
  )
}
