import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Comment } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { acquireDocSession, useDocSessionMeta, type DocSession } from '../state/docSessions'
import { getResolved, useResolved, useSettingsStore } from '../state/settings'
import { useUiStore } from '../state/ui'
import { useVimModeStore } from '../state/vimMode'
import { useProjectStore } from '../state/project'
import { commentsByPath, useCommentsStore } from '../state/comments'
import { makeAnchor } from '../comments/anchor'
import {
  applySectionComments,
  commentHighlightExtension,
  liveAnchors,
  registerLiveAnchorSource
} from '../comments/anchorExtension'
import { CommentsRail } from '../comments/CommentsRail'
import { RailToggleButton } from '../comments/RailToggleButton'
import '../comments/comments.css'
import { createEditor, type EditorHandle } from './codemirror'
import { DivergenceBanner } from './DivergenceBanner'
import { openCitationPicker } from './CitationPicker'
import { openFigurePicker } from './FigurePicker'
import { editorSurfaceStyle, useEditorSettings } from './settings'
import { EDITOR_THEME_CLASS } from './themes'
import { SettingsPopover } from './SettingsPopover'
import { CONTENT_KIND_CLASS, contentKindFor } from './contentKind'
import './editor.css'

const NO_COMMENTS: Comment[] = []

/**
 * Two surfaces on one editable CodeMirror instance: 'source' is plain
 * markdown, 'reading' adds live-preview decorations (widgets with
 * cursor-reveal) plus reading typography. There is no static render here —
 * renderHtml stays in @suna/markdown for other consumers.
 */
export type EditorViewMode = 'source' | 'reading'

export const EDITOR_VIEW_MODES: readonly EditorViewMode[] = ['source', 'reading']

const MODE_LABEL: Record<EditorViewMode, string> = {
  source: 'Source',
  reading: 'Reading'
}

function GearIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 5.25A2.75 2.75 0 1 0 8 10.75 2.75 2.75 0 0 0 8 5.25Zm0-3.75.9 1.9 2.05-.55.55 2.05 1.9.9-1.35 1.6 1.35 1.6-1.9.9-.55 2.05-2.05-.55-.9 1.9-.9-1.9-2.05.55-.55-2.05-1.9-.9L3.95 8 2.6 6.4l1.9-.9.55-2.05 2.05.55.9-1.9Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function EditorTab({ api, params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path
  const contentKind = contentKindFor(fileName)
  const isMarkdown = contentKind === 'prose'

  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const sessionRef = useRef<DocSession | null>(null)
  /** Stable identity for the rail's effects (the ref makes empty deps safe). */
  const getEditorView = useCallback((): EditorView | null => handleRef.current?.view ?? null, [])
  /** CM's own scroller is the document's scroll element in this host. */
  const getScrollElement = useCallback(
    (): HTMLElement | null => handleRef.current?.view.scrollDOM ?? null,
    []
  )

  // Resolved through the two-level hierarchy (project ?? global ?? default),
  // NOT the global-only `settings` slice — a suna.json override the Settings
  // tab writes has to actually reach the editor. The editor-local appearance
  // store stays separate and is not written from here.
  const defaultMode = useResolved('editor.defaultMode').value
  const vimMotions = useResolved('editor.vimMotions').value

  // Markdown opens in the resolved default mode (reading unless overridden);
  // everything else is source-only.
  const [mode, setMode] = useState<EditorViewMode>(() =>
    isMarkdown ? getResolved('editor.defaultMode').value : 'source'
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Read by the async editor-creation effect, which resolves after mount.
  const modeRef = useRef(mode)
  const vimRef = useRef(vimMotions)
  vimRef.current = vimMotions
  const userPickedModeRef = useRef(false)

  const editorSettings = useEditorSettings()
  const editorTheme = editorSettings.editorTheme

  // ---- margin comment gutter (comments/CommentGutter) ----------------------
  // Comments only ever target a path relative to a project's manuscript/
  // folder (packages/core/src/comments.ts), so only markdown files opened
  // from inside <rootDir>/manuscript/ get a gutter — anything else (a plain
  // .md elsewhere, or a code/data tab) renders with no comments UI at all.
  const projectRootDir = useProjectStore((s) => s.rootDir)
  const sectionPath = useMemo(() => {
    if (!isMarkdown || projectRootDir === null) return null
    const prefix = `${projectRootDir}/manuscript/`
    return path.startsWith(prefix) ? path.slice(prefix.length) : null
  }, [isMarkdown, projectRootDir, path])
  const sectionPathRef = useRef(sectionPath)
  sectionPathRef.current = sectionPath

  const allComments = useCommentsStore((s) => s.comments)
  const commentsForPath = useMemo(
    () => (sectionPath === null ? NO_COMMENTS : (commentsByPath(allComments).get(sectionPath) ?? NO_COMMENTS)),
    [allComments, sectionPath]
  )
  // Resolved threads live in the rail's History, not in the text — only
  // open comments get an anchor highlight (the rail still gets all of them).
  const openCommentsForPath = useMemo(
    () => commentsForPath.filter((c) => !c.resolved),
    [commentsForPath]
  )
  const openCommentsForPathRef = useRef(openCommentsForPath)
  openCommentsForPathRef.current = openCommentsForPath

  useEffect(() => {
    if (sectionPath === null || projectRootDir === null) return
    const state = useCommentsStore.getState()
    if (state.rootDir !== projectRootDir || (!state.loaded && !state.loading)) {
      void useCommentsStore.getState().load(projectRootDir)
    }
  }, [sectionPath, projectRootDir])

  // The shared session's dirty flag drives the tab-title dot — a save (or an
  // edit) from ANY surface on this file updates every title.
  const meta = useDocSessionMeta(path)
  const metaDirty = meta?.dirty ?? false
  useEffect(() => {
    try {
      api.setTitle(metaDirty ? `${fileName} •` : fileName)
    } catch {
      // panel already disposed — nothing to retitle
    }
  }, [metaDirty, api, fileName])

  useEffect(() => {
    let disposed = false
    let detach: (() => void) | null = null
    let unregisterAnchors: (() => void) | null = null
    const { session, release } = acquireDocSession(path)
    sessionRef.current = session
    // idempotent; guarantees the default mode is known even if a tab mounts
    // before the status bar's load
    void useSettingsStore.getState().load()
    void (async () => {
      try {
        const content = await session.ready()
        if (disposed || !hostRef.current) return
        handleRef.current = createEditor({
          parent: hostRef.current,
          doc: content,
          fileName,
          filePath: path,
          rootDir: useProjectStore.getState().rootDir,
          theme: useEditorSettings.getState().editorTheme,
          live: isMarkdown && modeRef.current === 'reading',
          vim: vimRef.current,
          onVimMode: useVimModeStore.getState().setMode,
          // dirty tracking lives in the shared session (its sync extension
          // sees every local edit); nothing to do per keystroke here
          onDocChanged: () => {},
          onSave: () => session.save().then(() => undefined),
          // `:q` must not destroy an unwritten buffer — real vim answers "E37:
          // No write since last change" and stays put. Returning false is what
          // surfaces that; `:q!` (force) and `:wq` (which writes first) are the
          // two ways through. With the shared buffer, only the LAST view of a
          // dirty document refuses — another surface still holds the work.
          // `:q!` on that last view DISCARDS the buffer (revert to disk), so
          // the forcibly-abandoned edits cannot resurrect on the next open.
          onClose: (force) => {
            const lastView = session.viewCount() <= 1
            if (session.isDirty() && lastView && !force) return false
            if (force && lastView && session.isDirty()) session.discard()
            api.close()
            return true
          },
          // ⌘⇧M / context-menu "Comment": same anchored-comment flow as the
          // gutter's own drag-to-comment gesture below — only markdown files
          // opened from inside <rootDir>/manuscript/ have a valid comment
          // target, so this is a silent no-op elsewhere (sectionPathRef is
          // read at call time, matching that gesture's own convention).
          onComment: (view) => {
            const sp = sectionPathRef.current
            if (sp === null) return
            const { from, to } = view.state.selection.main
            if (from === to) return
            const anchor = makeAnchor(view.state.doc.toString(), from, to)
            useCommentsStore.getState().startDraft({ kind: 'section', path: sp, anchor }, anchor.quote)
          },
          // ⌘⇧K / context-menu "Insert citation…": works for any markdown
          // file, not just manuscript sections (citations resolve project-
          // wide via the project root + manuscript.json's bibliography).
          onInsertCitation: (view) => openCitationPicker(view),
          // ⌘⇧F / context-menu "Insert figure…": same reasoning — the figure
          // list is project-wide, so it works in any markdown file.
          onInsertFigure: (view) => openFigurePicker(view)
        })
        detach = session.attach(handleRef.current.view)

        if (isMarkdown) {
          const view = handleRef.current.view
          view.dispatch({
            effects: StateEffect.appendConfig.of([
              // highlight decorations + click-to-activate; the rail owns the
              // reverse direction (card click -> flash) and the flash watcher
              commentHighlightExtension((commentId: string) =>
                useCommentsStore.getState().setActive(commentId)
              )
            ])
          })
          applySectionComments(view, openCommentsForPathRef.current)
          const sp = sectionPathRef.current
          if (sp !== null) {
            unregisterAnchors = registerLiveAnchorSource(sp, () => liveAnchors(view.state))
          }
        }
      } catch (error) {
        if (!disposed) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
    return () => {
      disposed = true
      unregisterAnchors?.()
      detach?.()
      handleRef.current?.destroy()
      handleRef.current = null
      sessionRef.current = null
      release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // theme changes apply to the live CM instance without losing state
  useEffect(() => {
    handleRef.current?.setTheme(editorTheme)
  }, [editorTheme])

  // vim applies to both modes; the compartment swap keeps document state
  useEffect(() => {
    handleRef.current?.setVim(vimMotions)
  }, [vimMotions])

  // adopt the persisted default once settings arrive, unless ⌘E already ran
  useEffect(() => {
    if (!isMarkdown || userPickedModeRef.current) return
    modeRef.current = defaultMode
    setMode(defaultMode)
    handleRef.current?.setLive(defaultMode === 'reading')
  }, [defaultMode, isMarkdown])

  const toggleMode = (): void => {
    const next: EditorViewMode = mode === 'source' ? 'reading' : 'source'
    userPickedModeRef.current = true
    modeRef.current = next
    handleRef.current?.setLive(next === 'reading')
    setMode(next)
  }

  // keep focus on the editor so ⌘E/⌘S keep working after a switch
  useEffect(() => {
    handleRef.current?.view.focus()
  }, [mode])

  // ⌘E toggles source ⇄ reading; ⌘S is handled inside CodeMirror's keymap
  // (the editable surface is mounted in both modes)
  useEffect(() => {
    const node = rootRef.current
    if (!node || !isMarkdown) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'e') {
        event.preventDefault()
        toggleMode()
      }
      // ⌘⌥M toggles the comments rail (matching the manuscript tab)
      if (event.altKey && (event.key === 'm' || event.code === 'KeyM')) {
        event.preventDefault()
        useUiStore.getState().toggleCommentsRail()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isMarkdown])

  // push comment-list changes into this editor's live anchor decorations —
  // resolving/adding/removing a comment changes the set even when the
  // document itself hasn't changed. (The rail owns flash + active mirror.)
  useEffect(() => {
    const view = handleRef.current?.view
    if (view) applySectionComments(view, openCommentsForPath)
  }, [openCommentsForPath])

  if (loadError) {
    return (
      <div className="sidebar__empty">
        Could not open {fileName}: {loadError}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`editor-tab ${CONTENT_KIND_CLASS[contentKind]} ${EDITOR_THEME_CLASS[editorTheme]}`}
      style={editorSurfaceStyle(editorSettings)}
    >
      <div className="editor-tab__toolbar editor-tab__toolbar--row">
        {isMarkdown && (
          <button
            className="editor-tab__mode"
            onClick={toggleMode}
            title="Toggle reading / source (⌘E)"
          >
            {MODE_LABEL[mode]}
          </button>
        )}
        {sectionPath !== null && <RailToggleButton />}
        <button
          className="editor-tab__gear"
          onClick={() => setSettingsOpen((open) => !open)}
          title="Editor appearance"
          aria-label="Editor appearance settings"
        >
          <GearIcon />
        </button>
        {settingsOpen && (
          <SettingsPopover contentKind={contentKind} onClose={() => setSettingsOpen(false)} />
        )}
      </div>
      <DivergenceBanner path={path} />
      <div className={`editor-tab__source${mode === 'reading' ? ' editor-tab__source--reading' : ''}`}>
        <div ref={hostRef} className="editor-tab__cm" />
        {sectionPath !== null && (
          <CommentsRail
            comments={commentsForPath}
            docPath={sectionPath}
            getView={getEditorView}
            getScrollElement={getScrollElement}
          />
        )}
      </div>
    </div>
  )
}
