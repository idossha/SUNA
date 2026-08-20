import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  AuthorsFileSchema,
  ManuscriptSchema,
  emptyAuthorsFile,
  LoggedVersionSchema,
  stageLabel,
  versionFilePath,
  type AuthorsFile,
  type LoggedVersion,
  type Manuscript
} from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useEditorSettings } from '../editor/settings'
import type { EditorViewMode } from '../editor/EditorTab'
import { getResolved, useResolved } from '../state/settings'
import { EDITOR_THEME_CLASS } from '../editor/themes'
import { SettingsPopover } from '../editor/SettingsPopover'
import { GearIcon } from '../editor/GearIcon'
import '../editor/editor.css'
import { manuscriptStyleVars } from '../manuscript/msdocStyle'
import { TitlePage } from '../manuscript/TitlePage'
import { ManuscriptEditor, type ManuscriptEditorHandle } from '../manuscript/ManuscriptEditor'
import { ReferencesBlock } from '../manuscript/ReferencesBlock'
import '../manuscript/manuscript.css'
import './documents.css'

const MODE_LABEL: Record<EditorViewMode, string> = {
  source: 'Source',
  reading: 'Reading'
}

/**
 * A logged version (manuscript/archive/vX.Y), read-only.
 *
 * The same surface as the manuscript tab — title page, live-preview prose,
 * profile-driven reference list, ⌘E to swap Reading ⇄ Source — because a
 * version is not a lesser document, it is the same document at an earlier
 * moment, and reading it as raw Markdown tells you less than the paper you
 * actually sent.
 *
 * What it does NOT have is any way to write: the editor is read-only, there
 * is no comments rail, no export and no title-page editing. Everything it
 * reads is addressed inside the version's own folder — its manuscript.json,
 * its prose, its references.bib — so the page is what was frozen, not the
 * current project wearing an old number.
 */
export function VersionTab({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')
  const versionId = String(params['versionId'] ?? '')
  /** Its own doc-store slice, so citation numbering never collides with the live manuscript's. */
  const documentId = `version:${versionId}`

  const contentWidthCh = useEditorSettings((s) => s.contentWidthCh)
  const fontSizePx = useEditorSettings((s) => s.fontSizePx)
  const fontFamily = useEditorSettings((s) => s.fontFamily)
  const lineHeight = useEditorSettings((s) => s.lineHeight)
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  const wrapRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ManuscriptEditorHandle>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [version, setVersion] = useState<LoggedVersion | null>(null)
  /**
   * Path prefix inside manuscript/ for this version's manuscript area. A v1
   * archive holds the manuscript at its root; a v2 archive nests it under
   * `manuscript/` beside the code, analysis and figures it was made from —
   * `versionFilePath` is what knows the difference.
   */
  const [base, setBase] = useState<string | null>(null)
  const [manuscript, setManuscript] = useState<Manuscript | null>(null)
  const [authors, setAuthors] = useState<AuthorsFile>(emptyAuthorsFile())
  const [error, setError] = useState<string | null>(null)

  const defaultMode = useResolved('editor.defaultMode').value as EditorViewMode
  const [mode, setMode] = useState<EditorViewMode>(() => getResolved('editor.defaultMode').value)
  const userPickedModeRef = useRef(false)

  const toggleMode = useCallback((): void => {
    userPickedModeRef.current = true
    setMode((current) => {
      const next: EditorViewMode = current === 'source' ? 'reading' : 'source'
      editorRef.current?.setLive(next === 'reading')
      return next
    })
  }, [])

  useEffect(() => {
    if (userPickedModeRef.current) return
    setMode(defaultMode)
    editorRef.current?.setLive(defaultMode === 'reading')
  }, [defaultMode])

  // ⌘E toggles reading ⇄ source, the same key as everywhere else.
  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'e') {
        event.preventDefault()
        toggleMode()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [toggleMode])

  useEffect(() => {
    let cancelled = false
    const read = async (path: string): Promise<string | null> => {
      try {
        const { text } = await window.suna.invoke('version:read-file', {
          dir: rootDir,
          versionId,
          path
        })
        return text
      } catch {
        return null
      }
    }
    void (async () => {
      const meta = await read('version.json')
      if (cancelled) return
      if (meta === null) {
        setError(`${versionId} has no version.json — the archive folder is incomplete.`)
        return
      }
      const logged = LoggedVersionSchema.parse(JSON.parse(meta))
      setVersion(logged)
      const at = (rel: string): string => versionFilePath(logged, 'manuscript', rel)
      setBase(`archive/${versionId}/${at('')}`.replace(/\/$/, ''))

      const doc = await read(at('manuscript.json'))
      const byline = await read(at('authors.json'))
      if (cancelled) return
      if (doc === null) {
        setError(`${versionId} has no manuscript.json.`)
        return
      }
      const parsed = ManuscriptSchema.safeParse(JSON.parse(doc))
      if (!parsed.success) {
        setError(`${versionId}/manuscript.json does not match the schema.`)
        return
      }
      setManuscript(parsed.data)
      if (byline !== null) {
        const people = AuthorsFileSchema.safeParse(JSON.parse(byline))
        if (people.success) setAuthors(people.data)
      }
      setError(null)
    })()
    return () => {
      cancelled = true
    }
  }, [rootDir, versionId])

  const settingsStyle = manuscriptStyleVars({
    contentWidthCh,
    fontSizePx,
    fontFamily,
    lineHeight,
    editorTheme
  })

  return (
    <div ref={wrapRef} className="mstab">
      <div
        className={`msdoc msdoc--${mode} editor-tab ${EDITOR_THEME_CLASS[editorTheme]}`}
        style={settingsStyle}
      >
        <div className="msdoc__toolbar">
          <span className="version__id">{versionId}</span>
          <span className="version__stage">
            {version === null ? '' : stageLabel(version.stage)}
          </span>
          <span className="version__lock" title="A logged version can never be edited">
            Read-only
          </span>
          <button
            className="editor-tab__mode"
            onClick={toggleMode}
            title="Toggle reading / source (⌘E)"
          >
            {MODE_LABEL[mode]}
          </button>
          <button
            className="editor-tab__gear"
            onClick={() => setSettingsOpen((open) => !open)}
            title="Manuscript appearance"
            aria-label="Manuscript appearance settings"
          >
            <GearIcon />
          </button>
          {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
        </div>

        <div className="msdoc__body">
          <div className="msdoc__page">
            {error !== null && <div className="msdoc__error">{error}</div>}
            {version !== null && (
              <p className="version__meta">
                Logged {new Date(version.createdAt).toLocaleString()} · {version.files.length}{' '}
                files
                {version.note.trim() === '' ? '' : ` · ${version.note}`}
              </p>
            )}
            {manuscript !== null && base !== null && (
              <>
                <TitlePage
                  manuscript={manuscript}
                  authors={authors.authors}
                  affiliations={authors.affiliations}
                />
                <div className="msdoc__rule" />
                <ManuscriptEditor
                  documentId={documentId}
                  ref={editorRef}
                  rootDir={rootDir}
                  contentPath={`${base}/${manuscript.manuscriptFile}`}
                  live={mode === 'reading'}
                  readOnly
                  onSettled={() => undefined}
                  onOutlineChange={() => undefined}
                />
                <div className="msdoc__rule" />
                <ReferencesBlock
                  documentId={documentId}
                  rootDir={rootDir}
                  manuscriptFile={`${base}/${manuscript.manuscriptFile}`}
                  figures={manuscript.figures}
                  tables={manuscript.tables}
                  bibliography={`${base}/${manuscript.bibliography}`}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
