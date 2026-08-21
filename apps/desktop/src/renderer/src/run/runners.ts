/**
 * Which shell command runs a source file, by extension. The terminal a run
 * lands in already has the project's selected python env on PATH (see
 * main/services/terminal.ts), so a python run is plain `python file.py` —
 * the interpreter resolves to the chosen env, exactly as it would if the
 * author typed it themselves. Nothing here shells out on its own; the whole
 * point is that the command is visible, editable and re-runnable in the pty.
 */

export interface Runner {
  /** Extension including the dot, lowercase. */
  ext: string
  /** Executable the run invokes; shown in the "not installed" hint. */
  program: string
  /**
   * Program to use when NO environment is selected. Bare `python` is not on
   * PATH on a stock macOS or Debian — a run with no env must say `python3`
   * or the shell answers with "correct 'python' to 'python3'?" instead of
   * running anything. Inside a venv/conda env `python` always exists, so the
   * plain name is right there and matches what the author would type.
   */
  bareProgram?: string
  /** Argument list before the file path. */
  args: readonly string[]
  /** Human label for the run button's tooltip and the terminal tab. */
  label: string
}

/**
 * Deliberately small and boring: interpreters a researcher already has, each
 * invoked the way its own docs say to. Compilers and build tools are not
 * here — a "run" that needs a build step needs a task system, not a button.
 */
export const RUNNERS: readonly Runner[] = [
  { ext: '.py', program: 'python', bareProgram: 'python3', args: [], label: 'Python' },
  { ext: '.r', program: 'Rscript', args: [], label: 'R' },
  { ext: '.jl', program: 'julia', args: [], label: 'Julia' },
  { ext: '.sh', program: 'bash', args: [], label: 'Shell' },
  { ext: '.bash', program: 'bash', args: [], label: 'Shell' },
  { ext: '.zsh', program: 'zsh', args: [], label: 'Shell' },
  { ext: '.js', program: 'node', args: [], label: 'Node' },
  { ext: '.mjs', program: 'node', args: [], label: 'Node' },
  { ext: '.cjs', program: 'node', args: [], label: 'Node' },
  { ext: '.ts', program: 'npx', args: ['--yes', 'tsx'], label: 'TypeScript' },
  { ext: '.mts', program: 'npx', args: ['--yes', 'tsx'], label: 'TypeScript' }
]

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

/** The runner for a path, or null when nothing here knows how to run it. */
export function runnerFor(path: string): Runner | null {
  const ext = extensionOf(path)
  return RUNNERS.find((runner) => runner.ext === ext) ?? null
}

/**
 * POSIX single-quoting: the only character that cannot appear inside '…' is
 * the quote itself, which ends the string, escapes one, and reopens. Paths
 * with spaces, $, or a stray quote all survive this intact.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Path as the command should name it: relative to the project root when the
 * file is inside it (short, and what the author would type), absolute
 * otherwise. `rootDir` never gets a trailing slash from the project store.
 */
export function displayPath(path: string, rootDir: string | null): string {
  if (rootDir === null) return path
  const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export interface RunCommand {
  /** Typed into the pty verbatim, followed by a newline. */
  command: string
  /** Terminal tab title — the file, not the whole command line. */
  title: string
  runner: Runner
}

/**
 * The command that runs `path`, or null when the extension has no runner.
 * `hasEnv` is whether a python environment is selected for the project — see
 * Runner.bareProgram for why that changes the interpreter's name.
 */
export function runCommandFor(
  path: string,
  rootDir: string | null,
  hasEnv = false
): RunCommand | null {
  const runner = runnerFor(path)
  if (runner === null) return null
  const program = hasEnv ? runner.program : (runner.bareProgram ?? runner.program)
  const parts = [program, ...runner.args, shellQuote(displayPath(path, rootDir))]
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  return { command: parts.join(' '), title: `run ${fileName}`, runner }
}
