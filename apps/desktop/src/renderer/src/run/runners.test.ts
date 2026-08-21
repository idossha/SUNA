import { describe, expect, it } from 'vitest'
import { displayPath, runCommandFor, runnerFor, shellQuote } from './runners'

describe('runnerFor', () => {
  it('matches by extension, case-insensitively', () => {
    expect(runnerFor('/p/code/test.py')?.program).toBe('python')
    expect(runnerFor('/p/code/Analysis.R')?.program).toBe('Rscript')
    expect(runnerFor('/p/code/build.MJS')?.program).toBe('node')
  })

  it('has no runner for prose, data or unknown files', () => {
    for (const path of ['/p/manuscript/intro.md', '/p/data/x.csv', '/p/README', '/p/f.svg']) {
      expect(runnerFor(path)).toBeNull()
    }
  })

  it('does not treat a dotfile name as an extension', () => {
    expect(runnerFor('/p/.zshrc')).toBeNull()
  })

  it('leaves notebooks alone — they open in the notebook tab, not a pty', () => {
    expect(runnerFor('/p/code/analysis.ipynb')).toBeNull()
  })
})

describe('shellQuote', () => {
  it('survives spaces, dollars and embedded quotes', () => {
    expect(shellQuote('/p/my code/a.py')).toBe("'/p/my code/a.py'")
    expect(shellQuote('/p/$HOME.py')).toBe("'/p/$HOME.py'")
    expect(shellQuote("/p/it's.py")).toBe("'/p/it'\\''s.py'")
  })
})

describe('displayPath', () => {
  it('relativises inside the project and leaves outside paths absolute', () => {
    expect(displayPath('/p/code/test.py', '/p')).toBe('code/test.py')
    expect(displayPath('/elsewhere/test.py', '/p')).toBe('/elsewhere/test.py')
    expect(displayPath('/p/code/test.py', null)).toBe('/p/code/test.py')
  })

  it('does not mistake a sibling directory for the root', () => {
    expect(displayPath('/proj-two/a.py', '/proj')).toBe('/proj-two/a.py')
  })
})

describe('runCommandFor', () => {
  it('builds a project-relative command and a file-named tab title', () => {
    expect(runCommandFor('/p/code/test.py', '/p', true)).toEqual({
      command: "python 'code/test.py'",
      title: 'run test.py',
      runner: expect.objectContaining({ program: 'python' })
    })
  })

  it('includes the runner argv before the file', () => {
    expect(runCommandFor('/p/x.ts', '/p')?.command).toBe("npx --yes tsx 'x.ts'")
  })

  // A stock macOS/Debian has no `python`, only `python3`; asking for the
  // former makes zsh offer a spelling correction instead of running.
  it('says python3 with no env selected and python inside one', () => {
    expect(runCommandFor('/p/a.py', '/p', false)?.command).toBe("python3 'a.py'")
    expect(runCommandFor('/p/a.py', '/p', true)?.command).toBe("python 'a.py'")
  })

  it('leaves runners without an env-free variant alone', () => {
    expect(runCommandFor('/p/a.js', '/p', false)?.command).toBe("node 'a.js'")
  })

  it('returns null when nothing can run the file', () => {
    expect(runCommandFor('/p/manuscript/intro.md', '/p')).toBeNull()
  })
})
