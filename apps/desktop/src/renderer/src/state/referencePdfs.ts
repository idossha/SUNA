import { create } from 'zustand'
import type { FsNode } from '@suna/core'
import { parseBibtex, resolvePdfPath, type BibEntry, type PdfResolution } from '@suna/bib'
import { useProjectStore } from './project'

/**
 * citekey -> resolved PDF, project-wide (DECISIONS 2026-08-14). Scanned
 * once per project open and re-scanned on saveBump (a citation could have
 * just gained a `file` field, or a PDF could have just been attached) via the
 * module-level subscription below — self-contained, so the map is populated
 * whether or not the References view has ever been mounted (the editor's
 * right-click "Open reference PDF" needs it too — see editor/citationHit.ts).
 */

/** Every `references/**\/*.pdf` path in the project tree, relative to
 *  `rootDir` (POSIX, matching what resolvePdfPath's `listing` expects).
 *  Exported for unit tests — the rest of this module talks to `window.suna`
 *  and has no jsdom harness to run under. */
export function flattenPdfListing(node: FsNode, rootDirPrefix: string, out: string[]): void {
  if (node.kind === 'file') {
    if (/\.pdf$/i.test(node.name)) {
      out.push(node.path.startsWith(rootDirPrefix) ? node.path.slice(rootDirPrefix.length) : node.path)
    }
    return
  }
  for (const child of node.children) flattenPdfListing(child, rootDirPrefix, out)
}

interface ReferencePdfsState {
  rootDir: string | null
  map: ReadonlyMap<string, PdfResolution | null>
  loaded: boolean
  scan: (rootDir: string) => Promise<void>
}

/** Module-level mirror of the store's map, for callers outside React (the
 *  editor's context-menu contextmenu handler) that can't use the hook below. */
let cache: ReadonlyMap<string, PdfResolution | null> = new Map()

/** The resolved PDF for a citekey, or null when none resolves (or nothing
 *  has been scanned yet). Synchronous — safe to call from a DOM event handler. */
export function getReferencePdf(key: string): PdfResolution | null {
  return cache.get(key) ?? null
}

export const useReferencePdfsStore = create<ReferencePdfsState>((set) => ({
  rootDir: null,
  map: new Map(),
  loaded: false,

  scan: async (rootDir) => {
    const listing: string[] = []
    try {
      const { root } = await window.suna.invoke('fs:list', { dir: `${rootDir}/references` })
      flattenPdfListing(root, `${rootDir}/`, listing)
    } catch {
      // no references/ directory yet — an empty listing is correct, not an error
    }

    let entries: BibEntry[] = []
    try {
      const { content } = await window.suna.invoke('fs:read-text', {
        path: `${rootDir}/manuscript/references.bib`
      })
      entries = parseBibtex(content).entries
    } catch {
      // no references.bib yet — nothing to resolve against
    }

    const map = new Map<string, PdfResolution | null>()
    for (const entry of entries) {
      map.set(entry.key, resolvePdfPath(entry, listing, { projectRoot: rootDir }))
    }
    cache = map
    set({ rootDir, map, loaded: true })
  }
}))

// Re-scan whenever the open project changes or a file is saved (saveBump).
// Deliberately a subscription rather than a hook effect: this map has to be
// ready for the editor's right-click menu even when the References view has
// never been opened, so nothing may depend on that view mounting first.
let lastScanKey: string | null = null
useProjectStore.subscribe((state) => {
  if (state.rootDir === null) {
    if (lastScanKey === null) return
    lastScanKey = null
    cache = new Map()
    useReferencePdfsStore.setState({ rootDir: null, map: new Map(), loaded: false })
    return
  }
  const key = `${state.rootDir}#${state.saveBump}`
  if (key === lastScanKey) return
  lastScanKey = key
  void useReferencePdfsStore.getState().scan(state.rootDir)
})

export interface ReferencePdfs {
  map: ReadonlyMap<string, PdfResolution | null>
  loaded: boolean
  /** Force a re-scan now — for a caller (the References view, after "Attach
   *  PDF…") that needs it sooner than the next saveBump. */
  rescan: () => void
}

/** React hook onto the live citekey -> PDF map kept current by the
 *  module-level subscription above. */
export function useReferencePdfs(): ReferencePdfs {
  const rootDir = useProjectStore((s) => s.rootDir)
  const map = useReferencePdfsStore((s) => s.map)
  const loaded = useReferencePdfsStore((s) => s.loaded)
  return {
    map,
    loaded,
    rescan: () => {
      if (rootDir !== null) void useReferencePdfsStore.getState().scan(rootDir)
    }
  }
}
