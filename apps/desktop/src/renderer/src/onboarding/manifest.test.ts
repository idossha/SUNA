import { describe, expect, it } from 'vitest'
import { SunaProjectManifestSchema, starterDocuments } from '@suna/core'
import { buildProjectManifest } from './manifest'

describe('buildProjectManifest', () => {
  it('produces a manifest that validates against SunaProjectManifestSchema', () => {
    const manifest = buildProjectManifest({
      name: 'Ram Pressure Paper',
      activeProfileId: 'nature',
      scaffold: 'starter',
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect(SunaProjectManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('matches the shape suna.json will actually hold, byte for byte', () => {
    const manifest = buildProjectManifest({
      name: 'Ram Pressure Paper',
      activeProfileId: 'science',
      scaffold: 'blank',
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
      scaffold: 'blank',
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect('settings' in manifest).toBe(false)
  })

  it('defaults createdAt to now when not supplied, and it is a valid ISO datetime', () => {
    const manifest = buildProjectManifest({
      name: 'Paper',
      activeProfileId: 'nature',
      scaffold: 'starter'
    })
    expect(SunaProjectManifestSchema.shape.createdAt.safeParse(manifest.createdAt).success).toBe(
      true
    )
  })

  // REGRESSION (2026-09-01). `scaffoldProject` writes `documents:
  // starterDocuments()` for the Starter, and this preview did not — so the
  // Review page showed the user a suna.json missing the entire document
  // registry that Create then wrote. `pnpm smoke`'s
  // onboarding-creates-exactly-what-review-showed is the end-to-end guard;
  // this is the unit one.
  it('declares the starter registry, exactly as the writer does', () => {
    const manifest = buildProjectManifest({
      name: 'Paper',
      activeProfileId: 'suna',
      scaffold: 'starter',
      createdAt: '2026-08-15T10:00:00.000Z'
    })
    expect(manifest.documents).toEqual(starterDocuments())
  })

  it('leaves documents ABSENT for every other scaffold, not empty', () => {
    for (const scaffold of ['blank', 'document'] as const) {
      const manifest = buildProjectManifest({
        name: 'Paper',
        activeProfileId: 'suna',
        scaffold,
        createdAt: '2026-08-15T10:00:00.000Z'
      })
      expect('documents' in manifest).toBe(false)
    }
  })
})
