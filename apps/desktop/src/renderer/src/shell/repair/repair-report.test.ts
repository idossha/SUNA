import { describe, expect, it } from 'vitest'
import {
  DOM_PATH_MAX,
  entryLabel,
  formatDomPath,
  SLUG_MAX,
  slugForReport
} from './repair-report'

describe('entryLabel', () => {
  it('joins tag and classes CSS-style', () => {
    expect(entryLabel({ tag: 'button', classes: ['cmt__btn', 'cmt__btn--ai'] })).toBe(
      'button.cmt__btn.cmt__btn--ai'
    )
  })

  it('is just the tag when the element has no classes', () => {
    expect(entryLabel({ tag: 'footer', classes: [] })).toBe('footer')
  })
})

describe('formatDomPath', () => {
  it('renders root-most first from target-first input', () => {
    const entries = [
      { tag: 'button', classes: ['statusbar__btn'] },
      { tag: 'div', classes: ['statusbar__group'] },
      { tag: 'footer', classes: ['statusbar'] }
    ]
    expect(formatDomPath(entries)).toBe(
      'footer.statusbar > div.statusbar__group > button.statusbar__btn'
    )
  })

  it('caps at DOM_PATH_MAX entries, dropping far ancestors and never the target', () => {
    const entries = Array.from({ length: DOM_PATH_MAX + 3 }, (_, i) => ({
      tag: 'div',
      classes: [`level-${i}`]
    }))
    const path = formatDomPath(entries)
    expect(path.split(' > ')).toHaveLength(DOM_PATH_MAX)
    // entries are target-first, so level-0 is the picked element
    expect(path.endsWith('div.level-0')).toBe(true)
    expect(path).not.toContain(`level-${DOM_PATH_MAX}`)
  })

  it('is empty for an empty path', () => {
    expect(formatDomPath([])).toBe('')
  })
})

describe('slugForReport', () => {
  it('lowercases and joins alphanumeric runs with dashes', () => {
    expect(slugForReport('The Export button is CUT OFF')).toBe('the-export-button-is-cut-off')
  })

  it('collapses symbol runs and trims edge dashes', () => {
    expect(slugForReport('  ⌘K → palette?? (broken!)  ')).toBe('k-palette-broken')
  })

  it('clips to SLUG_MAX without a trailing dash', () => {
    const slug = slugForReport('word '.repeat(30))
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX)
    expect(slug.endsWith('-')).toBe(false)
  })

  it("falls back to 'ui-repair' when nothing survives — the IPC schema needs a non-empty slug", () => {
    expect(slugForReport('')).toBe('ui-repair')
    expect(slugForReport('→ ✦ ⌘ !!!')).toBe('ui-repair')
  })
})
