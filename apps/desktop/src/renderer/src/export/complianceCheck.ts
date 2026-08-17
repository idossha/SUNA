import type { Manuscript, PublisherProfile } from '@suna/core'
import { assignNumbers } from '@suna/bib'
import { checkManuscript, type Diagnostic } from '@suna/formatter'
import { collectClusters } from '../manuscript/citations'

/**
 * Runs the compliance checker (ADR-002 §4) against the profile the export
 * dialog is about to render with, BEFORE export — spec §5: "RUN THE
 * COMPLIANCE CHECKER FIRST and show violations as warnings that do not
 * block". The prose lives in ONE flat manuscript.md now (feature-plan-7 §1),
 * so there is only one section text to read — `checkManuscript`'s
 * `sectionTexts` keys are never inspected, only `Object.values()`'d for word
 * counts and figure-reference scanning, so a single-entry record is exactly
 * as sound as the old per-section map.
 *
 * `manuscriptDir` is the manifest's manuscript directory (suna.json's
 * `directories` block can remap it away from the default 'manuscript/') —
 * the caller resolves it from the project manifest, falling back to
 * DEFAULT_PROJECT_DIRS.manuscript.
 */
export async function runComplianceCheck(
  rootDir: string,
  manuscriptDir: string,
  manuscript: Manuscript,
  profile: PublisherProfile
): Promise<Diagnostic[]> {
  let prose = ''
  try {
    const { content } = await window.suna.invoke('fs:read-text', {
      path: `${rootDir}/${manuscriptDir}/${manuscript.manuscriptFile}`
    })
    prose = content
  } catch {
    prose = ''
  }
  const sectionTexts: Record<string, string> = { [manuscript.manuscriptFile]: prose }

  const clusters = collectClusters(prose)
  const numbers = assignNumbers(clusters.map((c) => [...c.keys]))

  // The checker needs one of the profile's OWN article-type ids (they are
  // journal-specific, e.g. "apj-article", not the generic
  // manuscript.articleType) — the first declared type is each profile's
  // primary research-article type (same convention onboarding/Step2Profile
  // uses for its abstract-limit preview).
  const articleTypeId = profile.manuscript.articleTypes[0]?.id
  if (articleTypeId === undefined) return []

  return checkManuscript({ manuscript, sectionTexts, referenceCount: numbers.size }, profile, articleTypeId)
}
