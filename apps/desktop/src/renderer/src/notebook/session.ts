import { create } from 'zustand'
import {
  parseNotebook,
  serializeNotebook,
  type Cell,
  type CodeCell,
  type Notebook,
  type Output
} from '@suna/notebook'
import { selectedEnvPathFor } from '../state/envs'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'

/**
 * One open notebook: the parsed document, its kernel, and what is running.
 *
 * Sessions live at MODULE scope, the same flux pattern the terminal uses, for
 * the same reason — a kernel holds state a researcher spent minutes building
 * (a loaded catalogue, a fitted model), and closing a dock tab or switching
 * groups must not silently throw that away. React sees only the version
 * counter below; the notebook itself is MUTATED in place, because output
 * objects arriving from the kernel are exactly the objects that get written
 * back to the .ipynb, and copying them around is how they get mangled.
 */

export type KernelStatus = 'off' | 'starting' | 'idle' | 'busy' | 'dead'

export interface KernelFault {
  code: string
  message: string
}

export interface NotebookMeta {
  loading: boolean
  loadError: string | null
  dirty: boolean
  kernelStatus: KernelStatus
  /** Display name from the kernelspec, e.g. "Python 3 (ipykernel)". */
  kernelName: string | null
  kernelError: KernelFault | null
  /** Cell keys currently executing or queued, in submission order. */
  running: string[]
  /** Bumped on every in-place mutation so React re-renders. */
  version: number
}

const EMPTY_META: NotebookMeta = {
  loading: true,
  loadError: null,
  dirty: false,
  kernelStatus: 'off',
  kernelName: null,
  kernelError: null,
  running: [],
  version: 0
}

interface MetaState {
  byPath: Record<string, NotebookMeta>
}

const useMetaStore = create<MetaState>(() => ({ byPath: {} }))

export function useNotebookMeta(path: string): NotebookMeta {
  return useMetaStore((s) => s.byPath[path] ?? EMPTY_META)
}

function patch(path: string, changes: Partial<NotebookMeta>): void {
  useMetaStore.setState((s) => ({
    byPath: { ...s.byPath, [path]: { ...(s.byPath[path] ?? EMPTY_META), ...changes } }
  }))
}

function bump(path: string, changes: Partial<NotebookMeta> = {}): void {
  const current = useMetaStore.getState().byPath[path] ?? EMPTY_META
  patch(path, { ...changes, version: current.version + 1 })
}

/**
 * React keys for cells. nbformat 4.5 gives cells an `id`, but older files do
 * not, and MINTING one would rewrite a file the author only opened — so
 * identity is tracked out-of-band here instead of in the document.
 */
const cellKeys = new WeakMap<object, string>()
let keySeq = 0

export function cellKey(cell: Cell): string {
  const existing = cellKeys.get(cell)
  if (existing !== undefined) return existing
  const id = typeof cell.id === 'string' && cell.id !== '' ? `id:${cell.id}` : `k${++keySeq}`
  cellKeys.set(cell, id)
  return id
}

interface KernelEvent {
  type: string
  reqId?: string
  output?: Output
  executionCount?: number | null
  state?: string
  status?: string
  code?: string
  message?: string
  kernel?: { displayName?: string }
  wait?: boolean
}

class Session {
  readonly path: string
  nb: Notebook | null = null
  refs = 0
  private kernelId: string | null = null
  private starting: Promise<boolean> | null = null
  private unsubscribe: (() => void) | null = null
  /** reqId → the cell that asked for it. */
  private inflight = new Map<string, CodeCell>()
  private reqSeq = 0

  constructor(path: string) {
    this.path = path
  }

  async load(): Promise<void> {
    patch(this.path, { loading: true, loadError: null })
    try {
      const file = await window.suna.invoke('fs:read-text', { path: this.path })
      this.nb = parseNotebook(file.content)
      bump(this.path, { loading: false, loadError: null, dirty: false })
    } catch (error) {
      patch(this.path, {
        loading: false,
        loadError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async save(): Promise<boolean> {
    if (this.nb === null) return false
    try {
      await window.suna.invoke('fs:write-text', {
        path: this.path,
        content: serializeNotebook(this.nb)
      })
      patch(this.path, { dirty: false })
      return true
    } catch (error) {
      useUiStore
        .getState()
        .pushToast(`Could not save notebook: ${error instanceof Error ? error.message : error}`)
      return false
    }
  }

  markDirty(): void {
    bump(this.path, { dirty: true })
  }

  /** The kernelspec this notebook asks for, or python3 when it says nothing. */
  private kernelName(): string {
    const spec = this.nb?.metadata['kernelspec']
    if (typeof spec === 'object' && spec !== null && 'name' in spec) {
      const name = (spec as { name: unknown }).name
      if (typeof name === 'string' && name !== '') return name
    }
    return 'python3'
  }

  /** Start the kernel if it is not up. Concurrent callers share one start. */
  async ensureKernel(): Promise<boolean> {
    if (this.kernelId !== null) return true
    if (this.starting !== null) return this.starting
    this.starting = this.startKernel().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async startKernel(): Promise<boolean> {
    const rootDir = useProjectStore.getState().rootDir
    const cwd = this.path.slice(0, this.path.lastIndexOf('/'))
    patch(this.path, { kernelStatus: 'starting', kernelError: null })
    try {
      const { id } = await window.suna.invoke('kernel:start', {
        cwd: cwd === '' ? (rootDir ?? '~') : cwd,
        envPath: rootDir === null ? null : selectedEnvPathFor(rootDir),
        kernelName: this.kernelName()
      })
      this.kernelId = id
      this.unsubscribe = window.suna.onKernelEvent(id, (event) =>
        this.onKernelEvent(event as KernelEvent)
      )
      return true
    } catch (error) {
      patch(this.path, {
        kernelStatus: 'dead',
        kernelError: {
          code: 'start-failed',
          message: error instanceof Error ? error.message : String(error)
        }
      })
      return false
    }
  }

  private onKernelEvent(event: KernelEvent): void {
    switch (event.type) {
      case 'ready':
        patch(this.path, {
          kernelStatus: 'idle',
          kernelName: event.kernel?.displayName ?? null,
          kernelError: null
        })
        return
      case 'status':
        // 'starting' from the kernel is a restart; keep the tab honest.
        patch(this.path, {
          kernelStatus:
            event.state === 'busy' ? 'busy' : event.state === 'starting' ? 'starting' : 'idle'
        })
        return
      case 'fatal':
        patch(this.path, {
          kernelStatus: 'dead',
          kernelError: { code: event.code ?? 'fatal', message: event.message ?? 'Kernel failed' }
        })
        return
      case 'exit':
        this.kernelId = null
        this.inflight.clear()
        patch(this.path, { kernelStatus: 'dead', running: [] })
        return
      default:
        break
    }

    const cell = event.reqId === undefined ? undefined : this.inflight.get(event.reqId)
    if (cell === undefined) return

    if (event.type === 'input') {
      cell.execution_count = event.executionCount ?? null
      bump(this.path, { dirty: true })
    } else if (event.type === 'output' && event.output !== undefined) {
      cell.outputs.push(event.output)
      bump(this.path, { dirty: true })
    } else if (event.type === 'clear') {
      cell.outputs.length = 0
      bump(this.path, { dirty: true })
    } else if (event.type === 'reply') {
      this.inflight.delete(event.reqId as string)
      const key = cellKey(cell)
      const meta = useMetaStore.getState().byPath[this.path] ?? EMPTY_META
      bump(this.path, { running: meta.running.filter((k) => k !== key), dirty: true })
    }
  }

  async runCell(cell: CodeCell): Promise<void> {
    if (!(await this.ensureKernel())) return
    if (this.kernelId === null) return
    const key = cellKey(cell)
    const meta = useMetaStore.getState().byPath[this.path] ?? EMPTY_META
    // A cell already in flight is not queued twice: two runs would push
    // their outputs into the same array and the cell would show both.
    if (meta.running.includes(key)) return
    cell.outputs.length = 0
    cell.execution_count = null
    const reqId = `r${++this.reqSeq}`
    this.inflight.set(reqId, cell)
    bump(this.path, { running: [...meta.running, key] })
    await window.suna.invoke('kernel:execute', {
      id: this.kernelId,
      reqId,
      code: typeof cell.source === 'string' ? cell.source : cell.source.join('')
    })
  }

  /**
   * Run every code cell top to bottom. The kernel executes its queue in
   * order, so this submits them all and lets it sequence them — which is
   * also what makes an interrupt cancel the REST of the run.
   */
  async runAll(): Promise<void> {
    if (this.nb === null) return
    if (!(await this.ensureKernel())) return
    for (const cell of this.nb.cells) {
      if (cell.cell_type === 'code') await this.runCell(cell as CodeCell)
    }
  }

  async interrupt(): Promise<void> {
    if (this.kernelId !== null) await window.suna.invoke('kernel:interrupt', { id: this.kernelId })
  }

  async restart(): Promise<void> {
    if (this.kernelId === null) return
    this.inflight.clear()
    patch(this.path, { running: [], kernelStatus: 'starting' })
    await window.suna.invoke('kernel:restart', { id: this.kernelId })
  }

  /** Shut the kernel down but keep the parsed document and its outputs. */
  async shutdown(): Promise<void> {
    const id = this.kernelId
    this.kernelId = null
    this.inflight.clear()
    this.unsubscribe?.()
    this.unsubscribe = null
    patch(this.path, { kernelStatus: 'off', kernelName: null, running: [] })
    if (id !== null) await window.suna.invoke('kernel:shutdown', { id })
  }
}

const sessions = new Map<string, Session>()

/**
 * The session for a path, created and loaded on first use. Callers release
 * their reference on unmount; the session and its kernel survive that,
 * because a tab closing is not a reason to lose a loaded dataset.
 */
export function acquireNotebook(path: string): { session: Session; release: () => void } {
  let session = sessions.get(path)
  if (session === undefined) {
    session = new Session(path)
    sessions.set(path, session)
    void session.load()
  }
  session.refs += 1
  const owner = session
  return {
    session: owner,
    release: () => {
      owner.refs -= 1
    }
  }
}

export function getNotebookSession(path: string): Session | null {
  return sessions.get(path) ?? null
}

export type { Session as NotebookSession }
