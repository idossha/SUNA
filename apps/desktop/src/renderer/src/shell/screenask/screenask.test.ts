import { describe, expect, it } from 'vitest'
import { screenAskCommand, screenAskTarget, shellQuote } from './screenask'

describe('screenAskTarget', () => {
  it('sends a dev run at the SUNA checkout, even with a project open', () => {
    expect(screenAskTarget({ isDev: true, repoRoot: '/src/SUNA', rootDir: '/w/paper' })).toEqual({
      target: 'repo',
      cwd: '/src/SUNA'
    })
  })

  it('sends a packaged run at the open project', () => {
    expect(screenAskTarget({ isDev: false, repoRoot: null, rootDir: '/w/paper' })).toEqual({
      target: 'project',
      cwd: '/w/paper'
    })
  })

  it('falls back to the project when a dev run has no checkout to point at', () => {
    expect(screenAskTarget({ isDev: true, repoRoot: null, rootDir: '/w/paper' })).toEqual({
      target: 'project',
      cwd: '/w/paper'
    })
  })

  it('refuses rather than running an agent in an arbitrary directory', () => {
    expect(screenAskTarget({ isDev: false, repoRoot: null, rootDir: null })).toBeNull()
  })
})

describe('shellQuote', () => {
  it('quotes an ordinary path', () => {
    expect(shellQuote('/w/paper')).toBe("'/w/paper'")
  })

  it('survives an apostrophe in a directory name', () => {
    expect(shellQuote("/w/ido's papers")).toBe(`'/w/ido'\\''s papers'`)
  })

  it('leaves spaces and $ inert inside the quotes', () => {
    expect(shellQuote('/w/my $HOME/x')).toBe("'/w/my $HOME/x'")
  })
})

describe('screenAskCommand', () => {
  it('cds to the target root and feeds the prompt file in as the first turn', () => {
    expect(screenAskCommand('/w/paper', '/w/paper/.suna/screen-asks/x/prompt.md', 'claude')).toBe(
      `cd '/w/paper' && claude "$(cat '/w/paper/.suna/screen-asks/x/prompt.md')"`
    )
  })

  it('keeps the substitution double-quoted, so newlines in the prompt survive', () => {
    const command = screenAskCommand('/w/p', '/w/p/prompt.md', 'claude')
    expect(command).toContain('"$(cat')
    expect(command.endsWith('")')).toBe(false)
  })
})
