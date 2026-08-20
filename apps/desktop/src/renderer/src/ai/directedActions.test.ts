import { describe, expect, it } from 'vitest'
import { gateFromStatus, stripFence } from './directedActions'

/**
 * The pure half of cliGate (feature-plan-8 §2a/§2c): resolution must mirror
 * main's resolveCli exactly — 'auto' tries claude then codex, an explicit
 * preference NEVER falls back — because the gate's verdict and the spawn's
 * actual CLI choice must never disagree (a gate that says ok while the
 * spawn resolves codex would launch a read-only run for an edit action).
 */

const CODEX_REASON = 'AI edits need Claude Code (codex runs read-only here)'
const INSTALL_REASON = 'Install Claude Code to run AI edits.'

describe('gateFromStatus', () => {
  it('passes when auto resolves to claude', () => {
    expect(gateFromStatus('auto', ['claude', 'codex'])).toEqual({ ok: true })
    expect(gateFromStatus('auto', ['claude'])).toEqual({ ok: true })
  })

  it('refuses with the codex reason when auto resolves to codex', () => {
    expect(gateFromStatus('auto', ['codex'])).toEqual({ ok: false, reason: CODEX_REASON })
  })

  it('refuses with the install reason when nothing is installed', () => {
    expect(gateFromStatus('auto', [])).toEqual({ ok: false, reason: INSTALL_REASON })
  })

  it('honours an explicit codex preference even when claude is installed', () => {
    expect(gateFromStatus('codex', ['claude', 'codex'])).toEqual({
      ok: false,
      reason: CODEX_REASON
    })
  })

  it('never falls back from an explicit claude preference to codex', () => {
    expect(gateFromStatus('claude', ['codex'])).toEqual({ ok: false, reason: INSTALL_REASON })
    expect(gateFromStatus('claude', ['claude', 'codex'])).toEqual({ ok: true })
  })
})

describe('stripFence', () => {
  it('unwraps a fenced answer — a fence pasted into a letter is a visible defect', () => {
    expect(stripFence('```\nWe have revised the Methods.\n```')).toBe(
      'We have revised the Methods.'
    )
    expect(stripFence('```markdown\nOne.\n\nTwo.\n```')).toBe('One.\n\nTwo.')
  })

  it('leaves ordinary prose alone, including prose containing a fence', () => {
    expect(stripFence('  We now report n = 24.  ')).toBe('We now report n = 24.')
    const withCode = 'We added the snippet:\n\n```py\nx = 1\n```\n\nas requested.'
    expect(stripFence(withCode)).toBe(withCode)
  })
})
