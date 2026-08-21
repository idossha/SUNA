import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import { AuthorsFileSchema, ManuscriptSchema, SunaProjectManifestSchema, type DocxAnalysis } from '@suna/core'
import { parseBibtex, serializeBibtex } from '@suna/bib'
import {
  analyzeDocx,
  buildManuscriptMarkdown,
  commitDocxAnalysis,
  deriveCorrespondence,
  extensionForContentType,
  isCorrespondenceEntry,
  toBibAuthor
} from './docx-import'

/**
 * Node-runnable fixture check (spec §2, "add a Node-runnable fixture check
 * that analyzes a SMALL .docx you build with the 'docx' library in the test
 * itself" — no binary committed to the repo). Exercises the full
 * analyze → review-edit → commit pipeline against a real, small .docx built
 * in-process, including the bold-paragraph title ground truth from spec §0.
 */

const cleanupPaths: string[] = []

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop()
    if (path !== undefined) await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

async function buildFixtureDocx(): Promise<string> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: 'SUNA Test Manuscript Title', bold: true })] }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Ada Researcher' }),
              new TextRun({ text: '1', superScript: true }),
              new TextRun({ text: ', Ben Collaborator' }),
              new TextRun({ text: '2', superScript: true })
            ]
          }),
          new Paragraph({ children: [new TextRun({ text: '1Department of Testing, Test University' })] }),
          new Paragraph({ children: [new TextRun({ text: '2Institute of Fixtures, Fixture University' })] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Abstract' })] }),
          new Paragraph({ children: [new TextRun({ text: 'This fixture manuscript exists to test DOCX import.' })] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Introduction' })] }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Earlier work ' }),
              new TextRun({ text: '[1]' }),
              new TextRun({ text: ' established the baseline.' })
            ]
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Results' })] }),
          new Paragraph({
            children: [
              new TextRun({ text: 'An unrelated claim ' }),
              new TextRun({ text: '[3]' }),
              new TextRun({ text: ' cites nothing in our list.' })
            ]
          }),
          new Paragraph({
            children: [new ImageRun({ data: TINY_PNG, transformation: { width: 40, height: 40 }, type: 'png' })]
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'References' })] }),
          new Paragraph({ children: [new TextRun({ text: '1. Smith, J. (2020). A title about testing. J. Test, 1, 1-2.' })] }),
          new Paragraph({ children: [new TextRun({ text: '2. Jones, K. (2019). Another title. J. Test, 2, 3-4.' })] })
        ]
      }
    ]
  })
  const buffer = await Packer.toBuffer(doc)
  const dir = await mkdtemp(join(tmpdir(), 'suna-docx-fixture-'))
  cleanupPaths.push(dir)
  const path = join(dir, 'fixture.docx')
  await writeFile(path, buffer)
  return path
}

async function tempProjectDir(): Promise<string> {
  const dir = join(tmpdir(), `suna-docx-import-project-${randomBytes(6).toString('hex')}`)
  cleanupPaths.push(dir)
  return dir
}

/** Recursively collects every file's text content under `dir` (best-effort; skips binaries it can't decode meaningfully — fine, we only grep for an ASCII marker). */
async function readAllFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else out.push(await readFile(full, 'utf8').catch(() => ''))
    }
  }
  await walk(dir)
  return out
}

describe('analyzeDocx (real mammoth conversion)', () => {
  let docxPath: string
  let analysis: DocxAnalysis

  beforeAll(async () => {
    docxPath = await buildFixtureDocx()
    analysis = await analyzeDocx(docxPath)
  })

  it('detects the title from a fully-bold paragraph (ground truth: real manuscripts bold the title instead of using the Title style)', () => {
    expect(analysis.title.value).toBe('SUNA Test Manuscript Title')
  })

  it('detects both authors with affiliation markers split from <sup> runs', () => {
    expect(analysis.authors.map((a) => a.name)).toEqual(['Ada Researcher', 'Ben Collaborator'])
    expect(analysis.authors[0]?.affiliationRefs).toEqual(['1'])
    expect(analysis.authors[1]?.affiliationRefs).toEqual(['2'])
  })

  it('detects both affiliations', () => {
    expect(analysis.affiliations).toEqual([
      { marker: '1', text: 'Department of Testing, Test University' },
      { marker: '2', text: 'Institute of Fixtures, Fixture University' }
    ])
  })

  it('detects the abstract behind the Abstract heading', () => {
    expect(analysis.abstract.value).toBe('This fixture manuscript exists to test DOCX import.')
  })

  it('splits sections at h1/h2 boundaries, excluding front matter and references', () => {
    expect(analysis.sections.map((s) => s.heading)).toEqual(['Introduction', 'Results'])
  })

  it('rewrites the unambiguous [1] citation to [@key] and leaves the unmatched [3] literal with a warning', () => {
    const intro = analysis.sections.find((s) => s.heading === 'Introduction')
    const results = analysis.sections.find((s) => s.heading === 'Results')
    expect(intro?.markdown).toContain(`[@${analysis.references[0]?.citeKey}]`)
    // Left as literal text — escaped like any other markdown-significant
    // bracket so it can never be mistaken for a citation/link by the renderer.
    expect(results?.markdown).toContain('\\[3\\]')
    expect(analysis.warnings.some((w) => w.code === 'citation-ambiguous')).toBe(true)
  })

  it('parses both numbered references and assigns distinct cite keys', () => {
    expect(analysis.references).toHaveLength(2)
    expect(analysis.references[0]?.style).toBe('numbered')
    expect(new Set(analysis.references.map((r) => r.citeKey)).size).toBe(2)
  })

  it('extracts the embedded image to a real temp file instead of a data URI', async () => {
    expect(analysis.figures).toHaveLength(1)
    const figure = analysis.figures[0]
    if (figure === undefined) throw new Error('expected a figure')
    const info = await stat(figure.tempPath)
    expect(info.size).toBeGreaterThan(0)
    expect(analysis.sections.some((s) => s.markdown.includes('data:image'))).toBe(false)
    expect(analysis.sections.some((s) => s.markdown.includes(`docx-image:${figure.id}`))).toBe(true)
  })
})

describe('commitDocxAnalysis (real fixture end to end)', () => {
  it('writes a schema-valid project with figures as files and a references.bib that round-trips through parseBibtex', async () => {
    const docxPath = await buildFixtureDocx()
    const analysis = await analyzeDocx(docxPath)
    const targetDir = await tempProjectDir()

    const { dir } = await commitDocxAnalysis(analysis, targetDir, false)
    expect(dir).toBe(targetDir)

    const manifestRaw = await readFile(join(targetDir, 'suna.json'), 'utf8')
    const manifest = SunaProjectManifestSchema.parse(JSON.parse(manifestRaw))
    expect(manifest.name).toBe(targetDir.split('/').pop())

    const manuscriptRaw = await readFile(join(targetDir, 'manuscript', 'manuscript.json'), 'utf8')
    const manuscript = ManuscriptSchema.parse(JSON.parse(manuscriptRaw))
    expect(manuscript.title).toBe('SUNA Test Manuscript Title')
    expect(manuscript.manuscriptFile).toBe('manuscript.md')

    const authorsRaw = await readFile(join(targetDir, 'manuscript', 'authors.json'), 'utf8')
    const authorsFile = AuthorsFileSchema.parse(JSON.parse(authorsRaw))
    expect(authorsFile.authors).toHaveLength(2)
    expect(authorsFile.authors[0]?.affiliationRefs).toEqual(['af1'])

    // The flat layout has no sections/ directory at all (feature-plan-7 §1).
    await expect(readdir(join(targetDir, 'manuscript', 'sections'))).rejects.toThrow()

    const manuscriptMd = await readFile(join(targetDir, 'manuscript', 'manuscript.md'), 'utf8')
    expect(manuscriptMd).toContain('# Introduction')
    expect(manuscriptMd).toContain('# Results')
    expect(manuscriptMd).toContain(`[@${analysis.references[0]?.citeKey}]`)
    expect(manuscriptMd).not.toContain('docx-image:')
    expect(manuscriptMd).toMatch(/\.\.\/figures\/imported-1\/figure\.png/)

    const figureFile = join(targetDir, 'figures', 'imported-1', 'figure.png')
    const figureInfo = await stat(figureFile)
    expect(figureInfo.size).toBeGreaterThan(0)

    const bibRaw = await readFile(join(targetDir, 'manuscript', 'references.bib'), 'utf8')
    const parsed = parseBibtex(bibRaw)
    expect(parsed.errors).toEqual([])
    expect(parsed.entries).toHaveLength(2)
    // round-trip: serialize what we parsed and parse it again cleanly
    const roundTripped = parseBibtex(serializeBibtex(parsed.entries))
    expect(roundTripped.errors).toEqual([])
    expect(roundTripped.entries).toHaveLength(2)

    // No data URIs anywhere in the written project.
    const contents = await readAllFiles(targetDir)
    expect(contents.some((c) => c.includes('data:image'))).toBe(false)
  })

  it('refuses to write into a directory that already is a SUNA project, even with force', async () => {
    const docxPath = await buildFixtureDocx()
    const analysis = await analyzeDocx(docxPath)
    const targetDir = await tempProjectDir()
    await commitDocxAnalysis(analysis, targetDir, false)

    const analysis2 = await analyzeDocx(await buildFixtureDocx())
    await expect(commitDocxAnalysis(analysis2, targetDir, true)).rejects.toThrow(/existing SUNA project/)
  })

  it('refuses a non-empty target directory unless force is set', async () => {
    const docxPath = await buildFixtureDocx()
    const analysis = await analyzeDocx(docxPath)
    const targetDir = await tempProjectDir()
    const { mkdir, writeFile: write } = await import('node:fs/promises')
    await mkdir(targetDir, { recursive: true })
    await write(join(targetDir, 'unrelated.txt'), 'hello')

    await expect(commitDocxAnalysis(analysis, targetDir, false)).rejects.toThrow(/not empty/)
    await expect(commitDocxAnalysis(analysis, targetDir, true)).resolves.toEqual({ dir: targetDir })
  })

  it('refuses to commit when the review-editable fields are left empty', async () => {
    const docxPath = await buildFixtureDocx()
    const analysis = await analyzeDocx(docxPath)
    const targetDir = await tempProjectDir()
    const incomplete: DocxAnalysis = { ...analysis, title: { value: null, reason: 'cleared by user' } }
    await expect(commitDocxAnalysis(incomplete, targetDir, false)).rejects.toThrow(/title/)
  })
})

describe('buildManuscriptMarkdown', () => {
  it('renders each section heading at its Word heading depth (1 → #, 2 → ##)', () => {
    const md = buildManuscriptMarkdown(
      [
        { heading: 'Introduction', level: 1, markdown: 'Intro text.' },
        { heading: 'Background', level: 2, markdown: 'Sub text.' }
      ],
      []
    )
    expect(md).toBe('# Introduction\n\nIntro text.\n\n## Background\n\nSub text.\n')
  })

  it('contributes prose with no heading line for an untitled leading section', () => {
    const md = buildManuscriptMarkdown(
      [
        { heading: null, level: 1, markdown: 'Lead-in prose before any heading.' },
        { heading: 'Results', level: 1, markdown: 'Results text.' }
      ],
      []
    )
    expect(md).toBe('Lead-in prose before any heading.\n\n# Results\n\nResults text.\n')
  })

  it('rewrites docx-image placeholders to figures/<id>/figure.<ext>, one level up from manuscript.md', () => {
    const md = buildManuscriptMarkdown(
      [{ heading: 'Results', level: 1, markdown: 'See below.\n\n![](docx-image:imported-1)' }],
      [{ id: 'imported-1', tempPath: '/tmp/whatever.png', ext: 'png', alt: '' }]
    )
    expect(md).toContain('../figures/imported-1/figure.png')
    expect(md).not.toContain('docx-image:')
  })

  it('returns an empty string for no sections', () => {
    expect(buildManuscriptMarkdown([], [])).toBe('')
  })
})

describe('extensionForContentType', () => {
  it('maps known image MIME types and falls back to png', () => {
    expect(extensionForContentType('image/png')).toBe('png')
    expect(extensionForContentType('image/jpeg')).toBe('jpg')
    expect(extensionForContentType('image/nonsense')).toBe('png')
  })
})

describe('toBibAuthor', () => {
  it('splits "Family, Given" into a person author', () => {
    expect(toBibAuthor('Smith, J.')).toEqual({ kind: 'person', family: 'Smith', given: 'J.' })
  })

  it('splits "Family XY" (vancouver, no comma) into family + given', () => {
    expect(toBibAuthor('Smith AB')).toEqual({ kind: 'person', family: 'Smith', given: 'AB' })
  })

  it('falls back to a literal author when nothing can be split', () => {
    expect(toBibAuthor('')).toEqual({ kind: 'literal', literal: '' })
  })
})

describe('correspondence lines are not affiliations', () => {
  /**
   * Regression: the real sleepTI_draft_v0.9.docx ends its affiliation block
   * with "*Corresponding author: corresponding@example.edu". Encoding that as a fourth
   * affiliation invented an institution and discarded both the contact email
   * and the fact that the LAST author (not the first) is corresponding.
   */
  it('classifies a marked "Corresponding author" line as correspondence', () => {
    expect(
      isCorrespondenceEntry({ marker: '*', text: 'Corresponding author: corresponding@example.edu' })
    ).toBe(true)
  })

  it('classifies a non-numeric marker carrying a bare email as correspondence', () => {
    expect(isCorrespondenceEntry({ marker: '*', text: 'corresponding@example.edu' })).toBe(true)
  })

  it('keeps a numeric-marker institution as an affiliation even with a contact email', () => {
    expect(
      isCorrespondenceEntry({
        marker: '2',
        text: 'Department of Psychiatry, Example University, contact: dept@example.edu'
      })
    ).toBe(false)
  })

  it('splits correspondence out of the affiliation list and recovers the email', () => {
    const derived = deriveCorrespondence([
      { marker: '1', text: 'Department of Biomedical Engineering, UW-Madison' },
      { marker: '2', text: 'Department of Psychiatry, UW-Madison' },
      { marker: '*', text: 'Corresponding author: corresponding@example.edu' }
    ])
    expect(derived.affiliations.map((a) => a.marker)).toEqual(['1', '2'])
    expect([...derived.markers]).toEqual(['*'])
    expect(derived.email).toBe('corresponding@example.edu')
  })

  it('leaves a plain affiliation list untouched', () => {
    const derived = deriveCorrespondence([{ marker: '1', text: 'Department of Neurology' }])
    expect(derived.affiliations).toHaveLength(1)
    expect(derived.markers.size).toBe(0)
    expect(derived.email).toBeNull()
  })
})
