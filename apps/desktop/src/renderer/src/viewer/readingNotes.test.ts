import { describe, expect, it } from 'vitest'
import {
  NOTES_EXPORT_BASENAME,
  describeIpcFailure,
  notesAsMarkdown,
  notesExportRequest,
  notesExportSubtitle
} from './ReadingNotesTab'

/**
 * The pure halves of the cross-paper reading notes tab (ADR-008).
 */

describe('describeIpcFailure', () => {
  it('names the real fix for a channel the main process does not know', () => {
    // Electron's main process does not hot-swap, so this is a stale process
    // rather than a bug — and the raw message says nothing about restarting.
    const text = describeIpcFailure(
      new Error("Error invoking remote method 'refnotes:list-all': No handler registered")
    )
    expect(text).toContain('restart')
    expect(text).not.toContain('No handler registered')
  })

  it('passes any other failure through, rather than guessing', () => {
    expect(describeIpcFailure(new Error('EACCES: permission denied'))).toContain(
      'EACCES: permission denied'
    )
  })

  it('survives a thrown value that is not an Error', () => {
    expect(describeIpcFailure('something odd')).toContain('something odd')
  })
})

describe('notesAsMarkdown', () => {
  const group = {
    citekey: 'gunn1972',
    entry: undefined,
    pageLabelOffset: 0,
    notes: [
      {
        id: 'n1',
        color: 'green' as const,
        runs: [{ page: 3, quote: 'Ram pressure strips the gas.', prefix: '', suffix: '', detached: false }],
        body: 'Cite in the intro.',
        tags: [],
        author: { kind: 'human' as const, name: 'You' },
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
        ambiguous: false,
        embed: []
      }
    ]
  }

  it('writes a literature note that cites every passage', () => {
    const md = notesAsMarkdown([group])
    expect(md).toContain('# Reading notes')
    expect(md).toContain('[@gunn1972]')
    expect(md).toContain('Ram pressure strips the gas [@gunn1972, p. 3].')
    expect(md).toContain('Cite in the intro.')
  })

  it('is empty-safe', () => {
    expect(notesAsMarkdown([])).toBe('# Reading notes\n')
  })

  it('applies the paper printed-page correction, like every other surface', () => {
    // A note used to cite three different pages depending on where you asked,
    // and the one pasted into a manuscript was the wrong one.
    const md = notesAsMarkdown([{ ...group, pageLabelOffset: 107 }])
    expect(md).toContain('p. 110')
    expect(md).not.toContain('p. 3]')
  })
})

describe('notesExportRequest', () => {
  const group = {
    citekey: 'gunn1972',
    entry: undefined,
    // A preprint whose printed pages run two behind the sheet numbers. The
    // offset lives here because this is the only side that knows it — the
    // export must carry the corrected label, not the raw sheet.
    pageLabelOffset: -2,
    notes: [
      {
        id: 'n1',
        color: 'green' as const,
        runs: [
          { page: 5, quote: 'Ram pressure strips the gas.', prefix: '', suffix: '', detached: false }
        ],
        body: '  Cite in the intro.  ',
        tags: ['mechanism'],
        author: { kind: 'human' as const, name: 'You' },
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
        ambiguous: false,
        embed: []
      }
    ]
  }

  it('sends the page label the panel shows, already corrected', () => {
    const req = notesExportRequest([group], {
      dir: '/work/my-paper',
      format: 'pdf',
      subtitle: 'x'
    })
    expect(req.papers[0]?.notes[0]?.page).toBe('3')
  })

  it('carries colour, tags and the trimmed written note', () => {
    const note = notesExportRequest([group], {
      dir: '/work/my-paper',
      format: 'docx',
      subtitle: 'x'
    }).papers[0]?.notes[0]
    expect(note?.color).toBe('green')
    expect(note?.tags).toEqual(['mechanism'])
    expect(note?.body).toBe('Cite in the intro.')
    expect(note?.detached).toBe(false)
  })

  it('always writes the same file, so the export does not accumulate copies', () => {
    for (const format of ['pdf', 'docx', 'html'] as const) {
      const req = notesExportRequest([group], { dir: '/d', format, subtitle: '' })
      expect(req.outputName).toBe(NOTES_EXPORT_BASENAME)
      expect(req.format).toBe(format)
    }
  })

  it('falls back to the citekey when no bib entry backs the paper', () => {
    const req = notesExportRequest([group], { dir: '/d', format: 'html', subtitle: '' })
    expect(req.papers[0]?.label).toBe('gunn1972')
    expect(req.papers[0]?.title).toBe('')
  })

  it('is empty-safe', () => {
    expect(notesExportRequest([], { dir: '/d', format: 'pdf', subtitle: '' }).papers).toEqual([])
  })
})

describe('notesExportSubtitle', () => {
  it('counts what was exported', () => {
    expect(
      notesExportSubtitle({ notes: 1, papers: 1, filtered: false, exportedOn: '2026-08-19' })
    ).toBe('1 note · 1 paper · exported 2026-08-19')
    expect(
      notesExportSubtitle({ notes: 4, papers: 2, filtered: false, exportedOn: '2026-08-19' })
    ).toContain('4 notes · 2 papers')
  })

  it('admits when the document is only part of the reading', () => {
    // A filtered export that read as complete would be worse than no export:
    // the missing highlights are invisible in the file itself.
    const text = notesExportSubtitle({ notes: 2, papers: 1, filtered: true, exportedOn: '2026-08-19' })
    expect(text).toContain('filtered')
  })
})
