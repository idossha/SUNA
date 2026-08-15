import { describe, expect, it } from 'vitest'
import { SunaProjectManifestSchema } from '@suna/core'
import { buildProjectManifest } from './manifest'

describe('buildProjectManifest', () => {
  it('produces a manifest that validates against SunaProjectManifestSchema', () => {
    const manifest = buildProjectManifest({
      name: 'Ram Pressure Paper',
      activeProfileId: 'nature-astronomy',
      settings: {},
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect(SunaProjectManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('matches the shape suna.json will actually hold, byte for byte', () => {
    const manifest = buildProjectManifest({
      name: 'Ram Pressure Paper',
      activeProfileId: 'science',
      settings: {},
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect(manifest).toEqual({
      schemaVersion: 1,
      name: 'Ram Pressure Paper',
      activeProfileId: 'science',
      directories: {
        manuscript: 'manuscript',
        figures: 'figures',
        code: 'code',
        data: 'data',
        analysis: 'analysis',
        results: 'results',
        output: 'output'
      },
      createdAt: '2026-08-15T10:00:00.000Z'
    })
  })

  it('omits the settings key entirely when the wizard set no project defaults', () => {
    const manifest = buildProjectManifest({
      name: 'Paper',
      activeProfileId: 'mnras',
      settings: {},
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect('settings' in manifest).toBe(false)
  })

  it('includes the step-6 settings block when defaults are saved to the project', () => {
    const manifest = buildProjectManifest({
      name: 'Paper',
      activeProfileId: 'apj-aas',
      settings: { editor: { fontSizePx: 16, lineHeight: 1.5, contentWidthCh: 72 } },
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect(manifest.settings).toEqual({
      editor: { fontSizePx: 16, lineHeight: 1.5, contentWidthCh: 72 }
    })
  })

  it('defaults createdAt to now when not supplied, and it is a valid ISO datetime', () => {
    const manifest = buildProjectManifest({
      name: 'Paper',
      activeProfileId: 'nature-astronomy',
      settings: {}
    })
    expect(SunaProjectManifestSchema.shape.createdAt.safeParse(manifest.createdAt).success).toBe(
      true
    )
  })

  it('rejects an out-of-range settings value rather than silently clamping it', () => {
    expect(() =>
      buildProjectManifest({
        name: 'Paper',
        activeProfileId: 'nature-astronomy',
        settings: { editor: { fontSizePx: 999 } },
        createdAt: '2026-08-15T10:00:00.000Z'
      })
    ).toThrow()
  })
})
