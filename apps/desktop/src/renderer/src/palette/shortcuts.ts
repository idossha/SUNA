/**
 * Pure keyboard-shortcut spec parsing/matching, shared by the command
 * registry (state/commands.ts, which stamps `shortcut` strings on commands)
 * and CommandPalette.tsx's global dispatcher. Specs look like
 * `"Mod-Backslash"` or `"Mod-Shift-KeyK"` — segments joined by `-`, the last
 * one a `KeyboardEvent.code` value. Matching is against `.code`, never
 * `.key`: a Shift-modified symbol key changes `.key` (`\` becomes `|`) but
 * not `.code` (`Backslash` either way), so `.code` is the only layout-stable
 * signal — the same reasoning TerminalPanel's own Ctrl-` handler uses.
 * `Mod` means metaKey OR ctrlKey (⌘ on macOS, Ctrl elsewhere).
 */

export interface ParsedShortcut {
  mod: boolean
  shift: boolean
  alt: boolean
  code: string
}

export function parseShortcut(spec: string): ParsedShortcut {
  const parts = spec.split('-')
  const code = parts.pop() ?? ''
  return {
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    code
  }
}

export interface ShortcutEvent {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Does `event` match `spec` exactly — same modifiers, same physical key? */
export function matchesShortcut(event: ShortcutEvent, spec: string): boolean {
  const parsed = parseShortcut(spec)
  const modPressed = event.metaKey || event.ctrlKey
  return (
    parsed.mod === modPressed &&
    parsed.shift === event.shiftKey &&
    parsed.alt === event.altKey &&
    parsed.code === event.code
  )
}

const CODE_LABELS: Record<string, string> = {
  Backslash: '\\',
  Backquote: '`',
  Enter: '⏎',
  Escape: 'Esc',
  Minus: '-',
  Equal: '=',
  Slash: '/'
}

/**
 * Punctuation whose SHIFTED glyph is the name of the chord (DECISIONS 2026-08-17):
 * `Mod-Shift-Slash` is ⌘?, because Shift+Slash *is* the `?` key and a
 * reader hunting for "?" must find "?" — "⌘⇧/" makes them decode it. The ⇧
 * glyph is dropped with the substitution, or the label would read as a third
 * key to press.
 *
 * Deliberately narrow: matching is untouched (still `event.code` + the exact
 * modifier set), and `⌘⇧\` (split down) keeps its unshifted name because that
 * is what the app calls it everywhere else — `⌘|` would name no key the user
 * recognises.
 */
const SHIFTED_CODE_LABELS: Record<string, string> = {
  Slash: '?'
}

function codeLabel(code: string): string {
  const known = CODE_LABELS[code]
  if (known !== undefined) return known
  const key = /^Key([A-Z])$/.exec(code)
  if (key?.[1] !== undefined) return key[1]
  const digit = /^Digit(\d)$/.exec(code)
  if (digit?.[1] !== undefined) return digit[1]
  return code
}

/** Human-readable macOS-glyph label: "Mod-Shift-Backslash" -> "⌘⇧\\". */
export function formatShortcut(spec: string): string {
  const parsed = parseShortcut(spec)
  const shifted = parsed.shift ? SHIFTED_CODE_LABELS[parsed.code] : undefined
  let out = ''
  if (parsed.mod) out += '⌘'
  if (parsed.alt) out += '⌥'
  if (parsed.shift && shifted === undefined) out += '⇧'
  out += shifted ?? codeLabel(parsed.code)
  return out
}
