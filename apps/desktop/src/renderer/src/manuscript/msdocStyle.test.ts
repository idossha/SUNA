import { describe, expect, it } from 'vitest'
import { editorSurfaceStyle } from '../editor/settings'
import { manuscriptStyleVars } from './msdocStyle'

describe('manuscriptStyleVars', () => {
  it('publishes every --ed-* custom property the section editors and title page read', () => {
    const style = manuscriptStyleVars({
      contentWidthCh: 92,
      fontSizePx: 19,
      fontFamily: 'mono',
      lineHeight: 1.5,
      editorTheme: 'suna-light'
    }) as Record<string, string>
    expect(style['--ed-content-width']).toBe('92ch')
    expect(style['--ed-font-size']).toBe('19px')
    expect(style['--ed-line-height']).toBe('1.5')
    expect(style['--ed-body-font']).toBeTruthy()
  })

  it('matches editorSurfaceStyle byte-for-byte for the same settings — the "one measure" guarantee', () => {
    const settings = {
      contentWidthCh: 110,
      fontSizePx: 14,
      fontFamily: 'sans' as const,
      lineHeight: 1.9,
      editorTheme: 'high-contrast' as const
    }
    // Regression guard: if a future edit rebuilds this object by hand again
    // instead of delegating, this test catches the drift before the title
    // page and the section editors render at two different widths again.
    expect(manuscriptStyleVars(settings)).toEqual(editorSurfaceStyle(settings))
  })

  it('tracks the content-width setting across its whole range', () => {
    for (const width of [50, 68, 150]) {
      const style = manuscriptStyleVars({
        contentWidthCh: width,
        fontSizePx: 16,
        fontFamily: 'serif',
        lineHeight: 1.7,
        editorTheme: 'suna-dark'
      }) as Record<string, string>
      expect(style['--ed-content-width']).toBe(`${width}ch`)
    }
  })

  it('exposes exactly the four vars .msdoc__page and the section editors consume', () => {
    const style = manuscriptStyleVars({
      contentWidthCh: 68,
      fontSizePx: 16,
      fontFamily: 'serif',
      lineHeight: 1.7,
      editorTheme: 'suna-dark'
    }) as Record<string, string>
    expect(Object.keys(style).sort()).toEqual(
      ['--ed-body-font', '--ed-content-width', '--ed-font-size', '--ed-line-height'].sort()
    )
  })
})
