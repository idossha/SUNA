import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A tripwire for one class of oversight: a path — or a URL, which is the same
 * trust class — interpolated into a model-visible line without going through
 * `quoteExternalPath` / `describeExternalError`.
 *
 * WHY A TEST AND NOT A CONVENTION. That invariant used to be held by hand at
 * about thirty call sites across scan.ts, config.ts and study.ts. Four review
 * passes over the finished, green feature each found more unescaped ones — 6,
 * then 5, then 2, then 6 — which is not a rate that converges, because nothing
 * made the rule hold. Every site those passes found was ordinary: someone
 * wrote a helpful error message, and the value in it happened to be a name
 * somebody else chose. This file is the thing that makes the next one fail
 * loudly instead of shipping. The fifth pass found no unescaped site in the
 * three files this gate already read, and four in the two it did not — which
 * is the argument for the guarded set below covering every file that makes the
 * claim, rather than every file in this package.
 *
 * WHAT IT IS NOT. It is a regex over source text, not a parser. It does not
 * know types, it cannot follow a value through a variable (hoist an escaped
 * value into a `const note` and the gate sees only `note`), and it decides
 * "this looks like a path" from the *spelling* of the expression. That is
 * accepted deliberately: the cost of a miss is one more review pass, and the
 * cost of a false alarm is one allow-list line with a reason on it. What it
 * buys is that the ordinary way of getting this wrong — writing
 * `${somePath}` — cannot reach main unnoticed.
 *
 * WHAT IT STILL MISSES, said out loud rather than discovered later. Three
 * limits are known and left in, because closing them needs a parser and this
 * is a tripwire:
 *
 * - A concatenation broken across lines. `\`…\` +` with its second operand on
 *   the next line is a real shape in `scan.ts`; rule 4 reads one line at a
 *   time, so it does not see it. The single-line form —
 *   `lines.push('skipped ' + filePath)`, equally natural in files that build
 *   reports with `push`, which all of these do — is covered.
 * - A thrown value bound to a name without `err` in it. Rules 2 and 3 decide
 *   "this is an error" from spelling, exactly as rule 1 decides "this is a
 *   path"; `catch (e) { … e.message … }` reads as clean.
 * - Any value laundered through a variable, which is the general form of both:
 *   `const note = filePath` then `${note}`. Rules 2, 3 and 4 are checked per
 *   call site rather than per interpolation precisely because that hoist was a
 *   live shape here (`expandRoots`), but rule 1 remains interpolation-shaped.
 *
 * Each of these was found by mutating the gate and watching it stay green, and
 * each is a miss rather than a false pass on real code: the guarded files are
 * clean under a hand read as well.
 *
 * THE ALLOW-LIST IS THE POINT. Not every path-ish expression must be escaped;
 * `REFERENCES_DIR` is this codebase's own constant. But the exemption has to
 * be a decision somebody made and signed, not an oversight nobody noticed, so
 * each one is named below with a one-line reason. Adding an entry is cheap and
 * visible in review; forgetting to escape is neither.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** `packages/agent/src` → the monorepo root, so a file outside this package can be read. */
const REPO = join(HERE, '..', '..', '..')

/**
 * The files whose notes and errors reach a model or the user, by label.
 *
 * The desktop host is in here even though it lives in another workspace
 * package. It is the SECOND host of the same acquisition ladder: it builds the
 * same `notes` array out of the same values, hands it to the same renderer,
 * and an agent asked about a reference reads it. A rule that stopped at the
 * package boundary would be a rule about a directory rather than about where
 * outside values go, and that is precisely the shape of exemption ARCHITECTURE §9
 * argues against — the file spent one release "outside the rule" and grew a
 * local `describeError` and two raw URLs in the meantime.
 */
const GUARDED: Record<string, string> = {
  'library/scan.ts': join(HERE, 'library', 'scan.ts'),
  'library/config.ts': join(HERE, 'library', 'config.ts'),
  'mcp/lit.ts': join(HERE, 'mcp', 'lit.ts'),
  'mcp/study.ts': join(HERE, 'mcp', 'study.ts'),
  'apps/desktop/src/main/services/library.ts': join(
    REPO,
    'apps',
    'desktop',
    'src',
    'main',
    'services',
    'library.ts'
  )
}

/**
 * An expression is "path-ish" when any identifier in it contains one of these,
 * case-insensitively. Deliberately over-eager — `renameError` trips on `name`
 * — because a miss is a defect and a false alarm is an allow-list line.
 *
 * `url` is in the list on purpose. A URL is not a filesystem path, but it is
 * the same trust class: `sourceUrl` is Unpaywall's `url_for_pdf` kept as the
 * raw JSON string it arrived as, and `openAccessUrl` is a provider record's
 * string. Neither has been through `new URL()`, which is the thing that would
 * have dropped a newline, and both land on a line a model reads.
 */
const PATH_WORDS = [
  'path',
  'dir',
  'root',
  'file',
  'name',
  'target',
  'relative',
  'absolute',
  'configured',
  'claimant',
  'url',
  'source'
]

/** The two functions that make an outside value safe to interpolate. */
const ESCAPERS = ['quoteExternalPath', 'describeExternalError']

interface Allowed {
  /** The interpolated expression, exactly as written (whitespace collapsed). */
  expression: string
  /**
   * Optional: only exempt occurrences whose surrounding template literal
   * contains this text. It is what keeps one safe use of an expression from
   * silently exempting an unsafe one elsewhere in the same file.
   */
  within?: string
  /** Why this one needs no escaping. One line, and it has to be true. */
  why: string
}

const ALLOW_LIST: Record<string, Allowed[]> = {
  'library/scan.ts': [
    {
      expression: 'REFERENCES_DIR',
      why: "this module's own constant, the literal 'references'"
    },
    {
      expression: 'destination.relative',
      why: '`references/<key>.pdf`, composed here from the cite key the caller named'
    },
    {
      expression: 'destination.absolute',
      why: 'the same path in absolute form, composed here and not read off a disk'
    },
    {
      expression: 'surname',
      why: 'an author surname, already through quoteSpotlightValue, and this is an mdfind argv value rather than a note'
    }
  ],
  'library/config.ts': [
    // `path` — libraryConfigPath(env) — used to be exempt here, on the true
    // ground that it is this process's own config location. It is quoted now
    // and the entry is gone: $SUNA_CONFIG_DIR is an environment variable and a
    // home directory is a directory name, so both can hold a newline, and
    // ARCHITECTURE §15.5 makes the opposite call for the sibling case (the library roots
    // are quoted even though the user typed them, "so the rule has no
    // exception a later reader has to remember"). Two readings of one rule is
    // the thing that produced the defects this file exists to stop.
    {
      expression: "issue.path.join('.') || '(root)'",
      why: "a Zod issue path (schema keys such as `roots.0`), not a filesystem path"
    }
  ],
  'mcp/lit.ts': [
    {
      expression: 'result.source',
      why: "not a path — the provider id ('crossref', 'openalex', …), a fixed union from @suna/core"
    }
  ],
  'apps/desktop/src/main/services/library.ts': [
    {
      expression: 'REFERENCES_DIR',
      why: "this module's own constant, the literal 'references'"
    },
    {
      expression: 'destination.relative',
      why: '`references/<key>.pdf`, composed here from the cite key the caller named'
    },
    {
      expression: 'saved.relativePath',
      why: '`references/<key>.pdf` as savePdfBytes composed it, not a name read off a disk'
    },
    {
      expression: 'roots',
      why: 'the joined summary three lines above, whose every element went through quoteExternalPath'
    }
  ],
  'mcp/study.ts': [
    {
      expression: 'name',
      within: 'references/${name}',
      why: 'builds the listing handed to resolvePdfPath, not a report line; the hit it produces is quoted where it is reported'
    },
    {
      expression: 'roots',
      why: 'the joined summary two lines above, whose every element went through quoteExternalPath'
    },
    {
      expression: 'saved.relativePath',
      why: '`references/<key>.pdf` as savePdfBytes composed it, not a name read off a disk'
    },
    {
      expression: 'outcome.relativePath',
      within: 'copied-local',
      why: 'the destination importPdfIntoProject composed, `references/<key>.pdf` (the already-present arm, which is a readdir entry, is quoted)'
    },
    {
      expression: 'outcome.relativePath',
      within: 'downloaded',
      why: 'the destination savePdfBytes composed, `references/<key>.pdf`'
    },
    {
      expression: 'target.label',
      why: 'not a path — the resolved study, whose label is provider metadata (the trust class formatMatch names as the different one)'
    },
    {
      expression: 'target.key',
      why: "not a path — a cite key out of the project's own references.bib"
    },
    {
      expression: 'result.source',
      why: "not a path — the provider id ('crossref', 'openalex', …), a fixed union from @suna/core"
    }
  ]
}

/**
 * The only lines that may handle a thrown value raw (rules 2 and 3). All of
 * them are in config.ts, and all of them are the escaper's own plumbing:
 * `describeExternalError` has to reach the underlying message somewhere, and
 * this is that somewhere.
 */
const RAW_ERROR_SITES: Record<string, { line: string; why: string }[]> = {
  'library/config.ts': [
    {
      line: 'export function describeError(error: unknown): string {',
      why: 'the definition of the raw describer that describeExternalError wraps'
    },
    {
      line: 'if (error instanceof Error) return error.message',
      why: "that definition's body — the one hand-rolled description in the codebase"
    },
    {
      line: 'return String(error)',
      why: "the same body's non-Error arm"
    },
    {
      line: 'return describeError(error)',
      why: "describeExternalError's own base call — the one place the raw message is wanted"
    }
  ]
}

/**
 * Rules 2 and 3, as spellings. Each is a way of getting at a thrown value's
 * text without `describeExternalError`, and an errno message quotes the path
 * it failed on — `ENOENT: …, open '<path>'` — so every one of them can put an
 * outside name into a line the escaping was meant to keep clean.
 *
 * These are checked per LINE, not per interpolation, and that is the whole
 * point. Rule 3 was made call-site-wide because "rule 1 on its own is one
 * hoist away from silence"; the hand-rolled description has the identical
 * hole. `const why = error instanceof Error ? error.message : String(error)`
 * on one line and `${why}` on the next reads as two innocent statements, and
 * an earlier draft of this gate — which only matched the full ternary INSIDE a
 * template — reported nothing for it, nor for `${String(error)}`, nor for
 * `${error.message}`. Mutation-testing the gate is how that was found; the fix
 * is to ban the spellings outright and list the plumbing above.
 *
 * "A thrown value" is decided from spelling, like everything else here: a
 * receiver or argument whose name contains `err`. A catch bound to `e` is a
 * miss, and the doc comment at the top says why that trade is accepted.
 */
const RAW_ERROR_RULES: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bdescribeError\s*\(/,
    reason:
      'call describeExternalError — describeError is the raw errno message, and it names the path it failed on'
  },
  {
    pattern: /\binstanceof\s+Error\b/,
    reason:
      'describing a thrown value by hand — call describeExternalError, which also strips the control characters an errno message can carry out of a file name'
  },
  {
    pattern: /\bString\s*\(\s*[\w$.]*err[\w$.]*\s*\)/i,
    reason:
      'String(error) is the raw message — call describeExternalError, which also strips the control characters an errno message can carry out of a file name'
  },
  {
    pattern: /\b[\w$.]*err[\w$.]*\.message\b/i,
    reason:
      '.message is the raw errno text, and it quotes the path it failed on — call describeExternalError'
  }
]

/* ------------------------------------------------------------- the scanner -- */

interface Interpolation {
  /** The `${…}` expression, source order, nested ones listed separately. */
  expression: string
  /** The template literal it sits in, so an allow-list `within` can match. */
  template: string
  line: number
}

/**
 * Every `${…}` in a real template literal, comments and ordinary strings
 * excluded, nested templates recursed into so an escaped outer expression
 * cannot hide an unescaped inner one.
 *
 * The lexer is the crude part: it tracks quotes, comments and template nesting
 * and guesses at regex literals from the previous significant character. It is
 * right on the guarded files, and a file it is wrong on will report a bogus
 * violation rather than stay quiet — the failure mode a tripwire should have.
 */
export function interpolationsOf(source: string): Interpolation[] {
  const found: Interpolation[] = []
  type Frame =
    | { kind: 'code'; depth: number; expressionStart: number | null; templateStart: number }
    | { kind: 'template'; start: number }
  const stack: Frame[] = [{ kind: 'code', depth: 0, expressionStart: null, templateStart: -1 }]
  let index = 0
  let previous = ''

  const lineOf = (at: number): number => source.slice(0, at).split('\n').length

  while (index < source.length) {
    const frame = stack[stack.length - 1]
    if (frame === undefined) break
    const character = source[index] ?? ''
    const next = source[index + 1] ?? ''

    if (frame.kind === 'template') {
      if (character === '\\') {
        index += 2
        continue
      }
      if (character === '`') {
        stack.pop()
        index += 1
        previous = '`'
        continue
      }
      if (character === '$' && next === '{') {
        stack.push({
          kind: 'code',
          depth: 0,
          expressionStart: index + 2,
          templateStart: frame.start
        })
        index += 2
        previous = ''
        continue
      }
      index += 1
      continue
    }

    // Inside code: the top level, or the inside of a `${…}`.
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }
    if (character === '/' && (previous === '' || /[=(,:[!&|?{};+\-*%<>~^]/.test(previous))) {
      index += 1
      while (index < source.length) {
        const inside = source[index]
        if (inside === '\\') {
          index += 2
          continue
        }
        if (inside === '[') {
          while (index < source.length && source[index] !== ']') {
            if (source[index] === '\\') index += 1
            index += 1
          }
        }
        if (inside === '/' || inside === '\n') break
        index += 1
      }
      index += 1
      while (index < source.length && /[dgimsuvy]/.test(source[index] ?? '')) index += 1
      previous = '/'
      continue
    }
    if (character === "'" || character === '"') {
      index += 1
      while (index < source.length && source[index] !== character) {
        if (source[index] === '\\') index += 1
        index += 1
      }
      index += 1
      previous = character
      continue
    }
    if (character === '`') {
      stack.push({ kind: 'template', start: index })
      index += 1
      continue
    }
    if (character === '{') {
      frame.depth += 1
      index += 1
      previous = character
      continue
    }
    if (character === '}') {
      if (frame.depth === 0 && frame.expressionStart !== null) {
        const templateEnd = closingBacktick(source, frame.templateStart)
        found.push({
          expression: source.slice(frame.expressionStart, index),
          template: source.slice(frame.templateStart, templateEnd),
          line: lineOf(frame.expressionStart)
        })
        stack.pop()
        index += 1
        previous = character
        continue
      }
      frame.depth -= 1
      index += 1
      previous = character
      continue
    }
    if (!/\s/.test(character)) previous = character
    index += 1
  }

  return found.sort((a, b) => a.line - b.line)
}

/** The end of the template literal that starts at `start`, nesting included. */
function closingBacktick(source: string, start: number): number {
  let index = start + 1
  let depth = 0
  while (index < source.length) {
    const character = source[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === '$' && source[index + 1] === '{') {
      depth += 1
      index += 2
      continue
    }
    if (character === '}' && depth > 0) {
      depth -= 1
      index += 1
      continue
    }
    if (character === '`' && depth === 0) return index + 1
    index += 1
  }
  return source.length
}

/**
 * What is left of an expression once everything that cannot carry an outside
 * value out to the reader is removed. Each rule is a claim about the language,
 * not a convenience:
 *
 * - a `quoteExternalPath(…)` / `describeExternalError(…)` call is escaped;
 * - `xs.map(x => <escaped>)` escapes every element, so it takes its receiver;
 * - a `=== null` style test is control flow — none of the value reaches the
 *   output through it;
 * - `.length` is a count, never a path;
 * - a string or a nested template contributes nothing of its own (a nested
 *   template's `${…}` is reported and checked separately).
 */
function residueOf(expression: string): string {
  let residue = expression
  for (const escaper of ESCAPERS) {
    let at = residue.indexOf(`${escaper}(`)
    while (at !== -1) {
      const end = closingParen(residue, at + escaper.length + 1)
      residue = `${residue.slice(0, at)} ESCAPED ${residue.slice(end + 1)}`
      at = residue.indexOf(`${escaper}(`)
    }
  }
  residue = residue.replace(
    /[A-Za-z_$][\w$.]*\.map\(\s*\(?\s*[\w$]*\s*\)?\s*=>\s*ESCAPED\s*\)/g,
    ' ESCAPED '
  )
  residue = residue.replace(/[A-Za-z_$][\w$.]*\s*[=!]==?\s*(null|undefined)/g, ' TEST ')
  residue = residue.replace(/[A-Za-z_$][\w$.]*\.length\b/g, ' COUNT ')
  residue = residue.replace(/'(\\.|[^'\\])*'|"(\\.|[^"\\])*"|`(\\.|[^`\\])*`/g, ' TEXT ')
  return residue
}

function closingParen(text: string, start: number): number {
  let depth = 1
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    else if (text[index] === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return text.length
}

interface Violation {
  file: string
  line: number
  /**
   * Whether `expression` is something that sat in a `${…}` or a whole line of
   * code. The report prints them differently, because printing a statement
   * wrapped in `${…}` — which this file used to do for every rule-3 hit, the
   * rule most likely to fire — is a failure message that reads as nonsense.
   */
  kind: 'interpolation' | 'statement'
  expression: string
  reason: string
}

/** The path-ish identifier in `residue`, or undefined. Spelling decides, as everywhere here. */
function pathishIn(residue: string): string | undefined {
  const identifiers = residue.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []
  return identifiers.find((identifier) =>
    PATH_WORDS.some((word) => identifier.toLowerCase().includes(word))
  )
}

/**
 * Rule 4: `'skipped ' + filePath`.
 *
 * `interpolationsOf` sees template literals and nothing else, so a report line
 * built with `+` was invisible to this gate — and that is not a theoretical
 * shape: both `mcp/study.ts` and the desktop `library.ts` assemble their
 * reports with `lines.push(…)` / `notes.push(…)`, where either spelling is
 * equally natural and reaches the same reader.
 *
 * The test is: on a line whose literals have been reduced to `TEXT`, does a
 * `+` sit between a literal and a path-ish identifier? `'a' + quoted` is fine
 * (the escaper's result is `ESCAPED`, which carries no path word), and
 * `realRoot + sep` is not flagged because neither side is a literal — that one
 * is an argument to `startsWith`, not a sentence.
 *
 * KNOWN LIMIT, stated rather than papered over: this looks at one line at a
 * time, so a concatenation broken across lines — `\`…\` +` with its second
 * operand on the next line, which `scan.ts` really does — is not examined.
 * Covering it needs the operands, and getting operands needs a parser; this
 * file is a tripwire and says so at the top. The reachable single-line shape
 * is closed, and the multi-line one still has rule 1 on whatever `${…}` its
 * template halves contain.
 */
function concatenatedPath(code: string): string | undefined {
  const residue = residueOf(code)
  const patterns = [
    /(?:TEXT|ESCAPED)\s*\+\s*([A-Za-z_$][\w$.]*)/g,
    /([A-Za-z_$][\w$.]*)\s*\+\s*(?:TEXT|ESCAPED)/g
  ]
  for (const pattern of patterns) {
    for (const match of residue.matchAll(pattern)) {
      const operand = match[1] ?? ''
      const pathish = pathishIn(operand)
      if (pathish !== undefined) return operand
    }
  }
  return undefined
}

/**
 * Four rules, one allow-list.
 *
 * 1. A path-ish expression interpolated into a template must go through an
 *    escaper.
 * 2. A thrown value is never described by hand — no `instanceof Error`, no
 *    `String(error)`, no `error.message`. An errno message quotes the path it
 *    failed on (`ENOENT: …, realpath '<path>'`), so it breaks the line from
 *    inside the error text even when the path beside it was escaped.
 * 3. `describeError` is not CALLED at all in these files.
 * 4. A path-ish value concatenated onto a string literal is a report line too,
 *    even though no template is involved.
 *
 * Rules 2, 3 and 4 are checked per line rather than per interpolation, because
 * checking only the interpolation is one hoist away from silence: `const why =
 * describeError(e)` on one line and `${why}` on the next reads as two innocent
 * statements, and that is exactly the shape config.ts's `expandRoots` had.
 * Making the escapers the only entry point makes the hoist harmless.
 */
export function violationsIn(label: string, source: string, allowed: Allowed[]): Violation[] {
  const violations: Violation[] = []
  source.split('\n').forEach((text, offset) => {
    const code = text.trim()
    // Comment lines are prose about the rule, not uses of it.
    if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return
    if ((RAW_ERROR_SITES[label] ?? []).some((site) => site.line === code)) return

    // At most one per line: the first is enough to send a reader to the line,
    // and a fix for it is a fix for whatever else it was hiding.
    const raw = RAW_ERROR_RULES.find((rule) => rule.pattern.test(code))
    if (raw !== undefined) {
      violations.push({
        file: label,
        line: offset + 1,
        kind: 'statement',
        expression: code,
        reason: raw.reason
      })
      return
    }

    const joined = concatenatedPath(code)
    if (joined === undefined) return
    const exempt = allowed.some(
      (entry) =>
        entry.expression === joined && (entry.within === undefined || code.includes(entry.within))
    )
    if (exempt) return
    violations.push({
      file: label,
      line: offset + 1,
      kind: 'statement',
      expression: code,
      reason: `\`${joined}\` looks like a path or a URL and is concatenated onto a string — wrap it in quoteExternalPath(…), or add it to ALLOW_LIST in this file with a reason`
    })
  })
  for (const found of interpolationsOf(source)) {
    const expression = found.expression.replace(/\s+/g, ' ').trim()
    const exempt = allowed.some(
      (entry) =>
        entry.expression === expression &&
        (entry.within === undefined || found.template.includes(entry.within))
    )
    if (exempt) continue

    const pathish = pathishIn(residueOf(found.expression))
    if (pathish !== undefined) {
      violations.push({
        file: label,
        line: found.line,
        kind: 'interpolation',
        expression,
        reason: `\`${pathish}\` looks like a path or a URL — wrap it in quoteExternalPath(…), or add it to ALLOW_LIST in this file with a reason`
      })
    }
  }
  return violations.sort((a, b) => a.line - b.line)
}

/**
 * The failure message: file, line and offending text, so the fix is obvious.
 *
 * An interpolation is printed back as `${…}` because that is how it is
 * written; a whole statement is printed as itself. Wrapping a statement in
 * `${…}` — `${const why = describeError(error)}` — is not a thing anybody can
 * search for, and rule 2/3/4 hits are all statements.
 */
function report(violations: Violation[]): string {
  return violations
    .map((violation) => {
      const shown =
        violation.kind === 'interpolation' ? `\${${violation.expression}}` : violation.expression
      return `${violation.file}:${violation.line}  ${shown}\n    ${violation.reason}`
    })
    .join('\n')
}

/* ----------------------------------------------------------------- the gate -- */

describe('every externally-sourced path reaches a report escaped', () => {
  for (const [label, file] of Object.entries(GUARDED)) {
    it(`${label} interpolates no unescaped path`, () => {
      const source = readFileSync(file, 'utf8')
      const violations = violationsIn(label, source, ALLOW_LIST[label] ?? [])
      expect(report(violations)).toBe('')
    })
  }

  it('every exemption names a guarded file', () => {
    // An allow-list or raw-error entry for a file nobody scans is an exemption
    // from nothing — it reads as a decision and does not hold one.
    const keys = [...Object.keys(ALLOW_LIST), ...Object.keys(RAW_ERROR_SITES)]
    for (const label of keys) {
      expect(Object.keys(GUARDED)).toContain(label)
    }
  })

  it('every allow-list entry still matches something, and says why', () => {
    // An entry that no longer matches is an exemption granted to code that has
    // moved on: it must be re-read, not left standing.
    for (const [label, entries] of Object.entries(ALLOW_LIST)) {
      const file = GUARDED[label]
      expect(file).toBeDefined()
      const source = readFileSync(file ?? '', 'utf8')
      const interpolations = interpolationsOf(source)
      for (const entry of entries) {
        const matched = interpolations.some(
          (found) =>
            found.expression.replace(/\s+/g, ' ').trim() === entry.expression &&
            (entry.within === undefined || found.template.includes(entry.within))
        )
        const found = `${label}: \${${entry.expression}}${entry.within === undefined ? '' : ` within ${entry.within}`}`
        expect(matched ? found : `${found} — MATCHES NOTHING, so re-read it`).toBe(found)
        // An exemption without a reason on it is the thing this file exists to
        // prevent, so an empty `why` is a failure like any other.
        expect(entry.why.trim().length).toBeGreaterThan(20)
      }
    }
  })

  it('every raw-error exemption still matches a line, and says why', () => {
    // Same reasoning one rule over: a line that has been edited or deleted
    // leaves an exemption standing over code that no longer exists.
    for (const [label, sites] of Object.entries(RAW_ERROR_SITES)) {
      const lines = readFileSync(GUARDED[label] ?? '', 'utf8')
        .split('\n')
        .map((text) => text.trim())
      for (const site of sites) {
        const found = `${label}: ${site.line}`
        expect(lines.includes(site.line) ? found : `${found} — MATCHES NOTHING, so re-read it`).toBe(
          found
        )
        expect(site.why.trim().length).toBeGreaterThan(20)
      }
    }
  })
})

/* -------------------------------------------------------- the gate bites -- */

/**
 * The tests above pass when the sources are clean, which is also what they
 * would do if the scanner were broken. These are the ones that show it is not.
 */
describe('the source lint itself', () => {
  const check = (source: string, allowed: Allowed[] = []): Violation[] =>
    violationsIn('fixture.ts', source, allowed)

  it('fails on an unescaped path interpolation', () => {
    const violations = check('const note = `could not read ${filePath}`')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.line).toBe(1)
    expect(violations[0]?.expression).toBe('filePath')
    expect(violations[0]?.reason).toContain('filePath')
  })

  it('passes the same line once it is escaped', () => {
    expect(check('const note = `could not read ${quoteExternalPath(filePath)}`')).toEqual([])
  })

  it('fails on the realpath pair this pass found raw in scan.ts', () => {
    const source =
      'const no = `refusing to write ${destination.relative}: resolves to ${realDirectory}, outside ${realRoot}`'
    expect(check(source).map((violation) => violation.expression)).toEqual([
      'destination.relative',
      'realDirectory',
      'realRoot'
    ])
  })

  it('fails on describeError inside a template, and passes on describeExternalError', () => {
    expect(check('const no = `could not stat (${describeError(error)})`')).toHaveLength(1)
    expect(check('const no = `could not stat (${describeExternalError(error)})`')).toEqual([])
    expect(check('const no = `${error instanceof Error ? error.message : String(error)}`')).toHaveLength(1)
    // Rule 3: the hoist out of the template is caught too.
    expect(check('const why = describeError(error)\nconst no = `skipped: ${why}`')).toHaveLength(1)
  })

  it('fails on every hand-rolled way of describing a thrown value, not just the full ternary', () => {
    // The hole mutation-testing found: rule 2 used to match only the complete
    // `error instanceof Error ? … : String(error)` spelling INSIDE a template,
    // so each of these returned nothing at all — and each puts the same errno
    // message, which quotes the path it failed on, into the same sentence.
    expect(check('const no = `could not stat (${String(error)})`')).toHaveLength(1)
    expect(check('const no = `could not stat (${error.message})`')).toHaveLength(1)
    expect(check('const no = `could not stat (${copyError.message})`')).toHaveLength(1)
    // And the hoist, which is what made rule 3 call-site-wide in the first place.
    const hoisted = 'const why = error instanceof Error ? error.message : String(error)\nconst no = `skipped: ${why}`'
    expect(check(hoisted)).toHaveLength(1)
    expect(check(hoisted)[0]?.line).toBe(1)
    // The escaper is still the way through, and an unrelated String() is not
    // an error at all — `String(result.year)` is live in mcp/lit.ts.
    expect(check('const no = `could not stat (${describeExternalError(error)})`')).toEqual([])
    expect(check("const year = result.year !== null ? String(result.year) : 'n.d.'")).toEqual([])
  })

  it('fails on a path concatenated onto a string, where no template is involved', () => {
    // `interpolationsOf` sees templates only, and both mcp/study.ts and the
    // desktop library.ts build their reports with push(…) — so this shape
    // reaches the same reader by a route the lexer does not walk.
    const violations = check("lines.push('skipped ' + filePath)")
    expect(violations).toHaveLength(1)
    expect(violations[0]?.reason).toContain('filePath')
    expect(check("lines.push(filePath + ' was skipped')")).toHaveLength(1)
    // Escaped is fine, and two non-literal operands are not a report line —
    // `realRoot + sep` is an argument to startsWith, live in library.ts.
    expect(check("lines.push('skipped ' + quoteExternalPath(filePath))")).toEqual([])
    expect(check('return path.startsWith(realRoot + sep)')).toEqual([])
  })

  it('prints a statement violation as the statement, not wrapped in ${…}', () => {
    // The rule most likely to fire is the one whose failure message was
    // nonsense: a whole line rendered as `${const why = describeError(error)}`
    // is not something a reader can search for.
    const violations = check('const why = describeError(error)')
    expect(violations[0]?.kind).toBe('statement')
    expect(report(violations)).toContain('fixture.ts:1  const why = describeError(error)')
    expect(report(violations)).not.toContain('${const why')
    // An interpolation is still shown the way it is written.
    const interpolated = check('const note = `could not read ${filePath}`')
    expect(interpolated[0]?.kind).toBe('interpolation')
    expect(report(interpolated)).toContain('${filePath}')
  })

  it('sees through a nested template, where an outer escape can hide an inner miss', () => {
    const source = 'const line = `appended${x === null ? `` : ` with file = ${x.filePath}`}`'
    expect(check(source).map((violation) => violation.expression)).toEqual(['x.filePath'])
  })

  it('accepts an array whose every element goes through the escaper', () => {
    expect(check('const s = `roots (${found.rootsSearched.map((root) => quoteExternalPath(root)).join(", ")})`')).toEqual([])
  })

  it('accepts a count and a null test, which carry none of the value', () => {
    expect(check('const s = `${found.rootsSearched.length} roots`')).toEqual([])
    expect(check('const s = `${outcome.sourceUrl === null ? "none" : quoteExternalPath(outcome.sourceUrl)}`')).toEqual([])
  })

  it('ignores template syntax inside comments and ordinary strings', () => {
    expect(check('// a note about `${somePath}` in a comment\nconst x = 1')).toEqual([])
    expect(check('/** doc: `${somePath}` */\nconst x = 1')).toEqual([])
    expect(check('const x = "not a template ${somePath}"')).toEqual([])
  })

  it('exempts only what the allow-list names, and only where it names it', () => {
    const source = [
      'const a = `already-present — ${outcome.relativePath}`',
      'const b = `copied-local — ${outcome.relativePath}`'
    ].join('\n')
    const allowed: Allowed[] = [
      { expression: 'outcome.relativePath', within: 'copied-local', why: 'composed here from the cite key' }
    ]
    expect(check(source, allowed).map((violation) => violation.line)).toEqual([1])
  })
})
