import type { Author, Manuscript, PublisherProfile } from '@suna/core'
import { assignNumbers } from '@suna/bib'
import { checkManuscript, type Diagnostic } from '@suna/formatter'
import { collectClusters } from '../manuscript/citations'

/**
 * Runs the compliance checker (ARCHITECTURE §12.1) against the profile the export
 * dialog is about to render with, BEFORE export — spec §5: "RUN THE
 * COMPLIANCE CHECKER FIRST and show violations as warnings that do not
 * block". The prose lives in ONE flat manuscript.md now (ARCHITECTURE §4.3),
 * so there is only one section text to read — `checkManuscript`'s
 * `sectionTexts` keys are never inspected, only `Object.values()`'d for word
 * counts and figure-reference scanning, so a single-entry record is exactly
 * as sound as the old per-section map.
 *
 * `manuscriptDir` is the manifest's manuscript directory (suna.json's
 * `directories` block can remap it away from the default 'manuscript/') —
 * the caller resolves it from the project manifest, falling back to
 * DEFAULT_PROJECT_DIRS.manuscript.
 *
 * `articleTypeId` is the user's explicit pick from the export page's
 * article-type selector; null/unknown falls back to the profile's first
 * declared type (its primary research-article type).
 *
 * `manuscriptDir` is where the prose to check LIVES, project-root-relative —
 * the manifest's manuscript directory for the working copy, or an archived
 * version's content directory (`manuscript/archive/<id>[/manuscript]`) when
 * the export page is pointed at a logged version.
 *
 * `authors` (authors.json's list, from useManuscriptStore) feeds the
 * checker's metadata-based authors-and-affiliations detection; omitted when
 * the byline could not be loaded — the check runs without it rather than
 * failing.
 */
export async function runComplianceCheck(
  rootDir: string,
  manuscriptDir: string,
  manuscript: Manuscript,
  profile: PublisherProfile,
  articleTypeId?: string | null,
  authors?: readonly Author[]
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
  // manuscript.articleType). An explicit user pick wins; otherwise the first
  // declared type is each profile's primary research-article type (same
  // convention onboarding/Step2Profile uses for its abstract-limit preview).
  const picked =
    articleTypeId != null && profile.manuscript.articleTypes.some((t) => t.id === articleTypeId)
      ? articleTypeId
      : profile.manuscript.articleTypes[0]?.id
  if (picked === undefined) return []

  return checkManuscript(
    {
      manuscript,
      sectionTexts,
      referenceCount: numbers.size,
      ...(authors === undefined ? {} : { authors })
    },
    profile,
    picked
  )
}
