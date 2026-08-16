import type { Manuscript, PublisherProfile } from '@suna/core'
import { assignNumbers } from '@suna/bib'
import { checkManuscript, type Diagnostic } from '@suna/formatter'
import { collectClusters } from '../manuscript/citations'
import { flattenBody } from '../views/outline'

/**
 * Runs the compliance checker (ADR-002 §4) against the profile the export
 * dialog is about to render with, BEFORE export — spec §5: "RUN THE
 * COMPLIANCE CHECKER FIRST and show violations as warnings that do not
 * block". Mirrors ReferencesBlock.tsx's own section-text reading (fs:read-text
 * per content path) so the word counts and citation scan see the same prose
 * the combined document renders.
 */
export async function runComplianceCheck(
  rootDir: string,
  manuscript: Manuscript,
  profile: PublisherProfile
): Promise<Diagnostic[]> {
  const contentPaths = flattenBody(manuscript.body)
    .map((row) => row.contentPath)
    .filter((p): p is string => p !== null)

  const sectionTexts: Record<string, string> = {}
  for (const path of contentPaths) {
    try {
      const { content } = await window.suna.invoke('fs:read-text', { path: `${rootDir}/manuscript/${path}` })
      sectionTexts[path] = content
    } catch {
      sectionTexts[path] = ''
    }
  }

  const clusters = Object.values(sectionTexts).flatMap((text) => collectClusters(text))
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
