import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  defaultConfigYaml,
  parseThemeFile,
  parseUserConfig,
  writeSettingToYaml,
  resolveSettings,
  SETTING_KEYS,
  resolveThemes,
  themesCss,
  type ResolvedSettingKey,
  type ResolvedSettings,
  type ThemeDefinition,
  type UserConfigDiagnostic
} from '@suna/core'

/**
 * The user's config directory — `~/.suna/`, holding the one config file and
 * their themes. This is the whole configuration story: there is no second
 * store in userData that the file can be silently outranked by. userData
 * keeps only machine state (the recents list, cached credentials), which is
 * not configuration and is not something anyone wants to hand-edit.
 *
 *   ~/.suna/config.yml     every setting, seeded fully commented on first run
 *   ~/.suna/themes/*.yml   one theme per file
 *
 * SUNA_CONFIG_HOME relocates it (tests, and a user who keeps dotfiles
 * elsewhere). Deliberately NOT `SUNA_CONFIG_DIR`, which already names the
 * machine agent-context layer (~/SunaConfig) — see services/agentLayer.ts.
 */
export function configDir(): string {
  const override = process.env['SUNA_CONFIG_HOME']
  if (override !== undefined && override.length > 0) return override
  return join(homedir(), '.suna')
}

export function configPath(): string {
  return join(configDir(), 'config.yml')
}

export function themesDir(): string {
  return join(configDir(), 'themes')
}

/** Everything the renderer needs to render the app's configured look. */
export interface LoadedConfig {
  /** Bumped on every reload; the renderer uses it to ignore a stale reply. */
  revision: number
  /** Absolute path, so the UI can offer "open my config". */
  path: string
  /** The raw file text, for the "edit in SUNA" tab. */
  text: string
  /** Resolved values and, per key, whether the file set it. */
  settings: ResolvedSettings
  sources: Record<ResolvedSettingKey, 'config' | 'default'>
  /** The stylesheet for every theme — built-in and user — ready to inject. */
  themesCss: string
  /** id/name/base for the theme picker. */
  themes: { id: string; name: string; base: 'dark' | 'light'; builtin: boolean }[]
  /** Everything wrong with the config, as a list the Settings tab can show. */
  diagnostics: UserConfigDiagnostic[]
}

let cache: LoadedConfig | null = null
let revision = 0

/**
 * Create `~/.suna/` and seed config.yml if it is missing.
 *
 * Seeding a fully-commented file rather than an empty one is the point of the
 * whole design: a user who opens it sees every key, its default and what it
 * accepts, without reading any documentation. An existing file is never
 * touched — not even to add keys a newer version introduced, because that
 * would rewrite a file the user owns.
 */
async function ensureConfigFile(): Promise<void> {
  await mkdir(themesDir(), { recursive: true })
  const target = configPath()
  try {
    await readFile(target, 'utf8')
  } catch {
    await writeAtomic(target, defaultConfigYaml())
  }
}

let writeCounter = 0

/**
 * Temp file + rename, with a UNIQUE temp name.
 *
 * Two settings written back to back — a wizard's Create step, a slider that
 * commits on every step — race on a shared `config.yml.tmp`: both write it,
 * the first rename consumes it, the second fails ENOENT. A counter in the name
 * makes the two writes independent; `setSetting` below still serialises them,
 * so the read-modify-write itself cannot interleave either.
 */
async function writeAtomic(target: string, text: string): Promise<void> {
  writeCounter += 1
  const temp = `${target}.${process.pid}.${writeCounter}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, target)
}

/**
 * Config writes run one at a time. Each is a read-modify-write of the same
 * file, so two in flight would have the second overwrite the first's key with
 * text read before it landed.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work)
  writeQueue = next.catch(() => undefined)
  return next
}

async function readUserThemes(): Promise<{
  themes: (ThemeDefinition & { id: string })[]
  diagnostics: UserConfigDiagnostic[]
}> {
  const themes: (ThemeDefinition & { id: string })[] = []
  const diagnostics: UserConfigDiagnostic[] = []
  let entries: string[]
  try {
    entries = await readdir(themesDir())
  } catch {
    return { themes, diagnostics }
  }
  for (const filename of entries.filter((name) => /\.ya?ml$/i.test(name)).sort()) {
    let text: string
    try {
      text = await readFile(join(themesDir(), filename), 'utf8')
    } catch (error) {
      diagnostics.push({ path: `themes/${filename}`, message: errorMessage(error) })
      continue
    }
    const parsed = parseThemeFile(filename, text)
    if (parsed.theme !== null) themes.push(parsed.theme)
    for (const issue of parsed.diagnostics) {
      diagnostics.push({ path: `themes/${filename}${issue.path}`, message: issue.message })
    }
  }
  return { themes, diagnostics }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read config.yml and every theme, and resolve both.
 *
 * Never throws. A missing file, a broken parse, an unknown theme id — each
 * degrades to the shipped default and adds a diagnostic, because the app
 * refusing to open is a far worse outcome than the app opening in the wrong
 * colours with a message saying why.
 */
export async function loadConfig(): Promise<LoadedConfig> {
  await ensureConfigFile()
  let text = ''
  try {
    text = await readFile(configPath(), 'utf8')
  } catch (error) {
    revision += 1
    return {
      revision,
      path: configPath(),
      text: '',
      ...resolvedFrom({}),
      themesCss: themesCss(resolveThemes()),
      themes: themeList([]),
      diagnostics: [{ path: '', message: `could not read config.yml: ${errorMessage(error)}` }]
    }
  }

  const parsed = parseUserConfig(text)
  const fromFiles = await readUserThemes()
  // An inline `themes:` entry and a file of the same id: the file wins, since
  // it is the more specific place to have put it. Reported either way.
  const byId = new Map<string, ThemeDefinition & { id: string }>()
  for (const theme of parsed.themes) byId.set(theme.id, theme)
  for (const theme of fromFiles.themes) byId.set(theme.id, theme)
  const resolvedThemes = resolveThemes([...byId.values()])

  const resolution = resolvedFrom(parsed.values)
  const diagnostics = [...parsed.diagnostics, ...fromFiles.diagnostics]
  for (const problem of resolution.problems) {
    diagnostics.push({ path: problem.path, message: problem.message })
  }
  const themeId = resolution.settings['editor.editorTheme']
  if (!resolvedThemes.some((theme) => theme.id === themeId)) {
    diagnostics.push({
      path: 'editor.theme',
      message: `no theme named '${themeId}'. Put it in ~/.suna/themes/${themeId}.yml, or pick a built-in.`
    })
  }

  revision += 1
  cache = {
    revision,
    path: configPath(),
    text,
    settings: resolution.settings,
    sources: resolution.sources,
    themesCss: themesCss(resolvedThemes),
    themes: themeList(resolvedThemes),
    diagnostics
  }
  return cache
}

function themeList(
  themes: readonly { id: string; name: string; base: 'dark' | 'light'; builtin: boolean }[]
): LoadedConfig['themes'] {
  const all = themes.length > 0 ? themes : resolveThemes()
  return all.map(({ id, name, base, builtin }) => ({ id, name, base, builtin }))
}

function resolvedFrom(values: Record<string, unknown>): {
  settings: ResolvedSettings
  sources: Record<ResolvedSettingKey, 'config' | 'default'>
  problems: { key: ResolvedSettingKey; path: string; message: string }[]
} {
  const resolution = resolveSettings(values)
  return {
    settings: resolution.value,
    sources: resolution.sources,
    problems: resolution.problems
  }
}

/** The last load, without touching disk — for main-side consumers on a hot path. */
export async function currentConfig(): Promise<LoadedConfig> {
  return cache ?? (await loadConfig())
}

/**
 * Write one setting into the user's config.yml, preserving their comments and
 * key order, and return the reloaded config.
 *
 * `null` deletes the key, which is the GUI's "reset to default". A file whose
 * YAML is currently broken is left alone and the error is surfaced: silently
 * reformatting a file someone is mid-edit in would lose their work.
 */
export async function setSetting(
  key: ResolvedSettingKey,
  value: unknown
): Promise<{ config: LoadedConfig; error: string | null }> {
  return serialise(() => writeSetting(key, value))
}

async function writeSetting(
  key: ResolvedSettingKey,
  value: unknown
): Promise<{ config: LoadedConfig; error: string | null }> {
  // The key crosses IPC as a string. Refusing an unknown one here is what
  // keeps a typo from planting a stray top-level entry in the user's file.
  if (!Object.prototype.hasOwnProperty.call(SETTING_KEYS, key)) {
    return { config: await loadConfig(), error: `unknown setting '${String(key)}'` }
  }
  await ensureConfigFile()
  let text = ''
  try {
    text = await readFile(configPath(), 'utf8')
  } catch {
    text = ''
  }
  const written = writeSettingToYaml(text, key, value)
  if (!written.written) {
    return { config: await loadConfig(), error: written.error ?? 'config.yml could not be written' }
  }
  await writeAtomic(configPath(), written.text)
  return { config: await loadConfig(), error: null }
}

/* ------------------------------------------------------------------ */
/* Watching                                                            */
/* ------------------------------------------------------------------ */

let watcher: FSWatcher | null = null
let themeWatcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

/**
 * Watch the config directory and call `onChange` with the reloaded config.
 *
 * The whole directory rather than the single file: an editor that saves by
 * writing a temp file and renaming over the original (which is what SUNA's own
 * atomic write does, and vim's, and VS Code's) breaks a watch bound to the
 * inode. Debounced, because one save can produce several events.
 */
export function watchConfig(onChange: (config: LoadedConfig) => void): () => void {
  const fire = (): void => {
    if (debounce !== null) clearTimeout(debounce)
    debounce = setTimeout(() => {
      void loadConfig().then(onChange)
    }, 80)
  }
  try {
    // `persistent: true` deliberately: an unref'd fs watcher does not reliably
    // fire in Electron's main process, whose loop is driven by Chromium's
    // message pump rather than by libuv alone. Both handles are closed on
    // will-quit, so keeping them referenced costs nothing.
    watcher = watch(configDir(), { persistent: true }, fire)
    themeWatcher = watch(themesDir(), { persistent: true }, fire)
  } catch {
    // A missing directory at boot: ensureConfigFile has already created it by
    // the time anything calls this, so this is only reachable on a platform
    // that refuses the watch. Losing live reload is survivable.
  }
  return () => {
    watcher?.close()
    themeWatcher?.close()
    watcher = null
    themeWatcher = null
    if (debounce !== null) clearTimeout(debounce)
  }
}

/* ------------------------------------------------------------------ */
/* Main-side consumers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Which model tier and effort an AI call runs at, resolved HERE rather than
 * passed in from the renderer so every entry point — palette ask, directed
 * action, chat — obeys a hand-edited config.yml without its own plumbing.
 */
export async function resolveAiChoice(): Promise<{
  model: ResolvedSettings['ai.model']
  effort: ResolvedSettings['ai.effort']
}> {
  const { settings } = await currentConfig()
  return { model: settings['ai.model'], effort: settings['ai.effort'] }
}

/** One setting, main-side. */
export async function getSetting<K extends ResolvedSettingKey>(
  key: K
): Promise<ResolvedSettings[K]> {
  const { settings } = await currentConfig()
  return settings[key]
}
