import {
  MathFraction,
  MathIntegral,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  XmlComponent,
  type MathComponent
} from 'docx'

/**
 * LaTeX → OMML (Office Math) conversion for the DOCX exporter, over the
 * `docx` library's math objects (Math/MathRun/MathFraction/…, which serialize
 * to `<m:oMath>` structures Word typesets natively).
 *
 * This is a STRICT, all-or-nothing subset converter: `texToMath` returns the
 * component list for an equation it understands COMPLETELY, and `null` the
 * moment it meets any token it does not — an unknown macro, an unmatched
 * brace, an environment, an alignment `&`, a `\\` line break. The caller
 * (export-docx.ts) falls back to the pre-existing italic-literal rendering on
 * `null`, so an unsupported equation degrades exactly as every equation did
 * before this module existed, never to a half-typeset hybrid. Robustness
 * beats coverage by design: extending the subset means adding to the maps
 * and cases below, never loosening the failure rule.
 *
 * Accepted subset:
 * - latin letters and digits (Word italicizes math letters natively),
 *   `+ - = < > / ( ) [ ] | , . !` and decimal numbers
 * - `\frac{..}{..}` (nested), `\sqrt{..}`
 * - `^{..}` / `_{..}` / combined, plus single-token forms (`x^2`, `x_\ast`)
 * - greek letters (`\alpha`…`\Omega`, plus the `\var…` forms) as Unicode
 * - symbol macros: `\times \pm \mp \leq \geq \neq \approx \sim \propto
 *   \cdot \infty \partial \nabla \degree \circ \prime \ast \AA` (with
 *   `\le/\ge/\ne` as the standard aliases)
 * - `\sum` / `\int` with optional `_{}^{}` limits (docx's n-ary objects);
 *   `\prod` is REJECTED — docx@9.7 ships no product n-ary and drawing a ∑
 *   in its place would misrender
 * - `\text{..}` / `\mathrm{..}` as upright runs (`m:nor`, hand-built below
 *   because the library's MathRun exposes no run style)
 * - spacing macros `\,` `\;` `\quad` as Unicode spaces
 * - `\left` / `\right` before `( ) [ ] | .` render the delimiter itself
 */

/* ------------------------------------------------------------------ */
/* Symbol tables                                                       */
/* ------------------------------------------------------------------ */

const GREEK: Readonly<Record<string, string>> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ϵ',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'ϕ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω'
}

const SYMBOLS: Readonly<Record<string, string>> = {
  times: '×',
  pm: '±',
  mp: '∓',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  sim: '∼',
  propto: '∝',
  cdot: '⋅',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  degree: '°',
  circ: '∘',
  prime: '′',
  ast: '∗',
  AA: 'Å'
}

/** Unicode spaces, so no `m:t` ever starts or ends with a trimmable ASCII space. */
const SPACING: Readonly<Record<string, string>> = {
  ',': ' ', // thin space
  ';': ' ', // four-per-em space
  quad: ' ' // em space
}

/** Literal characters carried into a MathRun as-is. */
const LITERAL_CHARS = new Set([...'+-=<>/()[]|,.!'])

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

/* ------------------------------------------------------------------ */
/* The one OMML element the docx lib cannot express: an upright run     */
/* ------------------------------------------------------------------ */

/** Minimal generic element — subclassing is the lib's own extension seam (`root` is protected, not private). */
class MathElement extends XmlComponent {
  constructor(name: string, children: readonly (XmlComponent | string)[]) {
    super(name)
    for (const child of children) this.root.push(child)
  }
}

/**
 * An `m:r` carrying `m:rPr><m:nor/>` — "normal text", which is how OMML says
 * upright. `\text{}`/`\mathrm{}` need it and the library's MathRun constructor
 * takes only a string, so this builds the run from the exported XmlComponent
 * base instead. Cast: MathComponent is a closed union the lib checks only
 * structurally at serialization time.
 */
function uprightRun(text: string): MathRun {
  return new MathElement('m:r', [
    new MathElement('m:rPr', [new MathElement('m:nor', [])]),
    new MathElement('m:t', [text])
  ]) as unknown as MathRun
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

/** Internal bail-out — caught at the texToMath boundary, never escapes. */
class Unsupported extends Error {}

function fail(why: string): never {
  throw new Unsupported(why)
}

/**
 * Accumulates a sequence of math components, buffering plain characters into
 * one MathRun per contiguous stretch so `2\pi G` is one `m:r`, not three.
 */
class Seq {
  private readonly items: MathComponent[] = []
  private buf = ''

  pushText(text: string): void {
    this.buf += text
  }

  pushItem(item: MathComponent): void {
    this.flush()
    this.items.push(item)
  }

  private flush(): void {
    if (this.buf !== '') {
      this.items.push(new MathRun(this.buf))
      this.buf = ''
    }
  }

  /**
   * Remove and return the script base: the LAST atom of the sequence — the
   * final buffered character, or the final structural item. `^`/`_` with
   * nothing before them is unsupported (matches LaTeX, which errors too).
   */
  takeBase(): MathComponent[] {
    if (this.buf !== '') {
      const base = this.buf.slice(-1)
      this.buf = this.buf.slice(0, -1)
      this.flush()
      return [new MathRun(base)]
    }
    const last = this.items.pop()
    if (last === undefined) fail('script with no base')
    return [last]
  }

  finish(): MathComponent[] {
    this.flush()
    return this.items
  }
}

class Parser {
  private pos = 0

  constructor(private readonly src: string) {}

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos++
  }

  private peek(): string | null {
    this.skipWs()
    return this.pos < this.src.length ? (this.src[this.pos] as string) : null
  }

  private take(): string {
    const ch = this.peek()
    if (ch === null) fail('unexpected end of input')
    this.pos++
    return ch
  }

  /** The macro name after a `\` — a letter run, or one single non-letter character. */
  private macroName(): string {
    if (this.pos >= this.src.length) fail('dangling backslash')
    const first = this.src[this.pos] as string
    if (!isLetter(first)) {
      this.pos++
      return first
    }
    let name = ''
    while (this.pos < this.src.length && isLetter(this.src[this.pos] as string)) {
      name += this.src[this.pos]
      this.pos++
    }
    return name
  }

  /** Parse to end of input (or a closing brace, when inside a group). */
  parseSequence(inGroup: boolean): MathComponent[] {
    const seq = new Seq()
    for (;;) {
      const ch = this.peek()
      if (ch === null) {
        if (inGroup) fail('unmatched {')
        return seq.finish()
      }
      if (ch === '}') {
        if (!inGroup) fail('unmatched }')
        this.pos++
        return seq.finish()
      }
      this.parseNext(seq)
    }
  }

  /** One atom (or script attachment) into the running sequence. */
  private parseNext(seq: Seq): void {
    const ch = this.take()
    if (ch === '^' || ch === '_') {
      this.attachScripts(seq, ch)
      return
    }
    if (ch === '{') {
      // A bare group. If a script follows, the WHOLE group is the base —
      // matching LaTeX's `{ab}^2`; otherwise its content splices in place.
      const group = this.parseSequence(true)
      const next = this.peek()
      if (next === '^' || next === '_') {
        this.pos++
        seq.pushItem(this.scriptedItem(group, next))
      } else {
        for (const item of group) seq.pushItem(item)
      }
      return
    }
    if (ch === '\\') {
      this.parseMacro(seq)
      return
    }
    if (isLetter(ch) || isDigit(ch) || LITERAL_CHARS.has(ch)) {
      seq.pushText(ch)
      return
    }
    fail(`unsupported character "${ch}"`)
  }

  /** `^`/`_` seen: pull the base off the sequence and wrap it. */
  private attachScripts(seq: Seq, first: '^' | '_'): void {
    seq.pushItem(this.scriptedItem(seq.takeBase(), first))
  }

  /** Base + first script (+ the opposite script when it follows) as one item. */
  private scriptedItem(base: MathComponent[], first: '^' | '_'): MathComponent {
    const firstArg = this.scriptArg()
    const next = this.peek()
    if ((next === '^' || next === '_') && next !== first) {
      this.pos++
      const secondArg = this.scriptArg()
      const sup = first === '^' ? firstArg : secondArg
      const sub = first === '^' ? secondArg : firstArg
      this.rejectFurtherScripts()
      return new MathSubSuperScript({ children: base, superScript: sup, subScript: sub })
    }
    this.rejectFurtherScripts()
    return first === '^'
      ? new MathSuperScript({ children: base, superScript: firstArg })
      : new MathSubScript({ children: base, subScript: firstArg })
  }

  /** `x^2^3` / `x_i^2_j` are LaTeX errors — reject rather than guess a nesting. */
  private rejectFurtherScripts(): void {
    const next = this.peek()
    if (next === '^' || next === '_') fail('double script')
  }

  /** A script argument: a braced group, or exactly one single-token atom. */
  private scriptArg(): MathComponent[] {
    const ch = this.take()
    if (ch === '{') return this.parseSequence(true)
    if (ch === '\\') {
      const name = this.macroName()
      const unicode = GREEK[name] ?? SYMBOLS[name]
      if (unicode !== undefined) return [new MathRun(unicode)]
      if (name === 'text' || name === 'mathrm') return [uprightRun(this.textGroup())]
      if (name === 'frac') return [this.fraction()]
      if (name === 'sqrt') return [this.radical()]
      fail(`unsupported script argument \\${name}`)
    }
    if (isLetter(ch) || isDigit(ch) || LITERAL_CHARS.has(ch)) return [new MathRun(ch)]
    fail(`unsupported script argument "${ch}"`)
  }

  private parseMacro(seq: Seq): void {
    const name = this.macroName()
    const greekOrSymbol = GREEK[name] ?? SYMBOLS[name]
    if (greekOrSymbol !== undefined) {
      seq.pushText(greekOrSymbol)
      return
    }
    const space = SPACING[name]
    if (space !== undefined) {
      seq.pushText(space)
      return
    }
    switch (name) {
      case 'frac':
        seq.pushItem(this.fraction())
        return
      case 'sqrt':
        seq.pushItem(this.radical())
        return
      case 'text':
      case 'mathrm':
        seq.pushItem(uprightRun(this.textGroup()))
        return
      case 'sum':
      case 'int':
        seq.pushItem(this.nary(name))
        return
      case 'left':
      case 'right': {
        // Render the delimiter itself; `.` is LaTeX's invisible delimiter.
        const delim = this.take()
        if (delim === '.') return
        if (LITERAL_CHARS.has(delim) && '()[]|'.includes(delim)) {
          seq.pushText(delim)
          return
        }
        fail(`unsupported \\${name} delimiter "${delim}"`)
      }
      default:
        // \prod (no docx n-ary object), \begin, \\, \{ … — everything else.
        fail(`unsupported macro \\${name}`)
    }
  }

  /** A required `{...}` argument parsed as math. */
  private group(): MathComponent[] {
    if (this.take() !== '{') fail('expected {')
    return this.parseSequence(true)
  }

  private fraction(): MathFraction {
    const numerator = this.group()
    const denominator = this.group()
    return new MathFraction({ numerator, denominator })
  }

  private radical(): MathRadical {
    // `\sqrt[n]{..}` would surface here as `[` — degree syntax is unsupported.
    return new MathRadical({ children: this.group() })
  }

  /**
   * `\text{..}`/`\mathrm{..}` content, read RAW (whitespace preserved — this
   * is text mode, not math mode). Plain characters and symbol/greek macros
   * only; nesting or anything structural rejects the equation.
   */
  private textGroup(): string {
    if (this.take() !== '{') fail('expected { after \\text/\\mathrm')
    let out = ''
    for (;;) {
      if (this.pos >= this.src.length) fail('unmatched { in \\text')
      const ch = this.src[this.pos] as string
      this.pos++
      if (ch === '}') return out
      if (ch === '\\') {
        const name = this.macroName()
        const unicode = GREEK[name] ?? SYMBOLS[name] ?? SPACING[name]
        if (unicode === undefined) fail(`unsupported macro \\${name} in \\text`)
        out += unicode
        continue
      }
      if (ch === '{') fail('nested group in \\text')
      if (isLetter(ch) || isDigit(ch) || LITERAL_CHARS.has(ch) || ch === ' ') {
        out += ch
        continue
      }
      fail(`unsupported character "${ch}" in \\text`)
    }
  }

  /**
   * `\sum`/`\int` with optional `_{}`/`^{}` limits in either order, then ONE
   * following (possibly scripted) atom as the n-ary base — `\sum_{i=1}^{n} x_i`
   * puts `x_i` under the ∑'s slot; whatever follows continues inline. The base
   * is REQUIRED: an empty `m:e` renders as Word's dotted placeholder box,
   * which is worse than the italic-literal fallback.
   */
  private nary(kind: 'sum' | 'int'): MathComponent {
    let subScript: MathComponent[] | undefined
    let superScript: MathComponent[] | undefined
    for (let i = 0; i < 2; i++) {
      const next = this.peek()
      if (next === '_' && subScript === undefined) {
        this.pos++
        subScript = this.scriptArg()
      } else if (next === '^' && superScript === undefined) {
        this.pos++
        superScript = this.scriptArg()
      } else {
        break
      }
    }
    const baseSeq = new Seq()
    this.parseNext(baseSeq)
    const children = baseSeq.finish()
    if (children.length === 0) fail(`\\${kind} with no operand`)
    const options = { children, ...(subScript ? { subScript } : {}), ...(superScript ? { superScript } : {}) }
    return kind === 'sum' ? new MathSum(options) : new MathIntegral(options)
  }
}

/**
 * Convert one LaTeX equation (the bare source, no `$` delimiters) to the docx
 * math component list, or null when ANY part of it falls outside the strict
 * subset above. Null means "use the italic-literal fallback" — this function
 * never half-renders and never throws.
 */
export function texToMath(tex: string): MathComponent[] | null {
  if (tex.trim() === '') return null
  try {
    const components = new Parser(tex).parseSequence(false)
    return components.length > 0 ? components : null
  } catch {
    return null
  }
}
