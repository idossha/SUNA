import { describe, expect, it } from 'vitest';
import { CHANNELS, FsNodeSchema, type FsNode, type RequestOf, type ResponseOf } from './ipc';
import { DEFAULT_PROJECT_DIRS } from './project';

describe('CHANNELS', () => {
  it('declares exactly the workspace channel set', () => {
    expect(Object.keys(CHANNELS).sort()).toEqual([
      'agent:chat',
      'agent:provider-status',
      'agent:set-key',
      'agent:write-mcp-config',
      'dialog:pick-directory',
      'env:detect',
      'env:select',
      'env:selected',
      'fs:create-file',
      'fs:delete',
      'fs:list',
      'fs:mkdir',
      'fs:read-text',
      'fs:rename',
      'fs:write-text',
      'git:commit',
      'git:diff-file',
      'git:init',
      'git:log',
      'git:status',
      'project:create',
      'project:open',
      'project:open-example',
      'project:scaffold-status',
      'settings:get',
      'settings:set',
      'term:create',
      'term:kill',
      'term:resize',
      'term:write',
    ]);
  });

  it('types and validates project:create request/response', () => {
    const req: RequestOf<'project:create'> = { dir: '/work/my-paper', name: 'My Paper' };
    expect(CHANNELS['project:create'].request.parse(req)).toEqual(req);

    const res: ResponseOf<'project:create'> = {
      schemaVersion: 1,
      name: 'My Paper',
      activeProfileId: 'nature-astronomy',
      directories: DEFAULT_PROJECT_DIRS,
      createdAt: '2026-08-13T09:30:00Z',
    };
    expect(CHANNELS['project:create'].response.parse(res)).toEqual(res);
  });

  it('rejects a project:create request missing the name', () => {
    const bad: unknown = { dir: '/work/my-paper' };
    expect(CHANNELS['project:create'].request.safeParse(bad).success).toBe(false);
  });

  it('validates a scaffold-status response over all directory keys', () => {
    const res: ResponseOf<'project:scaffold-status'> = {
      manifestPresent: true,
      dirs: {
        manuscript: true,
        figures: true,
        code: false,
        data: false,
        analysis: false,
        results: false,
        output: true,
      },
    };
    expect(CHANNELS['project:scaffold-status'].response.parse(res)).toEqual(res);
  });

  it('rejects a scaffold-status response missing a directory key', () => {
    const bad: unknown = {
      manifestPresent: true,
      dirs: { manuscript: true },
    };
    expect(CHANNELS['project:scaffold-status'].response.safeParse(bad).success).toBe(false);
  });

  it('validates fs:write-text round trip shapes', () => {
    const req: RequestOf<'fs:write-text'> = {
      path: 'manuscript/sections/intro.md',
      content: 'We report…',
    };
    expect(CHANNELS['fs:write-text'].request.parse(req)).toEqual(req);
    const res: ResponseOf<'fs:write-text'> = { bytesWritten: 12 };
    expect(CHANNELS['fs:write-text'].response.parse(res)).toEqual(res);
  });
});

describe('FsNodeSchema', () => {
  const tree = {
    kind: 'dir',
    name: 'my-paper',
    path: '.',
    children: [
      { kind: 'file', name: 'suna.json', path: 'suna.json' },
      {
        kind: 'dir',
        name: 'manuscript',
        path: 'manuscript',
        children: [
          { kind: 'file', name: 'manuscript.json', path: 'manuscript/manuscript.json' },
          {
            kind: 'dir',
            name: 'sections',
            path: 'manuscript/sections',
            children: [{ kind: 'file', name: 'intro.md', path: 'manuscript/sections/intro.md' }],
          },
        ],
      },
    ],
  } satisfies FsNode;

  it('parses a recursive project tree via fs:list', () => {
    const res = CHANNELS['fs:list'].response.parse({ root: tree });
    expect(res).toEqual({ root: tree });
  });

  it('parses nested directories to full depth', () => {
    const parsed = FsNodeSchema.parse(tree);
    if (parsed.kind !== 'dir') throw new Error('expected dir node');
    const manuscript = parsed.children[1];
    if (manuscript?.kind !== 'dir') throw new Error('expected dir node');
    const sections = manuscript.children[1];
    if (sections?.kind !== 'dir') throw new Error('expected dir node');
    expect(sections.children[0]?.name).toBe('intro.md');
  });

  it('rejects a node with an unknown kind', () => {
    const bad: unknown = { kind: 'symlink', name: 'x', path: 'x' };
    expect(FsNodeSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a dir whose child is malformed', () => {
    const bad: unknown = {
      kind: 'dir',
      name: 'root',
      path: '.',
      children: [{ kind: 'file', name: '' }],
    };
    expect(FsNodeSchema.safeParse(bad).success).toBe(false);
  });
});
