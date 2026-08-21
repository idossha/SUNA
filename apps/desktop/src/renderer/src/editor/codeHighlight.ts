import { StreamLanguage } from '@codemirror/language'
import { highlightCode, type Highlighter } from '@lezer/highlight'
import type { Parser } from '@lezer/common'
import { jsonLanguage } from '@codemirror/lang-json'
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { pythonLanguage } from '@codemirror/lang-python'
import { c, cpp } from '@codemirror/legacy-modes/mode/clike'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { fortran } from '@codemirror/legacy-modes/mode/fortran'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { octave } from '@codemirror/legacy-modes/mode/octave'
import { r } from '@codemirror/legacy-modes/mode/r'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { standardSQL } from '@codemirror/legacy-modes/mode/sql'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { bibStreamParser } from './bibLang'

/**
 * Syntax colour for a fenced code block in reading mode.
 *
 * There is no hand-written tokeniser here and there must never be one: the
 * app already embeds CodeMirror, so a fence is coloured by the very parsers
 * the source view uses — a Lezer grammar where one is installed, a legacy
 * stream mode otherwise — through @lezer/highlight's `highlightCode`. The
 * colours come from themes.ts's HighlightStyle, which is what makes reading
 * mode agree with the source view under every editor theme for free.
 *
 * Adding a language is one import and one alias row below; nothing else in
 * the pipeline knows a language exists.
 */

/** Every mode is behind a thunk so a fence in one language never parses the
 *  grammars of the others (StreamLanguage.define builds a parser eagerly). */
type ParserSource = () => Parser

const lezer = (language: { parser: Parser }): ParserSource => () => language.parser
const stream = (mode: Parameters<typeof StreamLanguage.define>[0]): ParserSource => {
  let cached: Parser | undefined
  return () => (cached ??= StreamLanguage.define(mode).parser)
}

/**
 * Info string -> parser. Keys are lowercase; the aliases are the ones people
 * actually type in a fence, and an unlisted language is not an error — it
 * renders as plain monospace text, exactly as it did before colour existed.
 */
const LANGUAGES: Record<string, ParserSource> = (() => {
  const python = lezer(pythonLanguage)
  const js = lezer(javascriptLanguage)
  const ts = lezer(typescriptLanguage)
  const json = lezer(jsonLanguage)
  const md = lezer(markdownLanguage)
  const bib = stream(bibStreamParser)
  const sh = stream(shell)
  const rlang = stream(r)
  const yml = stream(yaml)
  const latex = stream(stex)
  const f = stream(fortran)
  const jl = stream(julia)
  const m = stream(octave)
  const cpp2 = stream(cpp)
  const patch = stream(diff)
  return {
    python,
    py: python,
    python3: python,
    javascript: js,
    js,
    node: js,
    mjs: js,
    typescript: ts,
    ts,
    jsx: lezer(jsxLanguage),
    tsx: lezer(tsxLanguage),
    json,
    jsonc: json,
    markdown: md,
    md,
    bibtex: bib,
    bib,
    bash: sh,
    sh,
    shell: sh,
    zsh: sh,
    console: sh,
    r: rlang,
    rscript: rlang,
    yaml: yml,
    yml,
    toml: stream(toml),
    sql: stream(standardSQL),
    latex,
    tex: latex,
    fortran: f,
    f90: f,
    julia: jl,
    jl,
    matlab: m,
    octave: m,
    c: stream(c),
    cpp: cpp2,
    'c++': cpp2,
    diff: patch,
    patch
  }
})()

/**
 * Above this many characters a fence renders as plain text. Lezer parses far
 * more than this comfortably, but a code block is re-highlighted on every
 * widget rebuild, and a manuscript has no business carrying a 200 kB listing
 * inline — the cap is a guard against one pathological fence, not a budget.
 */
const MAX_HIGHLIGHTED = 200_000

/** The set of info strings that get colour — exported so a test can assert coverage. */
export function supportedCodeLanguages(): string[] {
  return Object.keys(LANGUAGES).sort()
}

export interface CodeToken {
  text: string
  /** Highlighter classes for this run, or '' for unstyled text and line breaks. */
  classes: string
}

/**
 * Tokenise `code` for `lang`, or null when nothing here can parse it (the
 * caller then renders plain text). Line breaks come back as their own `\n`
 * token, so the caller never has to re-split the text it was given.
 *
 * Pure and DOM-free, which is what lets it be tested — apps/desktop has no
 * DOM test environment (see editor/keymap.test.ts).
 */
export function tokenizeCode(
  code: string,
  lang: string | undefined,
  highlighter: Highlighter
): CodeToken[] | null {
  if (lang === undefined || code.length > MAX_HIGHLIGHTED) return null
  const source = LANGUAGES[lang.toLowerCase()]
  if (source === undefined) return null
  let parser: Parser
  try {
    parser = source()
  } catch {
    return null
  }
  const tokens: CodeToken[] = []
  try {
    highlightCode(
      code,
      parser.parse(code),
      highlighter,
      (text, classes) => tokens.push({ text, classes }),
      () => tokens.push({ text: '\n', classes: '' })
    )
  } catch {
    // A grammar that throws must cost the reader colour, not the block.
    return null
  }
  return tokens
}
