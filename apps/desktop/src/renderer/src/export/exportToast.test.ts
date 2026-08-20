import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../state/ui'
import {
  EXPORT_TOAST_TTL_MS,
  exportToastMessage,
  exportedBaseName,
  notifyExported
} from './exportToast'

/**
 * Like os-actions.test.ts, this stops at the IPC boundary: a real
 * 'shell:reveal' would pop a Finder window onto the developer's screen.
 */
const calls: { channel: string; request: unknown }[] = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('window', {
    suna: {
      platform: 'darwin',
      invoke: (channel: string, request: unknown) => {
        calls.push({ channel, request })
        return Promise.resolve({ error: null })
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useUiStore.setState({ toasts: [] })
})

describe('exportToast', () => {
  it('names the file, not the path', () => {
    expect(exportedBaseName('/p/output/manuscript.docx')).toBe('manuscript.docx')
    expect(exportedBaseName('C:\\p\\output\\manuscript.docx')).toBe('manuscript.docx')
  })

  it('appends the detail only when there is one', () => {
    expect(exportToastMessage('/p/a.pdf')).toBe('Exported a.pdf')
    expect(exportToastMessage('/p/a.pdf', '  ')).toBe('Exported a.pdf')
    expect(exportToastMessage('/p/a.pdf', '1.2 MB')).toBe('Exported a.pdf — 1.2 MB')
  })

  it('pushes one toast offering Open and the platform reveal wording', () => {
    const id = notifyExported('/p/output/letter.pdf')
    const toast = useUiStore.getState().toasts.find((t) => t.id === id)
    expect(toast?.ttlMs).toBe(EXPORT_TOAST_TTL_MS)
    expect(toast?.actions?.map((a) => a.label)).toEqual(['Open', 'Reveal in Finder'])

    toast?.actions?.[0]?.run()
    toast?.actions?.[1]?.run()
    expect(calls).toEqual([
      { channel: 'shell:open-path', request: { path: '/p/output/letter.pdf' } },
      { channel: 'shell:reveal', request: { path: '/p/output/letter.pdf' } }
    ])
  })
})
