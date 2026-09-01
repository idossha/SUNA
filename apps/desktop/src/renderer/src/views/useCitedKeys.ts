import { useEffect, useState } from 'react'
import { ManuscriptSchema } from '@suna/core'
import { collectClusters } from '../manuscript/citations'
import { useProjectStore } from '../state/project'

export interface CitedKeys {
  /** Every cite key that appears in a section, in first-appearance order. */
  keys: string[]
  set: ReadonlySet<string>
  loading: boolean
}

/**
 * Cite keys actually used in the manuscript prose. Under the flat layout (ARCHITECTURE §4.3) the
 * prose is ONE flat file (`manuscript.json`'s `manuscriptFile`, default
 * `manuscript.md`) rather than a `body` array of section paths, so this is a
 * single read instead of a walk. Recomputed when a file is saved (project
 * saveBump) so the References view's Cited/Uncited split tracks the prose
 * without a manual refresh.
 */
export function useCitedKeys(): CitedKeys {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const [keys, setKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (rootDir === null) {
      setKeys([])
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const ordered: string[] = []
      const seen = new Set<string>()
      try {
        const { content } = await window.suna.invoke('fs:read-text', {
          path: `${rootDir}/manuscript/manuscript.json`
        })
        const manuscript = ManuscriptSchema.parse(JSON.parse(content))
        try {
          const prose = await window.suna.invoke('fs:read-text', {
            path: `${rootDir}/manuscript/${manuscript.manuscriptFile}`
          })
          for (const cluster of collectClusters(prose.content)) {
            for (const key of cluster.keys) {
              if (seen.has(key)) continue
              seen.add(key)
              ordered.push(key)
            }
          }
        } catch {
          // the prose file may not exist yet; nothing is cited until it does
        }
      } catch {
        // no manuscript.json: nothing is "cited" until there is prose
      }
      if (cancelled) return
      setKeys(ordered)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [rootDir, saveBump])

  return { keys, set: new Set(keys), loading }
}
