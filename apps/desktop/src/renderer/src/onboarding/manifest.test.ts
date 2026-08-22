import { describe, expect, it } from 'vitest'
import { SunaProjectManifestSchema } from '@suna/core'
import { buildProjectManifest } from './manifest'

describe('buildProjectManifest', () => {
  it('produces a manifest that validates against SunaProjectManifestSchema', () => {
    const manifest = buildProjectManifest({
      name: 'Ram Pressure Paper',
      activeProfileId: 'nature',
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect(SunaProjectManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('matches the shape suna.json will actually hold, byte for byte', () => {
    const manifest = buildProjectManifest({
      name: 'Ram Pressure Paper',
      activeProfileId: 'science',
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

  it('never writes a settings block — settings live in ~/.suna/config.yml now', () => {
    const manifest = buildProjectManifest({
      name: 'Paper',
      activeProfileId: 'science',
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect('settings' in manifest).toBe(false)
  })

  it('defaults createdAt to now when not supplied, and it is a valid ISO datetime', () => {
    const manifest = buildProjectManifest({
      name: 'Paper',
      activeProfileId: 'nature'
    })
    expect(SunaProjectManifestSchema.shape.createdAt.safeParse(manifest.createdAt).success).toBe(
      true
    )
  })
})
