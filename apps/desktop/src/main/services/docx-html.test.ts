import { describe, expect, it } from 'vitest'
import {
  elementsToRuns,
  isFullyBold,
  parseHtmlBlocks,
  parseHtmlFragment,
  runsToPlainText,
  type Block
} from './docx-html'

describe('parseHtmlFragment', () => {
  it('builds a tree from well-formed markup with nested inline tags', () => {
    const nodes = parseHtmlFragment('<p>Hello <strong>bold <em>and italic</em></strong> text</p>')
    expect(nodes).toHaveLength(1)
    const p = nodes[0]
    if (p?.type !== 'element') throw new Error('expected element')
    expect(p.tag).toBe('p')
  })

  it('decodes entities in text and attribute values', () => {
    const nodes = parseHtmlFragment('<p title="A &amp; B">x &lt;y&gt; &#39;z&#39;</p>')
    const p = nodes[0]
    if (p?.type !== 'element') throw new Error('expected element')
    expect(p.attrs['title']).toBe('A & B')
    const text = p.children[0]
    if (text?.type !== 'text') throw new Error('expected text')
    expect(text.value).toBe("x <y> 'z'")
  })

  it('treats img/br/hr as void even without a trailing slash', () => {
    const nodes = parseHtmlFragment('<p>a<br>b</p><img src="x.png" alt="y">')
    const p = nodes[0]
    if (p?.type !== 'element') throw new Error('expected element')
    expect(p.children.map((c) => (c.type === 'element' ? c.tag : c.value))).toEqual(['a', 'br', 'b'])
    expect(nodes[1]).toEqual({ type: 'element', tag: 'img', attrs: { src: 'x.png', alt: 'y' }, children: [] })
  })

  it('recovers from an unmatched close tag instead of throwing', () => {
    expect(() => parseHtmlFragment('<p>a</div>more')).not.toThrow()
  })
})

describe('elementsToRuns', () => {
  it('merges adjacent same-style runs and tracks bold/italic/sup/sub', () => {
    const nodes = parseHtmlFragment('Hello <strong>bold</strong> and<sup>1</sup><sup>2</sup> end')
    const runs = elementsToRuns(nodes)
    expect(runs).toEqual([
      { text: 'Hello ' },
      { text: 'bold', bold: true },
      { text: ' and' },
      { text: '12', sup: true },
      { text: ' end' }
    ])
  })

  it('captures link hrefs', () => {
    const nodes = parseHtmlFragment('<a href="https://x.test">link text</a>')
    expect(elementsToRuns(nodes)).toEqual([{ text: 'link text', link: 'https://x.test' }])
  })
})

describe('isFullyBold', () => {
  it('is true only when every non-whitespace run is bold and there is text', () => {
    expect(isFullyBold(elementsToRuns(parseHtmlFragment('<strong>All bold</strong>')))).toBe(true)
    expect(isFullyBold(elementsToRuns(parseHtmlFragment('<strong>Bold</strong> not bold')))).toBe(false)
    expect(isFullyBold(elementsToRuns(parseHtmlFragment('   ')))).toBe(false)
  })
})

describe('parseHtmlBlocks', () => {
  it('splits headings, paragraphs, lists, tables, blockquotes and images', () => {
    const html =
      '<h1>Title</h1>' +
      '<p>Intro <em>text</em>.</p>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>' +
      '<blockquote><p>quoted</p></blockquote>' +
      '<p><img src="/tmp/img-1.png" alt="a figure"/></p>'
    const blocks = parseHtmlBlocks(html)
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'table',
      'blockquote',
      'image'
    ])
    const heading = blocks[0]
    if (heading?.kind !== 'heading') throw new Error('expected heading')
    expect(heading.level).toBe(1)
    expect(runsToPlainText(heading.runs)).toBe('Title')

    const list = blocks[2]
    if (list?.kind !== 'list') throw new Error('expected list')
    expect(list.items.map(runsToPlainText)).toEqual(['one', 'two'])

    const table = blocks[3]
    if (table?.kind !== 'table') throw new Error('expected table')
    expect(table.rows.map((row) => row.map(runsToPlainText))).toEqual([
      ['H1', 'H2'],
      ['a', 'b']
    ])

    const image = blocks[5]
    if (image?.kind !== 'image') throw new Error('expected image')
    expect(image).toEqual({ kind: 'image', src: '/tmp/img-1.png', alt: 'a figure' })
  })

  it('flattens unknown wrapper elements like <div> and <span>', () => {
    const blocks = parseHtmlBlocks('<div><p>inside a div</p></div>')
    expect(blocks).toEqual([{ kind: 'paragraph', runs: [{ text: 'inside a div' }] } satisfies Block])
  })

  it('drops whitespace-only paragraphs', () => {
    expect(parseHtmlBlocks('<p>  </p><p>real</p>')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'real' }] }
    ])
  })
})
