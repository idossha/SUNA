import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasDocument } from './document'
import { createBrowserDomAdapter, decodeAttributeWhitespace } from './dom'
import { dispatch } from './commands'

/**
 * Regressions found running under real Chromium (the jsdom suite could not
 * see them): decimal char-ref escapes and xmlns reordering on the root tag.
 */

const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'mpl-two-panel.svg'), 'utf8')

describe('browser serializer fidelity', () => {
  it('decodes Chromium decimal escapes as well as jsdom hex escapes', () => {
    expect(decodeAttributeWhitespace('<p d="M 0 0 &#10;L 1 1 &#9;z&#13;"/>')).toBe(
      '<p d="M 0 0 \nL 1 1 \tz\r"/>'
    )
    expect(decodeAttributeWhitespace('<p d="M 0 0 &#xA;L 1 1 &#x9;z&#xD;"/>')).toBe(
      '<p d="M 0 0 \nL 1 1 \tz\r"/>'
    )
  })

  it('splices the source root start tag while root attrs are untouched', () => {
    const doc = new CanvasDocument(FIXTURE, createBrowserDomAdapter())
    // child edits must not disturb the root start tag bytes
    const result = dispatch(doc, {
      kind: 'translate',
      targets: ['ax0.legend'],
      dx: 4,
      dy: -2
    })
    expect(result.ok).toBe(true)
    const line = doc.serialize().split('\n').find((l) => l.startsWith('<svg'))
    expect(line).toBe(
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="518.740157pt" height="170.07874pt" viewBox="0 0 518.740157 170.07874" xmlns="http://www.w3.org/2000/svg" version="1.1">'
    )
  })

  it('root-attr edits emit the serializer tag, and byte-exact undo restores the original', () => {
    const doc = new CanvasDocument(FIXTURE, createBrowserDomAdapter())
    const result = dispatch(doc, { kind: 'set-artboard', widthMm: 89 })
    expect(result.ok).toBe(true)
    expect(doc.serialize()).not.toBe(FIXTURE)
    if (!result.ok) throw new Error('unreachable')
    const undo = dispatch(doc, result.inverse)
    expect(undo.ok).toBe(true)
    expect(doc.serialize()).toBe(FIXTURE)
  })
})
