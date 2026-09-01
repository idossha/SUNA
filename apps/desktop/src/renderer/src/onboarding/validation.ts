/**
 * Onboarding wizard step 1 validation (DECISIONS 2026-08-15), split so the
 * filename-shape rules run instantly (no IPC round trip) while the
 * existence/writability rules — which need the filesystem — combine in
 * afterward. Pure: no fs, no IPC.
 */

export interface NameValidation {
  valid: boolean
  reason: string | null
}

// eslint-disable-next-line no-control-regex
const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|\x00-\x1f]/

/** Filename-shape check only — never touches disk. */
export function validateProjectName(name: string): NameValidation {
  if (name === '') return { valid: false, reason: 'Enter a project name.' }
  if (name.trim() !== name) {
    return { valid: false, reason: 'Name cannot start or end with whitespace.' }
  }
  if (name === '.' || name === '..') {
    return { valid: false, reason: `"${name}" is not a valid folder name.` }
  }
  if (ILLEGAL_NAME_CHARS.test(name)) {
    return { valid: false, reason: 'Name cannot contain / \\ : * ? " < > | or control characters.' }
  }
  return { valid: true, reason: null }
}

export interface TargetCheckResult {
  exists: boolean
  parentWritable: boolean
}

export interface TargetValidation {
  valid: boolean
  /** null while a name is syntactically fine but the filesystem check hasn't landed yet. */
  reason: string | null
}

/**
 * Full step-1 gating: parent chosen, name syntactically valid, and (once the
 * 'project:check-target' round trip resolves) the target doesn't already
 * exist and its parent is writable. `check: null` means "not checked yet" —
 * Next stays blocked with no error shown (not yet an error, just unknown).
 */
export function validateTarget(
  parentDir: string | null,
  name: string,
  check: TargetCheckResult | null
): TargetValidation {
  if (parentDir === null) return { valid: false, reason: 'Choose a parent folder.' }
  const nameResult = validateProjectName(name)
  if (!nameResult.valid) return { valid: false, reason: nameResult.reason }
  if (check === null) return { valid: false, reason: null }
  if (!check.parentWritable) {
    return { valid: false, reason: 'That folder cannot be written to.' }
  }
  if (check.exists) {
    return { valid: false, reason: 'A file or folder with that name already exists there.' }
  }
  return { valid: true, reason: null }
}
