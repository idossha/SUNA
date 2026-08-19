import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RequestOf } from '@suna/core'
import { buildNotesHtml, escapeHtml, exportNotes } from './export-notes'
import { allowRoot } from './roots'

/**
 * The notes exporter's pure half. A test run must never open a BrowserWindow
 * or print a PDF, so electron is mocked to nothing and only the document
 * builder is exercised — which is where every layout decision actually lives
 * (the PDF is this HTML, printed).
 */
vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: () => '/tmp' }
}))

function request(overrides: Partial<RequestOf<'export:notes'>> = {}): RequestOf<'export:notes'> {
  return {
    dir: '/work/my-paper',
    format: 'html',
    outputName: 'reading-notes',
    title: 'Reading notes',
    subtitle: '1 note · 1 paper · exported 2026-08-19',
    papers: [
      {
        citekey: 'gunn1972',
        label: 'Gunn & Gott (1972)',
        title: 'On the Infall of Matter into Clusters of Galaxies',
        notes: [
          {
            page: '3',
            quote: 'Ram pressure strips the gas.',
            body: 'Cite in the intro.',
            color: 'green',
            tags: ['mechanism'],
            detached: false
          }
        ]
      }
    ],
    ...overrides
  }
}

describe('escapeHtml', () => {
  it('neutralises markup a quote can legitimately contain', () => {
    // A highlight is copied out of someone else's PDF: "<5 M_sun" and
    // "R&D" are ordinary physics prose, not an attempt at anything.
    expect(escapeHtml('<5 M & "R"')).toBe('&lt;5 M &amp; &quot;R&quot;')
  })
})

describe('buildNotesHtml', () => {
  it('writes one self-contained page — no external request of any kind', () => {
    const html = buildNotesHtml(request())
    expect(html).toContain('<!doctype html>')
    expect(html).not.toMatch(/<link\b/)
    expect(html).not.toMatch(/<script\b/)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('carries the paper, the citekey, the page and both halves of a note', () => {
    const html = buildNotesHtml(request())
    expect(html).toContain('Gunn &amp; Gott (1972)')
    expect(html).toContain('[@gunn1972]')
    expect(html).toContain('On the Infall of Matter into Clusters of Galaxies')
    expect(html).toContain('p. 3')
    expect(html).toContain('Ram pressure strips the gas.')
    expect(html).toContain('Cite in the intro.')
    expect(html).toContain('mechanism')
  })

  it('prints the page label it was given, never a recomputed one', () => {
    // The printed-page offset is applied in the renderer, where the paper's
    // own correction is known. A label like 'S4' or '12 (sheet 14)' must
    // survive verbatim.
    const html = buildNotesHtml(
      request({
        papers: [
          {
            citekey: 'k',
            label: 'Someone (2020)',
            title: '',
            notes: [
              { page: '12 (sheet 14)', quote: 'q', body: '', color: 'yellow', tags: [], detached: false }
            ]
          }
        ]
      })
    )
    expect(html).toContain('p. 12 (sheet 14)')
  })

  it('colours the quote rule with the highlight colour it was made in', () => {
    const html = buildNotesHtml(request())
    expect(html).toContain('#5fb236') // green
  })

  it('marks a detached note, because its quote no longer sits anywhere', () => {
    const req = request()
    const paper = req.papers[0]
    if (paper === undefined) throw new Error('fixture')
    const note = paper.notes[0]
    if (note === undefined) throw new Error('fixture')
    expect(buildNotesHtml(request())).not.toContain('>detached<')
    const html = buildNotesHtml({
      ...req,
      papers: [{ ...paper, notes: [{ ...note, detached: true }] }]
    })
    expect(html).toContain('>detached<')
  })

  it('splits a written note on blank lines and drops an empty one', () => {
    const req = request()
    const paper = req.papers[0]
    if (paper === undefined) throw new Error('fixture')
    const note = paper.notes[0]
    if (note === undefined) throw new Error('fixture')
    const html = buildNotesHtml({
      ...req,
      papers: [{ ...paper, notes: [{ ...note, body: 'First.\n\n\nSecond.' }] }]
    })
    expect(html.match(/class="nx-body"/g)).toHaveLength(2)

    const bare = buildNotesHtml({
      ...req,
      papers: [{ ...paper, notes: [{ ...note, body: '   ' }] }]
    })
    expect(bare).not.toContain('class="nx-body"')
  })

  it('says so rather than printing a blank page when nothing is selected', () => {
    const html = buildNotesHtml(request({ papers: [] }))
    expect(html).toContain('No reading notes.')
  })

  it('falls back to the citekey when the bibliography has no entry', () => {
    const html = buildNotesHtml(
      request({ papers: [{ citekey: 'unknown2024', label: '', title: '', notes: [] }] })
    )
    expect(html).toContain('unknown2024')
  })
})

describe('exportNotes', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'suna-notes-'))
    allowRoot(root)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes into output/notes/, not among the manuscript exports', async () => {
    // A literature note is not a draft of the paper. Three files called
    // reading-notes.* sitting beside manuscript.pdf read as versions of the
    // manuscript, which is exactly the confusion the subfolder prevents.
    const { path } = await exportNotes({ ...request(), dir: root, format: 'html' })
    expect(path).toBe(join(root, 'output', 'notes', 'reading-notes.html'))
    expect(await readFile(path, 'utf8')).toContain('Ram pressure strips the gas.')
  })

  it('creates the folder rather than failing on a project that has never exported', async () => {
    // mkdtemp gives a bare directory: no output/, no output/notes/.
    await expect(exportNotes({ ...request(), dir: root, format: 'html' })).resolves.toBeTruthy()
  })

  it('refuses a directory outside every allowed root', async () => {
    await expect(
      exportNotes({ ...request(), dir: join(tmpdir(), 'suna-not-a-project'), format: 'html' })
    ).rejects.toThrow()
  })
})
