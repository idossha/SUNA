import type { Diagnostic } from '@suna/formatter'

/**
 * The checker appends its profile section's stated source URL to each message
 * ("… (per https://…)", see formatter check/util.ts sourceSuffix). Repeating
 * the same URL on every line drowns the findings, so the export dialog strips
 * the suffix off the rows and lists the distinct sources once underneath.
 */
const SOURCE_SUFFIX = /\s*\(per (https?:\/\/\S+?)\)\s*$/

export interface DiagnosticRow {
  diagnostic: Diagnostic
  /** The message with its trailing source citation removed. */
  message: string
}

export interface SplitDiagnostics {
  rows: DiagnosticRow[]
  /** Distinct source URLs cited by these diagnostics, in first-seen order. */
  sources: string[]
}

export function splitDiagnosticSources(diagnostics: readonly Diagnostic[]): SplitDiagnostics {
  const rows: DiagnosticRow[] = []
  const sources: string[] = []
  for (const diagnostic of diagnostics) {
    const match = SOURCE_SUFFIX.exec(diagnostic.message)
    if (match === null) {
      rows.push({ diagnostic, message: diagnostic.message })
      continue
    }
    const url = match[1] as string
    if (!sources.includes(url)) sources.push(url)
    rows.push({ diagnostic, message: diagnostic.message.slice(0, match.index) })
  }
  return { rows, sources }
}
