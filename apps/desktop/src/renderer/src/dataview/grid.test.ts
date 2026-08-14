import { describe, expect, it } from 'vitest'
import {
  MAX_RENDERED_ROWS,
  delimiterFor,
  detectNumericColumns,
  isNumericCell,
  parseDataFile
} from './grid'

describe('delimiterFor', () => {
  it('uses tabs for .tsv and commas otherwise', () => {
    expect(delimiterFor('data.tsv')).toBe('\t')
    expect(delimiterFor('DATA.TSV')).toBe('\t')
    expect(delimiterFor('data.csv')).toBe(',')
  })
})

describe('isNumericCell', () => {
  it('accepts numbers a spreadsheet would recognise', () => {
    for (const value of ['1', '-2.5', '+3', '1e9', '2.5E-3', '1,234', '1,234.56', ' 7 ']) {
      expect(isNumericCell(value), value).toBe(true)
    }
  })

  it('rejects text, blanks and number-ish strings', () => {
    for (const value of ['', '  ', 'n/a', '-', '1.2.3', '12px', '2020-01-01', '0x1f']) {
      expect(isNumericCell(value), value).toBe(false)
    }
  })
})

describe('detectNumericColumns', () => {
  it('flags a column when more than 80% of filled cells are numeric', () => {
    // 9 numbers + 1 label = 90%
    const rows = Array.from({ length: 10 }, (_, i) => [i === 9 ? 'n/a' : String(i), 'text'])
    expect(detectNumericColumns(rows, 2)).toEqual([true, false])
  })

  it('does not flag a column at exactly 80%', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [i < 8 ? String(i) : 'x'])
    expect(detectNumericColumns(rows, 1)).toEqual([false])
  })

  it('ignores empty cells when computing the ratio', () => {
    const rows = [['1'], [''], ['2'], ['   '], ['3']]
    expect(detectNumericColumns(rows, 1)).toEqual([true])
  })

  it('treats an all-empty column as non-numeric', () => {
    expect(detectNumericColumns([[''], ['']], 1)).toEqual([false])
  })

  it('only looks at the sample window', () => {
    const rows = [...Array.from({ length: 3 }, () => ['1']), ...Array.from({ length: 50 }, () => ['x'])]
    expect(detectNumericColumns(rows, 1, 3)).toEqual([true])
    expect(detectNumericColumns(rows, 1, 53)).toEqual([false])
  })
})

describe('parseDataFile', () => {
  it('takes the first row as the header', () => {
    const table = parseDataFile('name,age\nAda,36\nAlan,41\n', 'people.csv')
    expect(table.header).toEqual(['name', 'age'])
    expect(table.rows).toEqual([
      ['Ada', '36'],
      ['Alan', '41']
    ])
    expect(table.totalRows).toBe(2)
    expect(table.truncated).toBe(false)
    expect(table.numericColumns).toEqual([false, true])
  })

  it('splits .tsv on tabs', () => {
    const table = parseDataFile('a\tb\n1\t2\n', 'x.tsv')
    expect(table.header).toEqual(['a', 'b'])
    expect(table.rows).toEqual([['1', '2']])
  })

  it('honours quoted fields containing the delimiter', () => {
    const table = parseDataFile('a,b\n"one, two",3\n', 'x.csv')
    expect(table.rows[0]).toEqual(['one, two', '3'])
  })

  it('pads ragged rows to the widest row', () => {
    const table = parseDataFile('a,b\n1\n2,3,4\n', 'x.csv')
    expect(table.header).toEqual(['a', 'b', 'column 3'])
    expect(table.rows).toEqual([
      ['1', '', ''],
      ['2', '3', '4']
    ])
  })

  it('names blank header cells by position', () => {
    const table = parseDataFile('a,,c\n1,2,3\n', 'x.csv')
    expect(table.header).toEqual(['a', 'column 2', 'c'])
  })

  it('caps rendered rows and reports the true total', () => {
    const total = MAX_RENDERED_ROWS + 25
    const body = Array.from({ length: total }, (_, i) => `${i},x`).join('\n')
    const table = parseDataFile(`n,label\n${body}\n`, 'big.csv')
    expect(table.totalRows).toBe(total)
    expect(table.rows).toHaveLength(MAX_RENDERED_ROWS)
    expect(table.truncated).toBe(true)
  })

  it('handles an empty document', () => {
    const table = parseDataFile('', 'empty.csv')
    expect(table.header).toEqual([])
    expect(table.rows).toEqual([])
    expect(table.totalRows).toBe(0)
  })

  it('handles a header-only document', () => {
    const table = parseDataFile('a,b\n', 'x.csv')
    expect(table.header).toEqual(['a', 'b'])
    expect(table.rows).toEqual([])
    expect(table.truncated).toBe(false)
  })
})
