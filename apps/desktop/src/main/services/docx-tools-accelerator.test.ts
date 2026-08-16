import { beforeEach, describe, expect, it } from 'vitest'
import { docxToolsAvailable, resetDocxToolsAvailabilityCache, type DocxToolsProbe } from './docx-tools-accelerator'

/**
 * `buildViaDocxTools`'s spec.json construction (the bulk of this module) is
 * deliberately left without dedicated unit tests: it is the OPTIONAL
 * accelerator (feature-plan-6 §3 step 3) — export-docx.ts always falls back
 * to the bundled 'docx' library on any failure here, so its correctness
 * bar is "produces something docx-tools' own build() accepts", not
 * "identical output to the primary path", and it has no exported surface
 * narrower than the full `buildViaDocxTools(dir, content, options, target)`
 * call, which needs a real `docx-tools` binary on PATH to verify end to end.
 * This file covers what IS deterministically testable: the injectable
 * detection probe and its per-session cache, mirroring lit.ts's
 * isCliAvailable/CliProbe test pattern.
 */

beforeEach(() => {
  resetDocxToolsAvailabilityCache()
})

describe('docxToolsAvailable', () => {
  it('reports true when the probe resolves the binary', async () => {
    const probe: DocxToolsProbe = async () => true
    expect(await docxToolsAvailable(probe)).toBe(true)
  })

  it('reports false when the probe finds nothing on PATH', async () => {
    const probe: DocxToolsProbe = async () => false
    expect(await docxToolsAvailable(probe)).toBe(false)
  })

  it('caches the first result for the session — a later probe is never called', async () => {
    let calls = 0
    const probe: DocxToolsProbe = async () => {
      calls += 1
      return true
    }
    expect(await docxToolsAvailable(probe)).toBe(true)
    expect(await docxToolsAvailable(probe)).toBe(true)
    expect(calls).toBe(1)
  })

  it('resetDocxToolsAvailabilityCache forces a fresh probe', async () => {
    expect(await docxToolsAvailable(async () => false)).toBe(false)
    resetDocxToolsAvailabilityCache()
    expect(await docxToolsAvailable(async () => true)).toBe(true)
  })
})
