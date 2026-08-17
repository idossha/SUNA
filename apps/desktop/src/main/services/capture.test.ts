import { describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { bundleDirName, clampRect, devInfo, sanitizeSlug } from './capture'

/**
 * capture.ts pulls electron in for BrowserWindow/capturePage; only the pure
 * helpers and the trivially-mockable devInfo are under test. The capturePage
 * path stays untested under plain Node for the same reason export-pdf.ts's
 * printToPDF path does (see export-html.test.ts's header comment) — outside
 * Electron's runtime the `electron` package is a binary path, not the API.
 */
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/checkout/apps/desktop' },
  BrowserWindow: { fromWebContents: () => null }
}))

describe('clampRect', () => {
  const content = { width: 1440, height: 900 }

  it('passes a fully inside rect through unchanged', () => {
    expect(clampRect({ x: 100, y: 50, width: 300, height: 200 }, content)).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 200
    })
  })

  it('trims the overhang off the top-left instead of sliding the rect inward', () => {
    expect(clampRect({ x: -10, y: -20, width: 100, height: 100 }, content)).toEqual({
      x: 0,
      y: 0,
      width: 90,
      height: 80
    })
  })

  it('trims to the content edge on the bottom-right', () => {
    expect(clampRect({ x: 1400, y: 860, width: 100, height: 100 }, content)).toEqual({
      x: 1400,
      y: 860,
      width: 40,
      height: 40
    })
  })

  it('collapses a rect fully outside the window to zero size', () => {
    const clamped = clampRect({ x: 2000, y: 50, width: 10, height: 10 }, content)
    expect(clamped.width).toBe(0)
    const below = clampRect({ x: 50, y: 950, width: 10, height: 10 }, content)
    expect(below.height).toBe(0)
  })

  it('rounds fractional getBoundingClientRect values without escaping the bounds', () => {
    const clamped = clampRect({ x: 10.6, y: 5.2, width: 100.8, height: 50.5 }, content)
    expect(clamped).toEqual({ x: 11, y: 5, width: 100, height: 51 })
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(content.width)
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(content.height)
  })

  it('never produces a negative size from a sub-pixel sliver', () => {
    const clamped = clampRect({ x: 1439.6, y: 899.6, width: 0.2, height: 0.2 }, content)
    expect(clamped.width).toBeGreaterThanOrEqual(0)
    expect(clamped.height).toBeGreaterThanOrEqual(0)
  })
})

describe('sanitizeSlug', () => {
  it('lowercases and collapses punctuation/space runs to single dashes', () => {
    expect(sanitizeSlug('Fix: Canvas!!  Overlay')).toBe('fix-canvas-overlay')
  })

  it('strips leading and trailing separators', () => {
    expect(sanitizeSlug('--weird--')).toBe('weird')
  })

  it('never returns an empty name — the stamp alone is not a readable dir', () => {
    expect(sanitizeSlug('')).toBe('report')
    expect(sanitizeSlug('!!!')).toBe('report')
  })

  it('caps at 40 chars without leaving a trailing dash at the cut', () => {
    const long = sanitizeSlug(`${'a'.repeat(39)}-tail`)
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long.endsWith('-')).toBe(false)
  })
})

describe('bundleDirName', () => {
  it('formats <yyyymmdd-hhmmss>-<slug> in local time', () => {
    // Month is 0-based: 7 = August.
    expect(bundleDirName('Canvas overlay', new Date(2026, 7, 17, 14, 30, 5))).toBe(
      '20260817-143005-canvas-overlay'
    )
  })

  it('zero-pads single-digit date and time parts', () => {
    expect(bundleDirName('x', new Date(2026, 0, 3, 4, 5, 6))).toBe('20260103-040506-x')
  })
})

describe('devInfo', () => {
  it('reports the repo checkout two levels above the app path in dev', () => {
    expect(devInfo()).toEqual({ isDev: true, repoRoot: '/checkout' })
  })

  it('reports no repo root when packaged — "Repair this UI" must not exist there', () => {
    const mocked = app as unknown as { isPackaged: boolean }
    mocked.isPackaged = true
    try {
      expect(devInfo()).toEqual({ isDev: false, repoRoot: null })
    } finally {
      mocked.isPackaged = false
    }
  })
})
