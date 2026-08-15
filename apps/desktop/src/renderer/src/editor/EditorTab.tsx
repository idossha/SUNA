import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Comment } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { devSeam } from '../state/devSeam'
import { useSettingsStore } from '../state/settings'
import { useUiStore } from '../state/ui'
import { useProjectStore } from '../state/project'
import { commentsByPath, useCommentsStore } from '../state/comments'
import { locate, makeAnchor } from '../comments/anchor'
import { anchorTopsFor, applySectionComments, commentAnchorExtension, flashAnchor } from '../comments/anchorExtension'
import { CommentGutter } from '../comments/CommentGutter'
import { useNarrowGutter } from '../comments/narrow'
import '../comments/comments.css'
import { createEditor, type EditorHandle } from './codemirror'
import { openCitationPicker } from './CitationPicker'
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
  const dirtyRef = useRef(false)

  // App-wide defaults (persisted by the main process); the editor-local
  // appearance store stays separate and is not written from here.
  const defaultMode = useSettingsStore((s) => s.settings['editor.defaultMode'])
  const vimMotions = useSettingsStore((s) => s.settings['editor.vimMotions'])

  // Markdown opens in the app-wide default mode (reading unless overridden);
  // everything else is source-only.
  const [mode, setMode] = useState<EditorViewMode>(() =>
    isMarkdown ? useSettingsStore.getState().settings['editor.defaultMode'] : 'source'
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
  const commentsForPathRef = useRef(commentsForPath)
  commentsForPathRef.current = commentsForPath
  const flashRequest = useCommentsStore((s) => s.flashRequest)

  const gutterTrackRef = useRef<HTMLDivElement>(null)
  const [anchorTops, setAnchorTops] = useState<ReadonlyMap<string, number>>(new Map())
  const [gutterHeight, setGutterHeight] = useState(0)
  const narrowGutter = useNarrowGutter()
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const recomputePositionsRef = useRef<() => void>(() => {})
  const geometryCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (sectionPath === null || projectRootDir === null) return
    const state = useCommentsStore.getState()
    if (state.rootDir !== projectRootDir || (!state.loaded && !state.loading)) {
      void useCommentsStore.getState().load(projectRootDir)
    }
  }, [sectionPath, projectRootDir])

  const handleAnchorActivate = useCallback((comment: Comment): void => {
    useCommentsStore.getState().requestFlash(comment.id)
  }, [])

  const markDirty = (dirty: boolean): void => {
    if (dirtyRef.current === dirty) return
    dirtyRef.current = dirty
    api.setTitle(dirty ? `${fileName} •` : fileName)
  }

  const save = async (): Promise<void> => {
    const view = handleRef.current?.view
    if (!view) return
    try {
      await window.suna.invoke('fs:write-text', {
        path,
        content: view.state.doc.toString()
      })
      markDirty(false)
      devSeam.noteFileSaved(path)
      useUiStore.getState().setStatusNote(`Saved ${fileName}`)
    } catch (error) {
      useUiStore
        .getState()
        .setStatusNote(
          `Could not save ${fileName}: ${error instanceof Error ? error.message : String(error)}`
        )
    }
  }

  useEffect(() => {
    let disposed = false
    // idempotent; guarantees the default mode is known even if a tab mounts
    // before the status bar's load
    void useSettingsStore.getState().load()
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', { path })
        if (disposed || !hostRef.current) return
        handleRef.current = createEditor({
          parent: hostRef.current,
          doc: content,
          fileName,
          theme: useEditorSettings.getState().editorTheme,
          live: isMarkdown && modeRef.current === 'reading',
          vim: vimRef.current,
          onDocChanged: () => markDirty(true),
          onSave: () => void save(),
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
          onInsertCitation: (view) => openCitationPicker(view)
        })

        if (isMarkdown) {
          const view = handleRef.current.view

          let recomputeScheduled = false
          const recompute = (): void => {
            const gutterEl = gutterTrackRef.current
            if (gutterEl === null) return
            setAnchorTops(anchorTopsFor(view, commentsForPathRef.current, gutterEl))
          }
          const scheduleRecompute = (): void => {
            if (recomputeScheduled) return
            recomputeScheduled = true
            requestAnimationFrame(() => {
              recomputeScheduled = false
              recompute()
            })
          }
          recomputePositionsRef.current = recompute

          view.dispatch({
            effects: StateEffect.appendConfig.of([
              commentAnchorExtension(
                (from, to) => {
                  const sp = sectionPathRef.current
                  if (sp === null) return
                  const anchor = makeAnchor(view.state.doc.toString(), from, to)
                  useCommentsStore
                    .getState()
                    .startDraft({ kind: 'section', path: sp, anchor }, anchor.quote)
                },
                (commentId) => setActiveCommentId(commentId)
              ),
              EditorView.updateListener.of((u) => {
                if (u.docChanged || u.viewportChanged || u.geometryChanged) scheduleRecompute()
              })
            ])
          })
          applySectionComments(view, commentsForPathRef.current)
          scheduleRecompute()

          // CodeMirror owns the actual scrolling element here (.cm-scroller,
          // exposed as view.scrollDOM — unlike the combined manuscript tab,
          // .editor-tab__source itself does not scroll), so position
          // recompute is driven off it directly.
          let scrollScheduled = false
          const onScroll = (): void => {
            if (scrollScheduled) return
            scrollScheduled = true
            requestAnimationFrame(() => {
              scrollScheduled = false
              recompute()
            })
          }
          view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
          const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (entry !== undefined) setGutterHeight(entry.contentRect.height)
            recompute()
          })
          resizeObserver.observe(view.scrollDOM)
          geometryCleanupRef.current = () => {
            view.scrollDOM.removeEventListener('scroll', onScroll)
            resizeObserver.disconnect()
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
      geometryCleanupRef.current?.()
      geometryCleanupRef.current = null
      handleRef.current?.destroy()
      handleRef.current = null
      recomputePositionsRef.current = () => {}
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
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'e') return
      event.preventDefault()
      toggleMode()
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isMarkdown])

  /** Stable callback for the gutter's onTrackMoved (see CommentGutter). */
  const recomputePositions = useCallback((): void => recomputePositionsRef.current(), [])

  // push comment-list changes into this editor's live anchor decorations and
  // re-diff their positions — resolving/adding/removing a comment changes
  // the set the gutter tracks even when the document itself hasn't changed.
  useEffect(() => {
    const view = handleRef.current?.view
    if (view) applySectionComments(view, commentsForPath)
    recomputePositionsRef.current()
  }, [commentsForPath])

  // "scroll to and flash the anchor" requests from the margin gutter
  // (comments/CommentGutter.tsx); a no-op unless the flashed comment targets
  // this file and its quote still resolves in the live document.
  useEffect(() => {
    if (flashRequest === null || sectionPath === null) return
    const view = handleRef.current?.view
    const comment = commentsForPathRef.current.find((c) => c.id === flashRequest.commentId)
    if (!view || comment === undefined || comment.target.kind !== 'section') return
    const range = locate(view.state.doc.toString(), comment.target.anchor)
    if (range === null) return
    flashAnchor(view, range.from, range.to)
  }, [flashRequest, sectionPath])

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
      <div className={`editor-tab__source${mode === 'reading' ? ' editor-tab__source--reading' : ''}`}>
        <div ref={hostRef} className="editor-tab__cm" />
        {sectionPath !== null && (
          <CommentGutter
            ref={gutterTrackRef}
            comments={commentsForPath}
            anchorTops={anchorTops}
            containerHeight={gutterHeight}
            narrow={narrowGutter}
            activeId={activeCommentId}
            onActiveIdChange={setActiveCommentId}
            onAnchorActivate={handleAnchorActivate}
            onTrackMoved={recomputePositions}
          />
        )}
      </div>
    </div>
  )
}
