import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  EVENT_CHANNELS,
  FsNodeSchema,
  type FsNode,
  type RequestOf,
  type ResponseOf,
} from './ipc';
import { DEFAULT_PROJECT_DIRS } from './project';

describe('CHANNELS', () => {
  it('declares exactly the workspace channel set', () => {
    expect(Object.keys(CHANNELS).sort()).toEqual([
      'agent:chat',
      'agent:provider-status',
      'agent:set-key',
      'agent:write-mcp-config',
      'comments:read',
      'comments:write',
      'dialog:pick-directory',
      'env:detect',
      'env:select',
      'env:selected',
      'figure:create',
      'figure:duplicate',
      'figure:export',
      'figure:write-binary',
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
      'lit:ai-search',
      'lit:by-doi',
      'lit:cancel',
      'lit:cli-status',
      'lit:providers',
      'lit:search',
      'lit:set-key',
      'manuscript:update',
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

  it('passes a manuscript:update patch through untouched', () => {
    const req = { dir: '/work/my-paper', patch: { authors: [{ id: 'a1' }] } };
    expect(CHANNELS['manuscript:update'].request.parse(req)).toEqual(req);
  });

  it('rejects a lit:search with an unknown provider or a zero limit', () => {
    const good = { provider: 'crossref', query: 'ram pressure stripping', limit: 20 };
    expect(CHANNELS['lit:search'].request.parse(good)).toEqual(good);
    expect(
      CHANNELS['lit:search'].request.safeParse({ ...good, provider: 'scholar' }).success,
    ).toBe(false);
    expect(CHANNELS['lit:search'].request.safeParse({ ...good, limit: 0 }).success).toBe(false);
  });

  it('keeps the lit:search error channel open alongside results', () => {
    const res: ResponseOf<'lit:search'> = { results: [], error: 'OpenAlex is rate-limited' };
    expect(CHANNELS['lit:search'].response.parse(res)).toEqual(res);
    expect(CHANNELS['lit:search'].response.safeParse({ results: [] }).success).toBe(false);
  });

  it('validates figure:export requests and pixel-dimension responses', () => {
    const req: RequestOf<'figure:export'> = {
      dir: '/work/my-paper',
      figureId: 'fig-spectrum',
      format: 'png',
      widthMm: 180,
      dpi: 300,
      transparent: false,
    };
    expect(CHANNELS['figure:export'].request.parse(req)).toEqual(req);
    expect(CHANNELS['figure:export'].request.safeParse({ ...req, format: 'eps' }).success).toBe(
      false,
    );
    const res: ResponseOf<'figure:export'> = {
      path: '/work/my-paper/output/fig-spectrum.png',
      widthPx: 2126,
      heightPx: 685,
    };
    expect(CHANNELS['figure:export'].response.parse(res)).toEqual(res);
    expect(
      CHANNELS['figure:export'].response.safeParse({ ...res, widthPx: 2126.5 }).success,
    ).toBe(false);
  });

  it('validates figure:create requests and its schema-shaped response', () => {
    const req: RequestOf<'figure:create'> = {
      dir: '/work/my-paper',
      name: 'New spectrum',
      widthMm: 180,
    };
    expect(CHANNELS['figure:create'].request.parse(req)).toEqual(req);
    expect(CHANNELS['figure:create'].request.safeParse({ ...req, widthMm: 0 }).success).toBe(
      false,
    );
    const res: ResponseOf<'figure:create'> = {
      figureId: 'new-spectrum',
      canvasRef: 'figures/new-spectrum/figure.svg',
      svgPath: '/work/my-paper/figures/new-spectrum/figure.svg',
      jsonPath: '/work/my-paper/figures/new-spectrum/figure.json',
      widthMm: 180,
      heightMm: 111.24,
    };
    expect(CHANNELS['figure:create'].response.parse(res)).toEqual(res);
    expect(CHANNELS['figure:create'].response.safeParse({ ...res, canvasRef: 'x.png' }).success).toBe(
      false,
    );
  });

  it('validates the lit:providers capability list', () => {
    const res: ResponseOf<'lit:providers'> = {
      providers: [
        { id: 'crossref', hasKey: false, keyless: true },
        { id: 'ads', hasKey: true, keyless: false },
      ],
    };
    expect(CHANNELS['lit:providers'].response.parse(res)).toEqual(res);
  });

  it('lists only the detected agent CLIs on lit:cli-status', () => {
    const none: ResponseOf<'lit:cli-status'> = { available: [] };
    expect(CHANNELS['lit:cli-status'].response.parse(none)).toEqual(none);
    const both: ResponseOf<'lit:cli-status'> = { available: ['claude', 'codex'] };
    expect(CHANNELS['lit:cli-status'].response.parse(both)).toEqual(both);
    expect(
      CHANNELS['lit:cli-status'].response.safeParse({ available: ['gemini'] }).success,
    ).toBe(false);
  });

  it('pins the lit:ai-search provider to the ai-cli literal and rejects lit:search providers', () => {
    const req: RequestOf<'lit:ai-search'> = {
      provider: 'ai-cli',
      query: 'ram pressure stripping',
      limit: 20,
      dir: '/work/my-paper',
    };
    expect(CHANNELS['lit:ai-search'].request.parse(req)).toEqual(req);
    expect(
      CHANNELS['lit:ai-search'].request.safeParse({ ...req, provider: 'crossref' }).success,
    ).toBe(false);
    const res: ResponseOf<'lit:ai-search'> = { searchId: 'lit-ai-1' };
    expect(CHANNELS['lit:ai-search'].response.parse(res)).toEqual(res);
  });

  it('requires a non-empty searchId on lit:cancel', () => {
    const req: RequestOf<'lit:cancel'> = { searchId: 'lit-ai-1' };
    expect(CHANNELS['lit:cancel'].request.parse(req)).toEqual(req);
    expect(CHANNELS['lit:cancel'].request.safeParse({ searchId: '' }).success).toBe(false);
  });
});

describe('EVENT_CHANNELS', () => {
  it('namespaces lit progress/done events by searchId', () => {
    expect(EVENT_CHANNELS.litProgress('lit-ai-1')).toBe('lit:progress:lit-ai-1');
    expect(EVENT_CHANNELS.litDone('lit-ai-1')).toBe('lit:done:lit-ai-1');
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
