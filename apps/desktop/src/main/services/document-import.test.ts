import { describe, expect, it } from 'vitest'
import { documentKind, htmlToFragment, pdfLinesToHtml } from './document-import'

describe('documentKind', () => {
  it('recognizes the three manuscript formats and nothing else', () => {
    expect(documentKind('/x/paper.DOCX')).toBe('docx')
    expect(documentKind('/x/paper.pdf')).toBe('pdf')
    expect(documentKind('/x/paper.htm')).toBe('html')
    expect(documentKind('/x/paper.html')).toBe('html')
    expect(documentKind('/x/paper.md')).toBeNull()
  })
})

describe('htmlToFragment', () => {
  it('keeps only the body, without scripts, styles or comments', () => {
    const fragment = htmlToFragment(
      '<!doctype html><html><head><title>t</title><style>p{}</style></head>' +
        '<body><h1>Title</h1><!-- note --><script>x()</script><p>Prose.</p></body></html>'
    )
    expect(fragment).toBe('<h1>Title</h1><p>Prose.</p>')
  })

  it('passes a bare fragment through', () => {
    expect(htmlToFragment('<h1>Title</h1>')).toBe('<h1>Title</h1>')
  })
})

describe('pdfLinesToHtml', () => {
  const body = 'This is a full measure line of body prose that runs the width.'

  it('takes the first line as the title and joins wrapped lines into paragraphs', () => {
    const html = pdfLinesToHtml([['A Paper About Things', body, 'ends here.', body, 'and stops.']])
    expect(html).toBe(
      '<h1>A Paper About Things</h1>\n' +
        `<p>${body} ends here.</p>\n` +
        `<p>${body} and stops.</p>`
    )
  })

  it('recognizes section headings, numbered or not', () => {
    const html = pdfLinesToHtml([['Title', 'Introduction', body, 'x.', '2 Methods', body, 'y.']])
    expect(html).toContain('<h2>Introduction</h2>')
    expect(html).toContain('<h2>2 Methods</h2>')
  })

  it('drops page numbers and running heads that repeat across pages', () => {
    const head = 'Haber et al. 2026'
    const page = (n: string): string[] => [head, body, 'tail line.', n]
    const html = pdfLinesToHtml([page('1'), page('2'), page('3')])
    expect(html).not.toContain(head)
    expect(html).not.toMatch(/<p>\d+<\/p>/)
  })

  it('returns nothing for a PDF with no text layer', () => {
    expect(pdfLinesToHtml([[], []])).toBe('')
  })
})
