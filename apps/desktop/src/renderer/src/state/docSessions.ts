import { Annotation, ChangeSet, StateEffect, Text, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { create } from 'zustand'
import { minimalDiff } from './minimalDiff'
import { devSeam } from './devSeam'
import { autosaveEnabled } from './autosave'
import { useProjectStore } from './project'
import { useUiStore } from './ui'

/**
 * One shared document session per absolute file path, so every surface
 * showing the same file (the Explorer's raw editor tab, the combined
 * Manuscript tab, a split) edits ONE buffer: typing in either view appears
 * in the other immediately, there is a single dirty state and a single save
 * path, and external disk changes (an agent's edit_manuscript, git) are
 * applied as a minimal single-span change so CodeMirror maps the selection,
 * scroll anchor and comment marks through them instead of clobbering them.
 *
 * Heavyweight internals (CM Text, attached views) live in a module-level
 * map, the dockApi precedent; a small zustand store carries only the
 * reactive meta (dirty/diverged/view count) hosts subscribe to.
 */

/**
 * Idle before an autosave fires, in ms. Long enough that ordinary typing
 * never triggers one mid-word, short enough that stepping away from the
 * keyboard leaves the work on disk. One save per pause, not per keystroke:
 * the timer restarts on every edit and the session goes clean when it lands.
 */
export const AUTOSAVE_IDLE_MS = 1000

/** Marks a transaction as forwarded from the session (loop prevention). */
export const remoteSync = Annotation.define<boolean>()

/**
 * CodeMirror normalizes line endings on EditorState.create AND on every
 * string insert (split on /\r\n?|\n/), so the session must speak LF
 * throughout or a CRLF file permanently desyncs core from views (verified:
 * the attach-time convergence dispatch turns \r\n into spurious blank
 * lines). Consequence: the first save of a CRLF file writes LF — an honest,
 * visible normalization rather than a silent corruption.
 */
function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export interface DocSessionMeta {
  dirty: boolean
  /** Disk changed while the buffer was dirty; resolveDivergence() clears it. */
  diverged: boolean
  views: number
}

interface DocSessionsState {
  meta: ReadonlyMap<string, DocSessionMeta>
}

export const useDocSessionsStore = create<DocSessionsState>(() => ({
  meta: new Map<string, DocSessionMeta>()
}))

/** Reactive meta for one path — tab-title dots, the divergence banner. */
export function useDocSessionMeta(path: string | null): DocSessionMeta | undefined {
  return useDocSessionsStore((s) => (path === null ? undefined : s.meta.get(path)))
}

function setMeta(path: string, patch: Partial<DocSessionMeta>): void {
  useDocSessionsStore.setState((s) => {
    const current = s.meta.get(path) ?? { dirty: false, diverged: false, views: 0 }
    const next = { ...current, ...patch }
    if (
      next.dirty === current.dirty &&
      next.diverged === current.diverged &&
      next.views === current.views &&
      s.meta.has(path)
    ) {
      return s
    }
    const meta = new Map(s.meta)
    meta.set(path, next)
    return { meta }
  })
}

function dropMeta(path: string): void {
  useDocSessionsStore.setState((s) => {
    if (!s.meta.has(path)) return s
    const meta = new Map(s.meta)
    meta.delete(path)
    return { meta }
  })
}

/**
 * The seam the sync core works against, so the operational logic is testable
 * without a DOM: a real attached EditorView is wrapped into one of these.
 */
export interface SessionView {
  getDoc: () => Text
  /** Apply forwarded changes (dispatched with the remoteSync annotation). */
  applyRemote: (changes: ChangeSet) => void
  isComposing: () => boolean
}

interface ViewEntry {
  view: SessionView
  /**
   * Changes the view has not seen yet, expressed against ITS current doc
   * (invariant: applying `pending` to the view's doc yields the session doc).
   * Non-null only while the view is IME-composing — dispatching into a
   * composing view would abort the user's composition, so remote changes
   * queue here and are rebased through the view's own composition edits
   * (ChangeSet.map, the collab OT mechanic), then flushed on compositionend.
   */
  pending: ChangeSet | null
}

const REMOTE_ANNOTATIONS = [remoteSync.of(true), Transaction.addToHistory.of(false)]

/**
 * The transport-free sync core: an authoritative Text plus N views kept in
 * lockstep by forwarding ChangeSets. Exported for unit tests; production
 * code uses DocSession below.
 */
export class DocSessionCore {
  doc: Text
  readonly entries = new Set<ViewEntry>()
  onLocalEdit: (() => void) | null = null

  constructor(initial: string) {
    this.doc = Text.of(initial.split('\n'))
  }

  text(): string {
    return this.doc.toString()
  }

  addView(view: SessionView): ViewEntry {
    const entry: ViewEntry = { view, pending: null }
    // A view created from ready()'s snapshot may already be behind (another
    // view typed between load and attach) — converge it before it joins.
    const current = view.getDoc().toString()
    const authoritative = this.text()
    if (current !== authoritative) {
      const span = minimalDiff(current, authoritative)
      if (span !== null) view.applyRemote(ChangeSet.of(span, view.getDoc().length))
    }
    this.entries.add(entry)
    return entry
  }

  removeView(entry: ViewEntry): void {
    this.entries.delete(entry)
  }

  /**
   * A view produced local changes (a user edit, NOT a remoteSync
   * application). Rebases over anything the view hasn't seen, folds the
   * result into the authoritative doc, and forwards it to every other view.
   */
  applyLocal(entry: ViewEntry, changes: ChangeSet): void {
    if (!this.entries.has(entry)) return
    let forSession = changes
    if (entry.pending !== null) {
      // The edit happened against a doc missing `pending`: rebase the edit
      // over pending for the session, and pending over the edit for the view.
      forSession = changes.map(entry.pending)
      entry.pending = entry.pending.map(changes, true)
    }
    this.doc = forSession.apply(this.doc)
    this.onLocalEdit?.()
    for (const other of this.entries) {
      if (other === entry) continue
      this.deliver(other, forSession)
    }
  }

  /** Apply external content (disk reload) to the session and every view. */
  applyExternal(content: string): void {
    const span = minimalDiff(this.text(), content)
    if (span === null) return
    const changes = ChangeSet.of(span, this.doc.length)
    this.doc = changes.apply(this.doc)
    for (const entry of this.entries) this.deliver(entry, changes)
  }

  private deliver(entry: ViewEntry, changes: ChangeSet): void {
    // Once a view is behind (composing, or already queued), keep queueing so
    // ordering is preserved; flush converges it in one dispatch.
    if (entry.view.isComposing() || entry.pending !== null) {
      entry.pending = entry.pending === null ? changes : entry.pending.compose(changes)
      return
    }
    entry.view.applyRemote(changes)
  }

  /** Deliver queued changes once the view is safe to dispatch into. */
  flushPending(entry: ViewEntry): void {
    if (entry.pending === null || entry.view.isComposing()) return
    const changes = entry.pending
    entry.pending = null
    entry.view.applyRemote(changes)
  }
}

export interface DocSession {
  readonly path: string
  /** Load once (shared promise); later callers get the CURRENT buffer. */
  ready: () => Promise<string>
  /** Attach a live EditorView; returns the detach function. */
  attach: (view: EditorView) => () => void
  text: () => string
  isDirty: () => boolean
  viewCount: () => number
  /** THE save path: atomic write + saveBump + status note. Resolves false on failure. */
  save: () => Promise<boolean>
  /** Test seam: run any pending autosave now instead of waiting out the idle. */
  flushAutosave: () => Promise<boolean>
  resolveDivergence: (choice: 'keepMine' | 'reloadDisk') => void
  /** Revert the buffer to the last on-disk content (vim `:q!`'s contract). */
  discard: () => void
}

class DocSessionImpl implements DocSession {
  readonly path: string
  readonly fileName: string
  refs = 0
  private core: DocSessionCore | null = null
  private loadPromise: Promise<string> | null = null
  /** Last content known to be on disk — the divergence baseline. */
  private diskText: string | null = null
  private divergedDiskText: string | null = null
  private dirty = false
  private checkingDisk = false

  constructor(path: string) {
    this.path = path
    this.fileName = path.split('/').pop() ?? path
  }

  ready(): Promise<string> {
    if (this.core !== null) return Promise.resolve(this.core.text())
    this.loadPromise ??= (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', { path: this.path })
        // another ready() may have raced us past the await — first one wins
        if (this.core === null) {
          const normalized = normalizeEol(content)
          this.core = new DocSessionCore(normalized)
          this.core.onLocalEdit = () => {
            this.markDirty()
            this.scheduleAutosave()
          }
          this.diskText = normalized
        }
        return this.core.text()
      } catch (error) {
        // a failed load must not poison the session for the rest of its
        // life — clear the cache so a later ready() (reopen) retries
        this.loadPromise = null
        throw error
      }
    })()
    return this.loadPromise
  }

  attach(view: EditorView): () => void {
    const core = this.core
    if (core === null) throw new Error(`attach before ready(): ${this.path}`)

    const sessionView: SessionView = {
      getDoc: () => view.state.doc,
      applyRemote: (changes) => {
        view.dispatch({ changes, annotations: REMOTE_ANNOTATIONS })
      },
      isComposing: () => view.composing
    }
    const entry = core.addView(sessionView)
    let detached = false

    view.dispatch({
      effects: StateEffect.appendConfig.of([
        EditorView.updateListener.of((u) => {
          if (detached) return
          if (u.docChanged) {
            for (const tr of u.transactions) {
              if (tr.changes.empty) continue
              if (tr.annotation(remoteSync) === true) continue
              core.applyLocal(entry, tr.changes)
            }
          }
          if (!view.composing) core.flushPending(entry)
        }),
        EditorView.domEventHandlers({
          compositionend: () => {
            // dispatching from inside a DOM handler is legal, but let the
            // composition transaction land first
            queueMicrotask(() => {
              if (!detached) core.flushPending(entry)
            })
            return false
          }
        })
      ])
    })

    setMeta(this.path, { views: core.entries.size })
    return () => {
      if (detached) return
      detached = true
      core.removeView(entry)
      setMeta(this.path, { views: core.entries.size })
    }
  }

  text(): string {
    return this.core?.text() ?? ''
  }

  isDirty(): boolean {
    return this.dirty
  }

  viewCount(): number {
    return this.core?.entries.size ?? 0
  }

  private markDirty(): void {
    if (this.dirty) return
    this.dirty = true
    setMeta(this.path, { dirty: true })
  }

  private autosaveTimer: number | null = null

  /**
   * (Re)arm the idle timer. Every edit pushes it out, so a burst of typing
   * costs one save at the end of it rather than one per keystroke.
   */
  private scheduleAutosave(): void {
    if (!autosaveEnabled()) return
    this.cancelAutosave()
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null
      void this.runAutosave()
    }, AUTOSAVE_IDLE_MS)
  }

  private cancelAutosave(): void {
    if (this.autosaveTimer === null) return
    window.clearTimeout(this.autosaveTimer)
    this.autosaveTimer = null
  }

  /**
   * The conditions are re-checked at fire time, not at schedule time: the
   * setting may have been turned off during the pause, the buffer may
   * already be clean (a ⌘S beat us to it), and — the one that matters — the
   * file may have changed on disk underneath a dirty buffer. Autosaving over
   * an unresolved divergence would silently destroy the other side's edit,
   * so a diverged session waits for the user to answer the banner.
   */
  private async runAutosave(): Promise<boolean> {
    if (!autosaveEnabled()) return false
    if (!this.dirty) return false
    if (this.divergedDiskText !== null) return false
    return this.save({ quiet: true })
  }

  /** Test seam: run the pending autosave now instead of waiting out the idle. */
  flushAutosave(): Promise<boolean> {
    if (this.autosaveTimer === null) return Promise.resolve(false)
    this.cancelAutosave()
    return this.runAutosave()
  }

  private saveChain: Promise<boolean> = Promise.resolve(true)

  /**
   * Serialized per session: two overlapping saves (vim :w in one surface
   * racing ⌘S in the other) could otherwise complete out of order and leave
   * the newest content off disk with the session marked clean.
   */
  save(options: { quiet?: boolean } = {}): Promise<boolean> {
    // An explicit save satisfies whatever the timer was going to do.
    this.cancelAutosave()
    const next = this.saveChain.catch(() => false).then(() => this.doSave(options.quiet === true))
    this.saveChain = next
    return next
  }

  /** `quiet` (an autosave) skips the status note — the tab's dirty dot
   *  clearing is the feedback, and a note per pause would be a ticker.
   *  Failures always speak up. */
  private async doSave(quiet: boolean): Promise<boolean> {
    const core = this.core
    if (core === null) return false
    const savedDoc = core.doc
    const content = core.text()
    try {
      await window.suna.invoke('fs:write-text', { path: this.path, content })
      this.diskText = content
      this.divergedDiskText = null
      // edits that landed during the await keep the session dirty
      if (core.doc === savedDoc) {
        this.dirty = false
        setMeta(this.path, { dirty: false, diverged: false })
      } else {
        setMeta(this.path, { diverged: false })
      }
      devSeam.noteFileSaved(this.path)
      if (!quiet) useUiStore.getState().setStatusNote(`Saved ${this.fileName}`)
      fireDocSaved(this.path, content)
      return true
    } catch (error) {
      useUiStore
        .getState()
        .setStatusNote(
          `Could not save ${this.fileName}: ${error instanceof Error ? error.message : String(error)}`
        )
      return false
    }
  }

  /**
   * Re-read the file after a project-tree change and reconcile. Equal content
   * (including the echo of our own save) is a no-op; a clean session applies
   * the disk text as a minimal mapped change; a dirty session flags
   * divergence and touches nothing.
   */
  async checkDisk(): Promise<void> {
    if (this.core === null || this.checkingDisk) return
    this.checkingDisk = true
    try {
      const { content } = await window.suna.invoke('fs:read-text', { path: this.path })
      const normalized = normalizeEol(content)
      if (this.core === null || normalized === this.diskText) return
      if (this.dirty) {
        this.divergedDiskText = normalized
        setMeta(this.path, { diverged: true })
        return
      }
      this.applyDiskText(normalized)
    } catch {
      // unreadable (deleted mid-edit?) — keep the buffer; a save recreates it
    } finally {
      this.checkingDisk = false
    }
  }

  private applyDiskText(content: string): void {
    const core = this.core
    if (core === null) return
    // The buffer is about to match disk; nothing left for a pending save.
    this.cancelAutosave()
    core.applyExternal(content)
    this.diskText = content
    this.divergedDiskText = null
    this.dirty = false
    setMeta(this.path, { dirty: false, diverged: false })
    fireDocExternallyReloaded(this.path, content)
  }

  /** `:q!`: the forcibly-discarded buffer must not resurrect on reopen —
   * revert to disk content (mapping views through the change) and go clean,
   * so release() can dispose the session. */
  discard(): void {
    if (this.core === null || this.diskText === null) return
    this.applyDiskText(this.diskText)
  }

  resolveDivergence(choice: 'keepMine' | 'reloadDisk'): void {
    const stash = this.divergedDiskText
    if (stash === null) {
      setMeta(this.path, { diverged: false })
      return
    }
    if (choice === 'reloadDisk') {
      this.applyDiskText(stash)
      return
    }
    // keepMine: accept that disk now holds `stash` so the same content never
    // re-flags; the buffer stays dirty and the next ⌘S overwrites it.
    this.diskText = stash
    this.divergedDiskText = null
    setMeta(this.path, { diverged: false })
    // Autosave refuses to run while diverged, so the choice the user just
    // made is what re-arms it — otherwise "keep mine" would sit unsaved
    // until they happened to type again.
    this.scheduleAutosave()
  }

  /** True when nothing holds this session and nothing would be lost. */
  disposable(): boolean {
    return this.refs <= 0 && !this.dirty
  }

  isLoaded(): boolean {
    return this.core !== null
  }
}

const sessions = new Map<string, DocSessionImpl>()

export function acquireDocSession(path: string): { session: DocSession; release: () => void } {
  let session = sessions.get(path)
  if (session === undefined) {
    session = new DocSessionImpl(path)
    sessions.set(path, session)
  } else if (session.isLoaded()) {
    // Reusing a surviving session (e.g. a dirty buffer that outlived its
    // tabs): re-validate against disk NOW, so external edits made while no
    // view was open raise the divergence banner instead of being silently
    // overwritten by the next save.
    void session.checkDisk()
  }
  session.refs += 1
  let released = false
  const target = session
  const release = (): void => {
    if (released) return
    released = true
    target.refs -= 1
    if (target.refs > 0) return
    // A dirty session survives its last view (the other surface may still
    // show the file next time); a clean one is dropped — and a dirty one
    // belonging to a DIFFERENT project than the open one is dropped too
    // (its tabs were closed by the project switch; keeping it would leak
    // stale buffers across projects).
    const root = useProjectStore.getState().rootDir
    const foreign = root === null || !target.path.startsWith(`${root}/`)
    if (target.disposable() || foreign) {
      sessions.delete(path)
      dropMeta(path)
    }
  }
  return { session, release }
}

export function getDocSession(path: string): DocSession | null {
  return sessions.get(path) ?? null
}

/** Buffer truth for consumers without a view (the references block). */
export function peekDocSessionText(path: string): string | null {
  const session = sessions.get(path)
  return session !== undefined && session.isLoaded() ? session.text() : null
}

/* ---- save + external-reload notifications --------------------------------- */

type DocSavedListener = (path: string, text: string) => void
const savedListeners = new Set<DocSavedListener>()

/** Hook for anchor maintenance (state/comments): fires after a successful save. */
export function onDocSaved(listener: DocSavedListener): () => void {
  savedListeners.add(listener)
  return () => savedListeners.delete(listener)
}

function fireDocSaved(path: string, text: string): void {
  for (const listener of savedListeners) listener(path, text)
}

type DocReloadedListener = (path: string, text: string) => void
const reloadedListeners = new Set<DocReloadedListener>()

/** Fires after an external disk change was applied to the live buffer. */
export function onDocExternallyReloaded(listener: DocReloadedListener): () => void {
  reloadedListeners.add(listener)
  return () => reloadedListeners.delete(listener)
}

function fireDocExternallyReloaded(path: string, text: string): void {
  for (const listener of reloadedListeners) listener(path, text)
}

/* ---- module-scope wiring --------------------------------------------------- */

/**
 * Out-of-band changes: an agent's MCP write, git in the terminal, Finder.
 * The tree event is already debounced (150 ms) in main and carries only the
 * project dir (macOS recursive-watch coalescing makes precise paths
 * unreliable, per the channel's own contract) — so each open session under
 * that dir re-reads its file and compares. Guarded like state/project.ts's
 * own subscription; absent in unit tests where window.suna doesn't exist.
 */
if (typeof window !== 'undefined' && typeof window.suna?.onProjectTreeChanged === 'function') {
  // Deferred a microtask: this module sits inside an import cycle
  // (project → comments → docSessions → project), so touching another
  // store's const binding during module EVALUATION hits the TDZ and blanks
  // the whole renderer. After the microtask every module has initialized.
  queueMicrotask(() => {
    window.suna.onProjectTreeChanged(({ dir }) => {
      const prefix = `${dir}/`
      for (const session of sessions.values()) {
        if (session.path.startsWith(prefix)) void session.checkDisk()
      }
    })

    // Project switch: every tab scoped to the old project is closed by
    // closeProjectTabs, so surviving sessions for it are unreachable — drop
    // them rather than leak buffers across projects. Deferred a macrotask:
    // adoptProject sets rootDir BEFORE closing the old tabs, so a
    // synchronous sweep would still see every old view attached and skip
    // everything (release() additionally drops foreign sessions itself,
    // this sweep catches the already-viewless ones).
    useProjectStore.subscribe((s, prev) => {
      if (s.rootDir === prev.rootDir || s.rootDir === null) return
      const keep = `${s.rootDir}/`
      window.setTimeout(() => {
        if (useProjectStore.getState().rootDir !== s.rootDir) return
        for (const [path, session] of [...sessions]) {
          if (!path.startsWith(keep) && session.viewCount() === 0) {
            sessions.delete(path)
            dropMeta(path)
          }
        }
      }, 0)
    })
  })
}
