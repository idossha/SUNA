import { z } from 'zod';
// TYPE-ONLY, and deliberately so: project.ts imports DocumentEntrySchema from
// this file to declare `documents`, so a runtime import back would be a cycle.
// A type import is erased, and `documentPaths` takes an already-resolved
// manuscript dir rather than reaching for DEFAULT_PROJECT_DIRS.
import type { SunaProjectManifest } from './project';

/**
 * The document registry (ARCHITECTURE §4.2, ARCHITECTURE §4.2).
 *
 * A SUNA project holds a SET of typed documents rather than one manuscript.
 * `manuscript` becomes the first entry in this registry by DESCRIBING the
 * layout that is already on disk, which is what makes the change a zero-file
 * migration: `resolveDocuments` synthesizes a one-manuscript registry for
 * every manifest that has no `documents` field, and every such project keeps
 * resolving byte-identical paths.
 *
 * The four exhaustive `Record<DocumentKindId, …>` tables live in four layers
 * because an import cycle makes one monolithic table impossible — the checker
 * needs @suna/formatter, the export recipe needs Chromium, the view needs
 * React. This file owns the only one that is pure data.
 */

export const DOCUMENT_KIND_IDS = [
  'manuscript',
  'supplement',
  'cover-letter',
  'response',
  'report',
  'package',
  'component',
] as const;

export const DocumentKindIdSchema = z.enum(DOCUMENT_KIND_IDS);
export type DocumentKindId = z.infer<typeof DocumentKindIdSchema>;

/** Which of the two profile registries a document's profile id belongs to. */
export const ProfileRegistrySchema = z.enum(['journal', 'sponsor']);
export type ProfileRegistry = z.infer<typeof ProfileRegistrySchema>;

/**
 * Kinds whose profile is resolved through the JOURNAL registry, and which
 * therefore inherit `suna.json:activeProfileId` when their own `profile` is
 * null. 'package' and 'component' are absent deliberately: they take a sponsor
 * profile from PackageDocument.packageProfileId and must never fall back to a
 * journal id (ARCHITECTURE §4.2).
 */
export const JOURNAL_REGISTRY_KINDS = [
  'manuscript',
  'supplement',
  'cover-letter',
  'response',
  'report',
] as const satisfies readonly DocumentKindId[];

const JOURNAL_KIND_SET: ReadonlySet<DocumentKindId> = new Set(JOURNAL_REGISTRY_KINDS);

/** True when this kind resolves its profile through the journal registry. */
export function usesJournalRegistry(kind: DocumentKindId): boolean {
  return JOURNAL_KIND_SET.has(kind);
}

export const DocumentProfileRefSchema = z.object({
  registry: ProfileRegistrySchema,
  id: z.string().min(1),
});
export type DocumentProfileRef = z.infer<typeof DocumentProfileRefSchema>;

export const DocumentEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    kind: DocumentKindIdSchema,
    /**
     * MANUSCRIPT-DIR-RELATIVE prose path; may nest ('letters/cover-science.md').
     * null on 'manuscript' — its filename lives in manuscript.json:manuscriptFile,
     * so the registry cannot drift from it — and on kinds with no prose.
     */
    file: z.string().min(1).nullable(),
    /** MANUSCRIPT-DIR-RELATIVE sidecar path, or null when the kind has none. */
    meta: z.string().min(1).nullable(),
    title: z.string().min(1),
    /**
     * TAGGED profile reference. ProfileIdSchema is a bare regex, so 'nih-r01'
     * and 'science' are indistinguishable by shape; an untagged string leaves
     * no consumer able to pick a loader. null inherits activeProfileId, which
     * is a journal id — so inheritance is defined for journal-registry kinds
     * only.
     */
    profile: DocumentProfileRefSchema.nullable().default(null),
    roundId: z.string().min(1).nullable().default(null),
    archived: z.boolean().default(false),
  })
  .superRefine((entry, ctx) => {
    if (entry.profile === null) return;
    const journalKind = usesJournalRegistry(entry.kind);
    if (journalKind && entry.profile.registry === 'sponsor') {
      ctx.addIssue({
        code: 'custom',
        path: ['profile', 'registry'],
        message: `kind "${entry.kind}" resolves through the journal registry; a sponsor profile is not valid on it`,
      });
    }
    if (!journalKind && entry.profile.registry === 'journal') {
      ctx.addIssue({
        code: 'custom',
        path: ['profile', 'registry'],
        message: `kind "${entry.kind}" takes its sponsor profile from packageProfileId; a journal profile is not valid on it`,
      });
    }
  });
export type DocumentEntry = z.infer<typeof DocumentEntrySchema>;

/**
 * Which filenames each kind owns. THE SINGLE SOURCE OF TRUTH for
 * kind → filename: ARCHITECTURE §4.2's model table cites this rather than restating it,
 * and the shipped example registries are asserted against it in the unit
 * suite, so the three cannot drift apart.
 *
 * '<id>' is replaced by the entry id, '<slot>' by the slot id. Sidecars that
 * are project-wide (comments.json, revisions.json) are NOT listed here —
 * they belong to the project, not to a kind.
 */
export interface KindFiles {
  meta: string | null;
  prose: string | null;
  extra: readonly string[];
}

export const DOCUMENT_KIND_FILES = {
  manuscript: {
    meta: 'manuscript.json',
    prose: null,
    extra: ['authors.json', 'references.bib'],
  },
  supplement: { meta: 'supplementary.doc.json', prose: 'supplementary.md', extra: [] },
  'cover-letter': { meta: '<id>.json', prose: '<id>.md', extra: ['<id>.private.json'] },
  response: { meta: '<id>.doc.json', prose: '<id>.md', extra: [] },
  report: { meta: '<id>.doc.json', prose: '<id>.md', extra: [] },
  package: { meta: 'package.json', prose: null, extra: [] },
  component: { meta: '<slot>.json', prose: '<slot>.md', extra: [] },
} as const satisfies Record<DocumentKindId, KindFiles>;

/** The id every synthesized primary manuscript entry carries. */
export const PRIMARY_DOCUMENT_ID = 'manuscript';

/**
 * The registry a manifest declares, or the synthesized one-manuscript registry
 * when it declares none.
 *
 * This is what makes ARCHITECTURE §4.2 a zero-file migration: a project written before
 * the registry existed resolves to exactly the document it always had, and
 * nothing is written to suna.json to make that true.
 */
export function resolveDocuments(m: SunaProjectManifest): DocumentEntry[] {
  const declared = m.documents;
  if (declared !== undefined && declared.length > 0) return declared.slice();
  return [synthesizedPrimary()];
}

/**
 * The registry a project has when it declares none — one manuscript entry.
 * Exported so callers that could not read suna.json at all (a missing or
 * unparseable manifest) degrade to the same shape rather than casting.
 */
export function synthesizedRegistry(): DocumentEntry[] {
  return [synthesizedPrimary()];
}

function synthesizedPrimary(): DocumentEntry {
  return {
    id: PRIMARY_DOCUMENT_ID,
    kind: 'manuscript',
    file: null,
    meta: DOCUMENT_KIND_FILES.manuscript.meta,
    title: 'Manuscript',
    profile: null,
    roundId: null,
    archived: false,
  };
}

/**
 * The project's primary document — the manuscript. Every project has exactly
 * one; a registry that declares none is repaired here rather than throwing,
 * because a manifest with `documents: []` should behave like a manifest with
 * no `documents` at all.
 */
export function primaryDocument(m: SunaProjectManifest): DocumentEntry {
  const docs = resolveDocuments(m);
  return docs.find((d) => d.kind === 'manuscript') ?? synthesizedPrimary();
}

/** Look one document up by id, or null. */
export function documentById(m: SunaProjectManifest, id: string): DocumentEntry | null {
  return resolveDocuments(m).find((d) => d.id === id) ?? null;
}

/**
 * The document owning a manuscript-dir-relative prose path, or null.
 *
 * The primary manuscript's prose filename is not in the registry (it lives in
 * manuscript.json:manuscriptFile), so the caller passes it in; when it is
 * omitted the schema default 'manuscript.md' is assumed.
 */
export function documentForPath(
  m: SunaProjectManifest,
  relPath: string,
  primaryProseFile = 'manuscript.md',
): DocumentEntry | null {
  const wanted = normalizeRel(relPath);
  if (wanted === null) return null;
  for (const doc of resolveDocuments(m)) {
    const file = doc.kind === 'manuscript' ? primaryProseFile : doc.file;
    if (file !== null && normalizeRel(file) === wanted) return doc;
  }
  return null;
}

/** Strip './' and leading slashes; reject anything that escapes upward. */
function normalizeRel(p: string): string | null {
  const cleaned = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (cleaned === '' || cleaned.split('/').includes('..')) return null;
  return cleaned;
}

/**
 * Absolute paths for one document, resolved through the manifest's
 * `directories.manuscript` so a renamed manuscript dir keeps working.
 *
 * For the primary manuscript these return byte-identically what
 * `manuscriptJsonPath` and the prose path return today — the acceptance
 * criterion that makes this a zero-file migration.
 */
export function documentPaths(
  manuscriptDir: string,
  doc: DocumentEntry,
  proseOverride?: string,
): { dir: string; meta: string | null; prose: string | null } {
  const proseRel = doc.kind === 'manuscript' ? (proseOverride ?? 'manuscript.md') : doc.file;
  return {
    dir: manuscriptDir,
    meta: doc.meta === null ? null : joinPath(manuscriptDir, doc.meta),
    prose: proseRel === null ? null : joinPath(manuscriptDir, proseRel),
  };
}

/**
 * Path join that does not import node:path — @suna/core is consumed by the
 * renderer, where node builtins are unavailable.
 */
function joinPath(...parts: readonly string[]): string {
  return parts
    .filter((p) => p !== '')
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .join('/');
}

/**
 * The filenames a new document of this kind owns, with '<id>' and '<slot>'
 * substituted. Used by the creators so no caller hand-builds a filename.
 */
export function filesForKind(kind: DocumentKindId, id: string): KindFiles {
  const template = DOCUMENT_KIND_FILES[kind];
  const sub = (s: string | null): string | null =>
    s === null ? null : s.replace('<id>', id).replace('<slot>', id);
  return {
    meta: sub(template.meta),
    prose: sub(template.prose),
    extra: template.extra.map((e) => e.replace('<id>', id).replace('<slot>', id)),
  };
}
