import { describe, expect, it } from 'vitest'
import type { BodyNode } from '@suna/core'
import { flattenBody } from './outline'

const body: BodyNode[] = [
  {
    kind: 'section',
    heading: null,
    level: 'A',
    content: 'sections/00-lede.md',
    children: []
  },
  {
    kind: 'section',
    heading: 'Results',
    level: 'A',
    content: null,
    children: [
      {
        kind: 'section',
        heading: 'Spectroscopy',
        level: 'B',
        content: 'sections/02-spectroscopy.md',
        children: []
      },
      {
        kind: 'section',
        heading: 'Kinematics',
        level: 'C-runin',
        content: 'sections/03-kinematics.md',
        children: []
      }
    ]
  },
  {
    kind: 'box',
    id: 'box1',
    title: 'Jellyfish galaxies',
    content: 'sections/box-jellyfish.md',
    figureRefs: []
  }
]

describe('flattenBody', () => {
  it('flattens depth-first in document order', () => {
    const rows = flattenBody(body)
    expect(rows.map((r) => r.label)).toEqual([
      null,
      'Results',
      'Spectroscopy',
      'Kinematics',
      'Jellyfish galaxies'
    ])
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 1, 0])
  })

  it('maps heading levels and boxes to chips', () => {
    const rows = flattenBody(body)
    expect(rows.map((r) => r.chip)).toEqual(['A', 'A', 'B', 'C', 'box'])
  })

  it('keeps content paths, including null for container sections', () => {
    const rows = flattenBody(body)
    expect(rows[0]?.contentPath).toBe('sections/00-lede.md')
    expect(rows[1]?.contentPath).toBeNull()
    expect(rows[4]?.contentPath).toBe('sections/box-jellyfish.md')
  })

  it('assigns unique stable keys', () => {
    const rows = flattenBody(body)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
    expect(rows[2]?.key).toBe('1.0')
  })
})
