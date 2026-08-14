import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { offsetForJsonPath, schemaForFile, sunaJsonLinter } from './jsonLint'

function jsonState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [json()] })
}

/** The linter only touches view.state, so a state-only stub suffices in node. */
function fakeView(doc: string): EditorView {
  return { state: jsonState(doc) } as unknown as EditorView
}

describe('schemaForFile', () => {
  it('maps the three well-known SUNA documents', () => {
    expect(schemaForFile('suna.json')).toBeDefined()
    expect(schemaForFile('manuscript.json')).toBeDefined()
    expect(schemaForFile('figure.json')).toBeDefined()
  })

  it('handles full paths and case', () => {
    expect(schemaForFile('some/project/Suna.json')).toBeDefined()
    expect(schemaForFile('manuscript/manuscript.json')).toBeDefined()
  })

  it('returns undefined for other json files', () => {
    expect(schemaForFile('package.json')).toBeUndefined()
    expect(schemaForFile('data.json')).toBeUndefined()
  })
})

describe('offsetForJsonPath', () => {
  const doc = '{"a": {"b": [10, 20, {"c": true}]}}'

  it('resolves nested object/array paths to the value node', () => {
    const state = jsonState(doc)
    const { from, to } = offsetForJsonPath(state, ['a', 'b', 2, 'c'])
    expect(doc.slice(from, to)).toBe('true')
  })

  it('resolves array indices', () => {
    const state = jsonState(doc)
    const { from, to } = offsetForJsonPath(state, ['a', 'b', 1])
    expect(doc.slice(from, to)).toBe('20')
  })

  it('falls back to the deepest matched node for missing keys', () => {
    const state = jsonState(doc)
    const { from } = offsetForJsonPath(state, ['a', 'missing'])
    expect(from).toBe(doc.indexOf('{"b"'))
  })
})

describe('sunaJsonLinter', () => {
  it('reports JSON.parse errors for any json file', () => {
    const diagnostics = sunaJsonLinter('data.json')(fakeView('{"a": 1,}'))
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.severity).toBe('error')
  })

  it('is silent for valid json without a matching schema', () => {
    expect(sunaJsonLinter('data.json')(fakeView('{"a": 1}'))).toEqual([])
  })

  it('reports schema issues for suna.json', () => {
    const doc = '{"schemaVersion": 2, "name": ""}'
    const diagnostics = sunaJsonLinter('suna.json')(fakeView(doc))
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics.every((d) => d.source === 'suna-schema')).toBe(true)
    const versionIssue = diagnostics.find((d) => d.message.startsWith('schemaVersion'))
    expect(versionIssue).toBeDefined()
    expect(doc.slice(versionIssue!.from, versionIssue!.to)).toBe('2')
  })

  it('is silent for a valid suna.json', () => {
    const valid = JSON.stringify({
      schemaVersion: 1,
      name: 'demo',
      activeProfileId: 'default',
      // zod v4 records with enum keys are exhaustive: all seven required
      directories: {
        manuscript: 'manuscript',
        figures: 'figures',
        code: 'code',
        data: 'data',
        analysis: 'analysis',
        results: 'results',
        output: 'output'
      },
      createdAt: '2026-01-01T00:00:00Z'
    })
    expect(sunaJsonLinter('suna.json')(fakeView(valid))).toEqual([])
  })
})
