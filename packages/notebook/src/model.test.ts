import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NotebookParseError,
  joinLines,
  parseNotebook,
  serializeNotebook,
  splitLines,
  type CodeCell
} from './model'

/**
 * The fixture was written by the reference implementation itself
 * (`nbformat.writes`, nbformat 5) — it is the ground truth these tests
 * measure against, not something this module produced.
 */
const SAMPLE = readFileSync(
  fileURLToPath(new URL('./fixtures/sample.ipynb', import.meta.url)),
  'utf8'
)

describe('splitLines / joinLines', () => {
  it("matches Python's splitlines(True)", () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a')).toEqual(['a'])
    expect(splitLines('a\n')).toEqual(['a\n'])
    expect(splitLines('a\nb')).toEqual(['a\n', 'b'])
    expect(splitLines('a\nb\n')).toEqual(['a\n', 'b\n'])
    expect(splitLines('\n')).toEqual(['\n'])
    expect(splitLines('\n\n')).toEqual(['\n', '\n'])
  })

  it('round-trips any string through split then join', () => {
    for (const text of ['', 'a', 'a\n', '\n\nx\n', 'one\ntwo\nthree']) {
      expect(joinLines(splitLines(text))).toBe(text)
    }
  })
})

describe('parseNotebook', () => {
  it('rejoins line lists into plain strings for the editor', () => {
    const nb = parseNotebook(SAMPLE)
    expect(nb.cells[0]?.source).toBe(
      '# Rotation curve\n\nA note with a *unicode* dash — and an equation $v(r)$.\n'
    )
    const code = nb.cells[1] as CodeCell
    expect(code.source).toBe('import numpy as np\nx = np.linspace(0, 1, 5)\nprint(x)\nx\n')
    expect(code.outputs[0]).toMatchObject({
      output_type: 'stream',
      text: '[0.   0.25 0.5  0.75 1.  ]\n'
    })
  })

  it('leaves application/json output data as JSON, not as lines', () => {
    const nb = parseNotebook(
      JSON.stringify({
        cells: [
          {
            cell_type: 'code',
            source: '',
            metadata: {},
            execution_count: 1,
            outputs: [
              {
                output_type: 'display_data',
                data: { 'application/json': ['a', 'b'], 'text/plain': ['x\n', 'y'] },
                metadata: {}
              }
            ]
          }
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5
      })
    )
    const output = (nb.cells[0] as CodeCell).outputs[0] as { data: Record<string, unknown> }
    expect(output.data['application/json']).toEqual(['a', 'b'])
    expect(output.data['text/plain']).toBe('x\ny')
  })

  it('refuses what is not a notebook, with a reason', () => {
    expect(() => parseNotebook('{oops')).toThrow(NotebookParseError)
    expect(() => parseNotebook('[]')).toThrow(/not an object/)
    expect(() => parseNotebook('{"metadata":{}}')).toThrow(/no "cells" array/)
    expect(() => parseNotebook('{"cells":[],"nbformat":3}')).toThrow(/nbformat 3 is not supported/)
  })

  it('repairs a cell missing the fields the renderer reads', () => {
    const nb = parseNotebook('{"cells":[{"cell_type":"code"}],"nbformat":4,"nbformat_minor":5}')
    const cell = nb.cells[0] as CodeCell
    expect(cell.source).toBe('')
    expect(cell.outputs).toEqual([])
    expect(cell.execution_count).toBeNull()
    expect(cell.metadata).toEqual({})
  })
})

describe('serializeNotebook', () => {
  // The whole reason this module exists: a notebook opened and saved
  // untouched must leave an EMPTY git diff.
  it('reproduces nbformat.writes byte for byte', () => {
    expect(serializeNotebook(parseNotebook(SAMPLE))).toBe(SAMPLE)
  })

  it('keeps metadata from tools that are none of SUNA business', () => {
    const out = serializeNotebook(parseNotebook(SAMPLE))
    expect(out).toContain('"unknown_tool_key"')
    expect(JSON.parse(out).metadata.suna.unknown_tool_key).toEqual([1, 2, 3])
  })

  it('keeps error tracebacks, ANSI escapes included', () => {
    const nb = parseNotebook(SAMPLE)
    const output = (nb.cells[3] as CodeCell).outputs[0] as { traceback: string[] }
    expect(output.traceback[0]).toContain('[31m')
    expect(serializeNotebook(nb)).toBe(SAMPLE)
  })

  // Ground truth, checked against nbformat's own _split_mimebundle: only
  // text/* plus image/svg+xml and application/javascript become line lists.
  // A base64 image/png stays one string.
  it('leaves a base64 image as one string and splits an SVG into lines', () => {
    const nb = parseNotebook(SAMPLE)
    const written = JSON.parse(serializeNotebook(nb))
    expect(written.cells[2].outputs[0].data['image/png']).toBe('iVBORw0KGgoAAAANSUhEUg==\n')
    expect(written.cells[2].outputs[0].data['text/plain']).toEqual(['<Figure size 640x480>'])
  })

  it('round-trips a markdown cell attachment', () => {
    const source = JSON.stringify({
      cells: [
        {
          cell_type: 'markdown',
          source: '![x](attachment:x.png)',
          metadata: {},
          attachments: { 'x.png': { 'image/png': 'AAAA' } }
        }
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5
    })
    const written = JSON.parse(serializeNotebook(parseNotebook(source)))
    expect(written.cells[0].attachments['x.png']['image/png']).toBe('AAAA')
  })

  it('does not mutate the notebook it is given', () => {
    const nb = parseNotebook(SAMPLE)
    serializeNotebook(nb)
    expect(typeof nb.cells[0]?.source).toBe('string')
  })

  it('writes edited source back in the line-list form nbformat uses', () => {
    const nb = parseNotebook(SAMPLE)
    ;(nb.cells[1] as CodeCell).source = 'a = 1\nb = 2\n'
    expect(JSON.parse(serializeNotebook(nb)).cells[1].source).toEqual(['a = 1\n', 'b = 2\n'])
  })
})
