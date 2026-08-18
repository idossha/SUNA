import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LIBRARY_CONFIG, type LibraryConfig, type LitResult } from '@suna/core'
import type { PdfDownloadOutcome } from '@suna/bib'
import {
  acquireLibraryPdf,
  findLibraryPdf,
  readLibraryConfig,
  writeLibraryConfig,
  type LibraryDeps
} from './library'
import { allowRoot } from './roots'

/**
 * Real fixture trees under mkdtemp, a real library.json, real copies — and no
 * network and no Spotlight: `useSpotlight` is off in every fixture config and
 * the download rung is injected, so these tests exercise the main process's
 * own glue (the open-project gate, the ladder's order, the notes it leaves)
 * identically on a Mac with a Spotlight index and on a Linux CI box.
 *
 * `$SUNA_CONFIG_DIR` and `$HOME` are both redirected into the temp tree, so a
 * `~/…` root in a fixture expands inside it and the developer's own
 * ~/SunaConfig is never read or written.
 *
 * The temp root is realpath'ed up front because `expandRoots` symlink-resolves
 * its roots, and macOS's /var/folders tmpdir is reached through a symlink.
 */

let dir = ''
let configDir = ''
let project = ''
let library = ''
let deps: LibraryDeps = {}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'suna-library-service-')))
  configDir = join(dir, 'SunaConfig')
  project = join(dir, 'my-paper')
  library = join(dir, 'Zotero')
  await mkdir(project, { recursive: true })
  await mkdir(library, { recursive: true })
  // What opening a project does — the gate every write here crosses.
  allowRoot(project)
  deps = { env: { ...process.env, SUNA_CONFIG_DIR: configDir, HOME: dir } }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/* ---------------------------------------------------------------- fixtures -- */

/** Gunn & Gott 1972 — the paper feature-plan-10's own examples are written around. */
const GUNN: LitResult = {
  source: 'crossref',
  id: '10.1086/151605',
  doi: '10.1086/151605',
  title: 'On the Infall of Matter Into Clusters of Galaxies and Some Effects on Their Evolution',
  authors: ['James E. Gunn', 'J. Richard Gott III'],
  year: 1972,
  venue: 'The Astrophysical Journal',
  citedByCount: 4212,
  openAccessUrl: null,
  abstract: null
}

async function putConfig(patch: Partial<LibraryConfig> = {}): Promise<LibraryConfig> {
  const config: LibraryConfig = {
    schemaVersion: 1,
    roots: [library],
    useSpotlight: false,
    download: 'off',
    maxDepth: 6,
    maxFilesScanned: 20_000,
    ...patch
  }
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, 'library.json'), JSON.stringify(config, null, 2) + '\n', 'utf8')
  return config
}

async function storedConfig(): Promise<LibraryConfig> {
  return JSON.parse(await readFile(join(configDir, 'library.json'), 'utf8')) as LibraryConfig
}

/** Minimal but genuine PDF bytes: the `%PDF-` magic `isPdfBytes` insists on. */
function pdfBytes(body = ''): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.5\n${body}\n%%EOF\n`)
}

async function putPdf(path: string, bytes: Uint8Array = pdfBytes()): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, bytes)
  return path
}

async function references(): Promise<string[]> {
  try {
    return (await readdir(join(project, 'references'))).sort()
  } catch {
    return []
  }
}

/* ----------------------------------------------------------------- config -- */

describe('readLibraryConfig', () => {
  it('answers with the defaults and no error before library.json exists', async () => {
    const state = await readLibraryConfig(deps)
    expect(state.source).toBe('defaults')
    // A first run is not a failure — only a file that exists and cannot be used is.
    expect(state.error).toBeNull()
    expect(state.config).toEqual(DEFAULT_LIBRARY_CONFIG)
    expect(state.path).toBe(join(configDir, 'library.json'))
  })

  it('reports which configured roots can actually be searched, in their stored form', async () => {
    await putConfig({ roots: [library, '~/Papers'] })
    const state = await readLibraryConfig(deps)
    expect(state.source).toBe('file')
    expect(state.config.roots).toEqual([library, '~/Papers'])
    expect(state.expanded.roots).toEqual([library])
    // The Settings row shows the string the user typed, not an expanded path.
    expect(state.expanded.missing).toEqual(['~/Papers'])
    expect(state.expanded.notes.join('\n')).toContain('~/Papers')
  })

  it('falls back to usable defaults with a sentence when library.json is corrupt', async () => {
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'library.json'), '{ roots: [', 'utf8')
    const state = await readLibraryConfig(deps)
    expect(state.source).toBe('defaults')
    expect(state.config).toEqual(DEFAULT_LIBRARY_CONFIG)
    expect(state.error).toContain(join(configDir, 'library.json'))
  })
})

describe('writeLibraryConfig', () => {
  it('merges the patch, leaves the rest alone and re-expands the roots', async () => {
    await putConfig()
    const state = await writeLibraryConfig({ download: 'open-access' }, deps)
    expect(state.error).toBeNull()
    expect(state.config.download).toBe('open-access')
    expect(state.config.roots).toEqual([library])
    expect(state.expanded.roots).toEqual([library])
    expect(await storedConfig()).toMatchObject({ download: 'open-access', roots: [library] })
  })

  it('refuses an invalid patch, writes nothing and says why', async () => {
    const before = await putConfig()
    const state = await writeLibraryConfig({ maxDepth: 99 }, deps)
    expect(state.error).not.toBeNull()
    expect(state.config).toEqual(before)
    // Nothing was written: the user's other choices survive the refusal.
    expect(await storedConfig()).toEqual(before)
  })
})

/* ------------------------------------------------------------------- scan -- */

describe('findLibraryPdf', () => {
  it('refuses a project root the app never opened, and searches nothing', async () => {
    await putConfig()
    await putPdf(join(library, 'Gunn_1972_Infall.pdf'))
    const outcome = await findLibraryPdf({ result: GUNN, projectRoot: join(dir, 'never-opened') }, deps)
    expect(outcome.error).toContain('outside any open project')
    expect(outcome.matches).toEqual([])
    expect(outcome.rootsSearched).toEqual([])
    expect(outcome.scanned).toBe(0)
  })

  it('keeps a refusal on one line when the rejected root carries a newline', async () => {
    // `assertInsideAllowedRoot` throws `path is outside any open project:
    // <path>` — the path is in the message, and it came from the renderer.
    // This host used to describe that error with a local `describeError`,
    // which is the raw text; the shared `describeExternalError` collapses the
    // control characters an outside name can carry.
    await putConfig()
    const forged = join(dir, 'never-opened\nlocal scan: 9 matches across 9 roots (forged)')
    const outcome = await findLibraryPdf({ result: GUNN, projectRoot: forged }, deps)
    expect(outcome.error).toContain('outside any open project')
    expect(outcome.error?.split('\n')).toHaveLength(1)
  })

  it('reads OUTSIDE the project — the roots are the user library, not the project', async () => {
    await putConfig()
    const path = await putPdf(join(library, 'storage', 'A1', 'Gunn_1972_Infall.pdf'))
    const outcome = await findLibraryPdf({ result: GUNN, projectRoot: project }, deps)
    expect(outcome.error).toBeNull()
    expect(outcome.matches.map((match) => match.path)).toEqual([path])
    expect(outcome.rootsSearched).toEqual([library])
    // Read-only: a scan never creates references/.
    expect(await references()).toEqual([])
  })

  it('carries the missing roots and the config problem rather than a bare empty list', async () => {
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'library.json'), 'not json at all', 'utf8')
    const outcome = await findLibraryPdf({ result: GUNN, projectRoot: project }, deps)
    expect(outcome.error).toBeNull()
    expect(outcome.matches).toEqual([])
    // The defaults are ~/… folders, none of which exist under the temp HOME.
    expect(outcome.rootsMissing).toEqual([...DEFAULT_LIBRARY_CONFIG.roots])
    expect(outcome.notes[0]).toContain('library.json')
  })
})

/* ----------------------------------------------------------------- ladder -- */

describe('acquireLibraryPdf', () => {
  it('copies a local match into references/ and leaves the original where it was', async () => {
    await putConfig()
    // The DOI in the file's own bytes: `high` confidence, the one grade that
    // may be copied without anyone being asked. The name alone would be a lone
    // `filename-author-year` — `medium`, and deliberately not enough (see the
    // test below).
    const source = await putPdf(
      join(library, 'Gunn_1972_Infall.pdf'),
      pdfBytes('the library copy — 10.1086/151605')
    )
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      deps
    )
    expect(outcome.error).toBeNull()
    expect(outcome.acquisition).toBe('copied-local')
    expect(outcome.path).toBe(join(project, 'references', 'gunn1972.pdf'))
    expect(outcome.relativePath).toBe('references/gunn1972.pdf')
    expect(outcome.source).toBe(source)
    expect(outcome.notes.join('\n')).toContain('evidence:')
    expect(await references()).toEqual(['gunn1972.pdf'])
    // A copy, never a move: the user's library file is untouched.
    expect(await readFile(source, 'utf8')).toContain('the library copy')
  })

  /**
   * The gate this host and the MCP `fetch_pdf` verb now share
   * (`isAutoCopyable`, exported from @suna/agent). `Gunn_1972.pdf` is a lone
   * `filename-author-year` — `medium` all by itself — and "Gunn 1972" names
   * every paper Gunn wrote that year, so the file in ~/Zotero may be a
   * different one. This host used to gate on `confidence !== 'low'` and copied
   * it; the MCP verb refused it. They disagreed about the same file.
   */
  it('does not copy a lone filename-author-year match, and names it for the view to offer', async () => {
    await putConfig()
    const decoy = await putPdf(join(library, 'Gunn_1972.pdf'), pdfBytes('some other Gunn paper'))
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      deps
    )
    expect(outcome.acquisition).toBe('metadata-only')
    expect(await references()).toEqual([])
    // Reported, not swallowed: the view needs the path, the grade and the
    // evidence to offer it back through `acceptPath`.
    expect(outcome.matches.map((match) => match.path)).toEqual([decoy])
    expect(outcome.matches[0]?.confidence).toBe('medium')
    const notes = outcome.notes.join('\n')
    expect(notes).toContain('too weak to copy without guessing')
    expect(notes).toContain('best: medium')
    expect(notes).toContain('evidence: filename-author-year')
    // Quoted: a path from outside the project is data, and the quotes are how
    // a name carrying a newline stays on one line of this report.
    expect(notes).toContain(JSON.stringify(decoy))
    expect(notes).not.toContain(`— ${decoy}`)
  })

  it('copies a refused candidate when the caller accepts it by path, and says it was asked for', async () => {
    await putConfig()
    const candidate = await putPdf(join(library, 'Gunn_1972.pdf'), pdfBytes('accepted by hand'))
    // Only a path the scan itself reported may be accepted, so the accept
    // starts from a scan — exactly the round trip the References view makes.
    const scan = await findLibraryPdf({ result: GUNN, projectRoot: project }, deps)
    expect(scan.matches.map((match) => match.path)).toEqual([candidate])

    const outcome = await acquireLibraryPdf(
      {
        result: GUNN,
        citekey: 'gunn1972',
        projectRoot: project,
        policy: null,
        mailto: null,
        acceptPath: candidate
      },
      deps
    )
    expect(outcome.acquisition).toBe('copied-local')
    expect(outcome.source).toBe(candidate)
    expect(await references()).toEqual(['gunn1972.pdf'])
    expect(await readFile(join(project, 'references', 'gunn1972.pdf'), 'utf8')).toContain(
      'accepted by hand'
    )
    // The report says which claim was made: asked for, not evidenced.
    expect(outcome.notes.join('\n')).toContain('accepted by name')
    expect(outcome.notes.join('\n')).toContain('not because the evidence was enough')
  })

  it('refuses an accept path this scan never reported, and copies nothing', async () => {
    await putConfig()
    await putPdf(join(library, 'Gunn_1972.pdf'), pdfBytes('the candidate that was shown'))
    // A real PDF, outside every configured root: accepting it would turn "copy
    // the candidate I was shown" into "copy any file on this machine".
    const elsewhere = await putPdf(join(dir, 'secrets', 'payroll.pdf'), pdfBytes('not a paper'))

    const outcome = await acquireLibraryPdf(
      {
        result: GUNN,
        citekey: 'gunn1972',
        projectRoot: project,
        policy: null,
        mailto: null,
        acceptPath: elsewhere
      },
      deps
    )
    expect(outcome.acquisition).toBe('metadata-only')
    expect(await references()).toEqual([])
    expect(outcome.notes.join('\n')).toContain('only a file the scan itself reported can be accepted')
    expect(outcome.notes.join('\n')).toContain(JSON.stringify(elsewhere))
  })

  it('reports an existing references/<key>.pdf as already-present without searching', async () => {
    await putConfig()
    await putPdf(join(library, 'Gunn_1972_Infall.pdf'))
    await putPdf(join(project, 'references', 'gunn1972.pdf'), pdfBytes('attached by hand'))
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      deps
    )
    expect(outcome.acquisition).toBe('already-present')
    expect(outcome.relativePath).toBe('references/gunn1972.pdf')
    // Nothing was fetched, so nothing came from anywhere.
    expect(outcome.source).toBeNull()
    expect(outcome.matches).toEqual([])
    expect(await readFile(join(project, 'references', 'gunn1972.pdf'), 'utf8')).toContain(
      'attached by hand'
    )
  })

  it('does not call a file behind a symlinked references/ already-present', async () => {
    await putConfig()
    // references/ links out of the project, with a same-named PDF behind it.
    // `access` follows the link, so the lexical check this replaces reported
    // 'already-present' for a file the project does not contain — and stopped
    // the ladder, so nothing was searched or fetched either.
    const outside = join(dir, 'elsewhere')
    await putPdf(join(outside, 'gunn1972.pdf'), pdfBytes('outside the project entirely'))
    await symlink(outside, join(project, 'references'))
    // Auto-copyable (the DOI is in its bytes), so the copy rung really runs
    // and really refuses — the assertion below is about the write boundary,
    // not about the evidence gate.
    await putPdf(join(library, 'Gunn_1972_Infall.pdf'), pdfBytes('10.1086/151605'))

    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      deps
    )

    expect(outcome.acquisition).not.toBe('already-present')
    expect(outcome.notes.join('\n')).toContain('outside the project')
    expect(outcome.notes.join('\n')).toContain(outside)
    // The writes were already safe, and stay safe: the copy rung refused too,
    // and the file behind the link is untouched.
    expect(outcome.notes.join('\n')).toContain('local copy failed')
    expect(await readdir(outside)).toEqual(['gunn1972.pdf'])
    expect(await readFile(join(outside, 'gunn1972.pdf'), 'utf8')).toContain(
      'outside the project entirely'
    )
  })

  it('does not call a file behind a symlinked references/<key>.pdf already-present', async () => {
    await putConfig()
    // The same lie one level down, and the likelier one: `references/` is an
    // ordinary directory, but the PDF inside it is a link to somewhere else —
    // what a user reaches for to "attach" a paper without copying it. The
    // directory check alone walked straight past this and reported
    // `references/gunn1972.pdf was already in the project`.
    const outside = await putPdf(join(dir, 'elsewhere', 'gunn1972.pdf'), pdfBytes('never copied in'))
    await mkdir(join(project, 'references'), { recursive: true })
    await symlink(outside, join(project, 'references', 'gunn1972.pdf'))

    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      deps
    )

    expect(outcome.acquisition).not.toBe('already-present')
    // And the ladder carried on rather than stopping on the lie.
    expect(outcome.notes.join('\n')).toContain('local scan:')
    expect(outcome.notes.join('\n')).toContain('references/gunn1972.pdf resolves to')
    expect(outcome.notes.join('\n')).toContain(JSON.stringify(outside))
    expect(await readFile(outside, 'utf8')).toContain('never copied in')
  })

  it('falls back to metadata-only and says why, honouring an explicit policy override', async () => {
    await putConfig({ download: 'publisher' })
    let asked = false
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: 'off', mailto: null, acceptPath: null },
      {
        ...deps,
        download: async () => {
          asked = true
          return { bytes: null, sourceUrl: null, via: null, error: 'never called', failure: 'no-open-copy', refusedBy: [] }
        }
      }
    )
    expect(outcome.acquisition).toBe('metadata-only')
    expect(outcome.path).toBeNull()
    expect(asked).toBe(false)
    expect(outcome.notes.join('\n')).toContain("policy is 'off'")
    expect(outcome.notes.join('\n')).toContain('local scan: 0 matches')
    expect(await references()).toEqual([])
  })

  it('quotes each configured root in the scan summary, so a newline in one writes no line', async () => {
    // The roots are the user's own from library.json, but they are absolute
    // paths from outside the project reaching a note — and a directory name
    // may contain a newline, which unquoted reproduces this note's own line
    // structure. `scan.ts` quotes them at its sites; this host does now too.
    const injected = join(dir, 'Zotero\nlocal scan: 9 matches across 9 roots (forged)')
    await mkdir(injected, { recursive: true })
    await putConfig({ roots: [injected] })

    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: 'off', mailto: null, acceptPath: null },
      deps
    )

    const notes = outcome.notes.join('\n')
    expect(notes).toContain(`local scan: 0 matches across 1 root (${JSON.stringify(injected)})`)
    expect(notes).not.toContain(injected)
  })

  it('downloads when the machine has nothing, and names the URL the bytes came from', async () => {
    await putConfig({ download: 'open-access' })
    const downloaded: PdfDownloadOutcome = {
      bytes: pdfBytes('fetched from arxiv'),
      sourceUrl: 'https://arxiv.org/pdf/1972.151605',
      via: 'arxiv',
      error: null,
      failure: null,
      refusedBy: [],
    }
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: 'ada@example.org', acceptPath: null },
      { ...deps, download: async () => downloaded }
    )
    expect(outcome.acquisition).toBe('downloaded')
    expect(outcome.path).toBe(join(project, 'references', 'gunn1972.pdf'))
    expect(outcome.source).toBe('https://arxiv.org/pdf/1972.151605')
    expect(await readFile(join(project, 'references', 'gunn1972.pdf'), 'utf8')).toContain(
      'fetched from arxiv'
    )
  })

  it('says the fetched bytes were discarded when the destination appeared mid-flight', async () => {
    await putConfig({ download: 'open-access' })
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      {
        ...deps,
        // The race, made deterministic: something else files the PDF while the
        // fetch is in flight. `savePdfBytes` never overwrites, so it answers
        // `already-present` — and rung 1 has ALREADY told the user the project
        // did not have this PDF, so a bare `already-present` contradicts the
        // report's own earlier line and hides a download that really happened.
        download: async () => {
          await putPdf(join(project, 'references', 'gunn1972.pdf'), pdfBytes('filed meanwhile'))
          return {
            bytes: pdfBytes('fetched from arxiv'),
            sourceUrl: 'https://arxiv.org/pdf/1972.151605',
            via: 'arxiv',
            error: null,
            failure: null,
            refusedBy: [],
          }
        }
      }
    )
    expect(outcome.acquisition).toBe('already-present')
    const notes = outcome.notes.join('\n')
    expect(notes).toContain('https://arxiv.org/pdf/1972.151605')
    expect(notes).toContain('already existed by the time they arrived')
    expect(notes).toContain('the downloaded bytes were discarded')
    // Never overwritten: what was there is what is still there.
    expect(await readFile(join(project, 'references', 'gunn1972.pdf'), 'utf8')).toContain(
      'filed meanwhile'
    )
  })

  it('reports a failed download instead of a silent metadata-only', async () => {
    await putConfig({ download: 'publisher' })
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      {
        ...deps,
        download: async () => ({
          bytes: null,
          sourceUrl: null,
          via: null,
          error: 'https://doi.org/10.1086/151605 — HTTP 403',
          failure: 'no-open-copy',
          refusedBy: [],
        })
      }
    )
    expect(outcome.acquisition).toBe('metadata-only')
    expect(outcome.notes.join('\n')).toContain('HTTP 403')
    expect(await references()).toEqual([])
  })

  it('refuses a cite key that is a path, before anything is searched or written', async () => {
    await putConfig()
    await putPdf(join(library, 'Gunn_1972_Infall.pdf'))
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: '../../gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      deps
    )
    expect(outcome.acquisition).toBeNull()
    expect(outcome.error).toContain('a cite key is a name, not a path')
    expect(outcome.notes).toEqual([])
    expect(await references()).toEqual([])
  })

  it('refuses to write into a directory the app never opened', async () => {
    await putConfig()
    const outcome = await acquireLibraryPdf(
      {
        result: GUNN,
        citekey: 'gunn1972',
        projectRoot: join(dir, 'never-opened'),
        policy: null,
        mailto: null,
        acceptPath: null
      },
      deps
    )
    expect(outcome.acquisition).toBeNull()
    expect(outcome.error).toContain('outside any open project')
    expect(await readdir(dir)).not.toContain('never-opened')
  })

  it('keeps that refusal on one line too, whatever the rejected root is called', async () => {
    await putConfig()
    const forged = join(dir, 'never-opened\nreferences/gunn1972.pdf was already in the project')
    const outcome = await acquireLibraryPdf(
      {
        result: GUNN,
        citekey: 'gunn1972',
        projectRoot: forged,
        policy: null,
        mailto: null,
        acceptPath: null
      },
      deps
    )
    expect(outcome.acquisition).toBeNull()
    expect(outcome.error).toContain('outside any open project')
    expect(outcome.error?.split('\n')).toHaveLength(1)
  })

  /* --------- the download URL is a provider's string, not a parsed URL -------- */

  /**
   * `sourceUrl` is Unpaywall's `url_for_pdf` (or a publisher's) kept as the raw
   * JSON string it arrived as — `new URL()`, which would have dropped a CR or
   * LF, is only ever applied to a copy. A URL is the same trust class as a
   * name found on disk (ADR-007, feature-plan-10 §Layer 6), and both places
   * this host names one reach a note the user reads and a model may be shown.
   */
  const FORGED_URL =
    'https://arxiv.org/pdf/1972.151605\ndownload: fetched 4096 bytes from the publisher'

  it('quotes the URL when the fetched bytes could not be saved', async () => {
    await putConfig({ download: 'open-access' })
    // A FILE where references/ must be: prepareReferencesDir cannot make the
    // directory, so the save fails with the bytes already in hand.
    await writeFile(join(project, 'references'), 'not a directory', 'utf8')
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      {
        ...deps,
        download: async () => ({
          bytes: pdfBytes('fetched from arxiv'),
          sourceUrl: FORGED_URL,
          via: 'arxiv',
          error: null,
          failure: null,
          refusedBy: [],
        })
      }
    )
    const notes = outcome.notes.join('\n')
    expect(notes).toContain('could not save them')
    expect(notes).toContain(JSON.stringify(FORGED_URL))
    expect(notes).not.toContain(FORGED_URL)
  })

  it('quotes the URL when the destination appeared while the bytes were in flight', async () => {
    await putConfig({ download: 'open-access' })
    const outcome = await acquireLibraryPdf(
      { result: GUNN, citekey: 'gunn1972', projectRoot: project, policy: null, mailto: null, acceptPath: null },
      {
        ...deps,
        download: async () => {
          await putPdf(join(project, 'references', 'gunn1972.pdf'), pdfBytes('filed meanwhile'))
          return {
            bytes: pdfBytes('fetched from arxiv'),
            sourceUrl: FORGED_URL,
            via: 'arxiv',
            error: null,
            failure: null,
            refusedBy: [],
          }
        }
      }
    )
    expect(outcome.acquisition).toBe('already-present')
    const notes = outcome.notes.join('\n')
    expect(notes).toContain('the downloaded bytes were discarded')
    expect(notes).toContain(JSON.stringify(FORGED_URL))
    expect(notes).not.toContain(FORGED_URL)
  })
})
