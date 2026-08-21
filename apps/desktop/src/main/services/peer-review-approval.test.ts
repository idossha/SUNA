import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_DIRS, SunaProjectManifestSchema } from '@suna/core'
import { approvePeerReviewAi, peerReviewHash, sha256 } from './peer-review-approval'
import { allowRoot } from './roots'

/**
 * The gate's whole value is that the record is trustworthy: it must pin the
 * approval to bytes that were really on disk, must refuse when there is
 * nothing to approve, and must not damage a manifest it only partly
 * understands.
 */

let dir = ''

const MANIFEST = {
  schemaVersion: 1,
  name: 'Test paper',
  activeProfileId: 'nature',
  directories: DEFAULT_PROJECT_DIRS,
  createdAt: '2026-01-01T00:00:00.000Z'
}

async function writeManifest(extra: Record<string, unknown> = {}): Promise<void> {
  await writeFile(join(dir, 'suna.json'), JSON.stringify({ ...MANIFEST, ...extra }, null, 2), 'utf8')
}

async function writeGuidelines(text: string): Promise<void> {
  await mkdir(join(dir, 'context'), { recursive: true })
  await writeFile(join(dir, 'context', 'PEER-REVIEW.md'), text, 'utf8')
}

async function readManifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, 'suna.json'), 'utf8')) as Record<string, unknown>
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-approval-'))
  allowRoot(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('peerReviewHash', () => {
  it('is null when there is no guidelines file', async () => {
    expect(await peerReviewHash(dir)).toBeNull()
  })

  it('is null for a whitespace-only file — nothing to have approved', async () => {
    await writeGuidelines('   \n\n')
    expect(await peerReviewHash(dir)).toBeNull()
  })

  it('is the sha256 of the file exactly as written', async () => {
    await writeGuidelines('# Answering reviewers\n\n- Be brief.\n')
    expect(await peerReviewHash(dir)).toBe(sha256('# Answering reviewers\n\n- Be brief.\n'))
  })

  it('changes when a single character changes', async () => {
    await writeGuidelines('- Be brief.\n')
    const before = await peerReviewHash(dir)
    await writeGuidelines('- Be brief!\n')
    expect(await peerReviewHash(dir)).not.toBe(before)
  })
})

describe('approvePeerReviewAi', () => {
  it('records the approval against the hash of what is on disk', async () => {
    const text = '# Answering reviewers\n\n- Never open with thanks.\n'
    await writeGuidelines(text)
    await writeManifest()

    const { approval, manifest } = await approvePeerReviewAi({
      dir,
      approvedBy: 'A. Author',
      source: 'suggested',
      learnedFrom: null
    })

    expect(approval.contentHash).toBe(sha256(text))
    expect(approval.approvedBy).toBe('A. Author')
    expect(approval.source).toBe('suggested')
    expect(approval.learnedFrom).toBeNull()
    expect(Date.parse(approval.approvedAt)).not.toBeNaN()
    expect(manifest.approvals?.peerReviewAi?.contentHash).toBe(approval.contentHash)
  })

  it('persists it into suna.json, not just the returned object', async () => {
    await writeGuidelines('- x\n')
    await writeManifest()
    await approvePeerReviewAi({ dir, approvedBy: 'You', source: 'manual', learnedFrom: null })

    const onDisk = await readManifest()
    const approvals = onDisk['approvals'] as Record<string, unknown>
    expect((approvals['peerReviewAi'] as Record<string, unknown>)['approvedBy']).toBe('You')
    // And it still parses as a manifest.
    expect(() => SunaProjectManifestSchema.parse(onDisk)).not.toThrow()
  })

  it('keeps the imported route’s source document on the record', async () => {
    await writeGuidelines('- x\n')
    await writeManifest()
    const { approval } = await approvePeerReviewAi({
      dir,
      approvedBy: 'You',
      source: 'imported',
      learnedFrom: '/Users/x/reply-a.docx'
    })
    expect(approval.learnedFrom).toBe('/Users/x/reply-a.docx')
  })

  it('refuses when there are no guidelines to approve', async () => {
    await writeManifest()
    await expect(
      approvePeerReviewAi({ dir, approvedBy: 'You', source: 'suggested', learnedFrom: null })
    ).rejects.toThrow(/no guidelines to approve/)
  })

  it('refuses to record consent to an empty file', async () => {
    await writeGuidelines('\n   \n')
    await writeManifest()
    await expect(
      approvePeerReviewAi({ dir, approvedBy: 'You', source: 'manual', learnedFrom: null })
    ).rejects.toThrow(/empty/)
  })

  it('refuses outside a SUNA project', async () => {
    await writeGuidelines('- x\n')
    await expect(
      approvePeerReviewAi({ dir, approvedBy: 'You', source: 'manual', learnedFrom: null })
    ).rejects.toThrow(/not a SUNA project/)
  })

  it('preserves manifest keys this schema version does not know', async () => {
    await writeGuidelines('- x\n')
    await writeManifest({ futureKey: { nested: [1, 2, 3] } })
    await approvePeerReviewAi({ dir, approvedBy: 'You', source: 'manual', learnedFrom: null })
    expect((await readManifest())['futureKey']).toEqual({ nested: [1, 2, 3] })
  })

  it('preserves other approvals beside its own', async () => {
    await writeGuidelines('- x\n')
    await writeManifest({ approvals: { somethingElse: { ok: true } } })
    await approvePeerReviewAi({ dir, approvedBy: 'You', source: 'manual', learnedFrom: null })
    const approvals = (await readManifest())['approvals'] as Record<string, unknown>
    expect(approvals['somethingElse']).toEqual({ ok: true })
    expect(approvals['peerReviewAi']).toBeDefined()
  })

  it('re-approving after an edit records the NEW text', async () => {
    await writeGuidelines('- first\n')
    await writeManifest()
    const first = await approvePeerReviewAi({
      dir,
      approvedBy: 'You',
      source: 'suggested',
      learnedFrom: null
    })
    await writeGuidelines('- second\n')
    const second = await approvePeerReviewAi({
      dir,
      approvedBy: 'You',
      source: 'manual',
      learnedFrom: null
    })
    expect(second.approval.contentHash).not.toBe(first.approval.contentHash)
    expect(second.approval.contentHash).toBe(sha256('- second\n'))
  })

  it('rejects a corrupt manifest rather than overwriting it', async () => {
    await writeGuidelines('- x\n')
    await writeFile(join(dir, 'suna.json'), '{ not json', 'utf8')
    await expect(
      approvePeerReviewAi({ dir, approvedBy: 'You', source: 'manual', learnedFrom: null })
    ).rejects.toThrow(/not valid JSON/)
    expect(await readFile(join(dir, 'suna.json'), 'utf8')).toBe('{ not json')
  })
})
