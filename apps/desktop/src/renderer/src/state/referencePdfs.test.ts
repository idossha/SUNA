import { describe, expect, it } from 'vitest'
import type { FsNode } from '@suna/core'
import { flattenPdfListing } from './referencePdfs'

function file(name: string, path: string): FsNode {
  return { kind: 'file', name, path }
}

function dir(name: string, path: string, children: FsNode[]): FsNode {
  return { kind: 'dir', name, path, children }
}

describe('flattenPdfListing', () => {
  it('collects PDFs at the top of the scanned directory, relative to the project root', () => {
    const tree = dir('references', '/proj/references', [
      file('gunn1972.pdf', '/proj/references/gunn1972.pdf'),
      file('notes.txt', '/proj/references/notes.txt')
    ])
    const out: string[] = []
    flattenPdfListing(tree, '/proj/', out)
    expect(out).toEqual(['references/gunn1972.pdf'])
  })

  it('recurses into subdirectories', () => {
    const tree = dir('references', '/proj/references', [
      file('gunn1972.pdf', '/proj/references/gunn1972.pdf'),
      dir('extra', '/proj/references/extra', [file('Jachym_2019_Norma.pdf', '/proj/references/extra/Jachym_2019_Norma.pdf')])
    ])
    const out: string[] = []
    flattenPdfListing(tree, '/proj/', out)
    expect(out).toEqual(['references/gunn1972.pdf', 'references/extra/Jachym_2019_Norma.pdf'])
  })

  it('matches .pdf case-insensitively and ignores non-PDF files', () => {
    const tree = dir('references', '/proj/references', [
      file('REPORT.PDF', '/proj/references/REPORT.PDF'),
      file('figure.png', '/proj/references/figure.png')
    ])
    const out: string[] = []
    flattenPdfListing(tree, '/proj/', out)
    expect(out).toEqual(['references/REPORT.PDF'])
  })

  it('falls back to the raw path when it does not start with the given prefix', () => {
    const tree = file('outside.pdf', '/elsewhere/outside.pdf')
    const out: string[] = []
    flattenPdfListing(tree, '/proj/', out)
    expect(out).toEqual(['/elsewhere/outside.pdf'])
  })

  it('produces nothing for an empty directory', () => {
    const out: string[] = []
    flattenPdfListing(dir('references', '/proj/references', []), '/proj/', out)
    expect(out).toEqual([])
  })
})
