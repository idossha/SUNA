import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  EVENT_CHANNELS,
  FsNodeSchema,
  MAX_READ_BINARY_BYTES,
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
      'ai:ask',
      'ai:cancel',
      'comments:read',
      'comments:write',
      'dialog:pick-directory',
      'dialog:pick-file',
      'env:create',
      'env:detect',
      'env:select',
      'env:selected',
      'env:uv-available',
      'figure:create',
      'figure:duplicate',
      'figure:export',
      'figure:write-binary',
      'fs:copy-file',
      'fs:create-file',
      'fs:delete',
      'fs:list',
      'fs:mkdir',
      'fs:read-binary',
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
      'project:check-target',
      'project:create',
      'project:forget-recent',
      'project:list-importable',
      'project:open',
      'project:open-example',
      'project:recents',
      'project:scaffold',
      'project:scaffold-status',
      'project:touch-recent',
      'project:update-settings',
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

  it('validates a project:update-settings patch and rejects an out-of-range one', () => {
    const req: RequestOf<'project:update-settings'> = {
      dir: '/work/my-paper',
      patch: { editor: { contentWidthCh: 90 } },
    };
    expect(CHANNELS['project:update-settings'].request.parse(req)).toEqual(req);
    // null is how "Reset to global" travels
    expect(
      CHANNELS['project:update-settings'].request.safeParse({
        dir: req.dir,
        patch: { editor: { contentWidthCh: null } },
      }).success,
    ).toBe(true);
    expect(
      CHANNELS['project:update-settings'].request.safeParse({
        dir: req.dir,
        patch: { editor: { contentWidthCh: 4000 } },
      }).success,
    ).toBe(false);
  });

  it('returns the whole manifest from project:update-settings', () => {
    const res: ResponseOf<'project:update-settings'> = {
      manifest: {
        schemaVersion: 1,
        name: 'My Paper',
        activeProfileId: 'nature-astronomy',
        directories: DEFAULT_PROJECT_DIRS,
        createdAt: '2026-08-13T09:30:00Z',
        settings: { editor: { contentWidthCh: 90 } },
      },
    };
    expect(CHANNELS['project:update-settings'].response.parse(res)).toEqual(res);
  });

  it('carries a freshly stat-ed exists flag on every recents row', () => {
    const res: ResponseOf<'project:recents'> = {
      recents: [
        {
          path: '/work/my-paper',
          name: 'My Paper',
          lastOpenedAt: '2026-08-15T10:00:00.000Z',
          exists: true,
        },
      ],
    };
    expect(CHANNELS['project:recents'].response.parse(res)).toEqual(res);
    expect(
      CHANNELS['project:recents'].response.safeParse({
        recents: [{ path: '/work/p', name: 'P', lastOpenedAt: '2026-08-15T10:00:00.000Z' }],
      }).success,
    ).toBe(false);
  });

  it('requires a path and name on project:touch-recent and a path on forget', () => {
    const req: RequestOf<'project:touch-recent'> = { path: '/work/my-paper', name: 'My Paper' };
    expect(CHANNELS['project:touch-recent'].request.parse(req)).toEqual(req);
    expect(CHANNELS['project:touch-recent'].request.safeParse({ path: req.path }).success).toBe(
      false,
    );
    expect(CHANNELS['project:forget-recent'].request.safeParse({ path: '' }).success).toBe(false);
  });

  it('validates project:check-target request/response shapes', () => {
    const req: RequestOf<'project:check-target'> = { parentDir: '/work', name: 'my-paper' };
    expect(CHANNELS['project:check-target'].request.parse(req)).toEqual(req);
    const res: ResponseOf<'project:check-target'> = {
      path: '/work/my-paper',
      exists: false,
      parentWritable: true,
    };
    expect(CHANNELS['project:check-target'].response.parse(res)).toEqual(res);
  });

  it('validates project:list-importable response and rejects an unknown extension', () => {
    const res: ResponseOf<'project:list-importable'> = {
      files: [{ path: '/work/paper/intro.md', name: 'intro.md', ext: 'md' }],
    };
    expect(CHANNELS['project:list-importable'].response.parse(res)).toEqual(res);
    expect(
      CHANNELS['project:list-importable'].response.safeParse({
        files: [{ path: '/x/a.docx', name: 'a.docx', ext: 'docx' }],
      }).success,
    ).toBe(false);
  });

  it('validates project:scaffold request/response and rejects an unknown scaffold kind', () => {
    const req: RequestOf<'project:scaffold'> = {
      dir: '/work/my-paper',
      name: 'My Paper',
      activeProfileId: 'nature-astronomy',
      scaffold: 'starter',
      importDir: null,
      settings: { editor: { contentWidthCh: 90 } },
    };
    expect(CHANNELS['project:scaffold'].request.parse(req)).toEqual(req);
    expect(
      CHANNELS['project:scaffold'].request.safeParse({ ...req, scaffold: 'template' }).success,
    ).toBe(false);
    const res: ResponseOf<'project:scaffold'> = {
      manifest: {
        schemaVersion: 1,
        name: 'My Paper',
        activeProfileId: 'nature-astronomy',
        directories: DEFAULT_PROJECT_DIRS,
        createdAt: '2026-08-15T10:00:00.000Z',
      },
      gitInitialized: true,
      warnings: [],
    };
    expect(CHANNELS['project:scaffold'].response.parse(res)).toEqual(res);
  });

  it('validates env:uv-available and env:create shapes', () => {
    const uvRes: ResponseOf<'env:uv-available'> = { available: false };
    expect(CHANNELS['env:uv-available'].response.parse(uvRes)).toEqual(uvRes);
    const createReq: RequestOf<'env:create'> = { dir: '/work/my-paper' };
    expect(CHANNELS['env:create'].request.parse(createReq)).toEqual(createReq);
    const createRes: ResponseOf<'env:create'> = {
      ok: false,
      envPath: null,
      error: 'uv is not installed or not on PATH',
    };
    expect(CHANNELS['env:create'].response.parse(createRes)).toEqual(createRes);
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

  it('validates fs:read-binary shapes and rejects a fractional byte count', () => {
    const req: RequestOf<'fs:read-binary'> = { path: 'references/nphys3816.pdf' };
    expect(CHANNELS['fs:read-binary'].request.parse(req)).toEqual(req);
    const res: ResponseOf<'fs:read-binary'> = { base64: 'JVBERi0=', bytes: 6 };
    expect(CHANNELS['fs:read-binary'].response.parse(res)).toEqual(res);
    expect(CHANNELS['fs:read-binary'].response.safeParse({ base64: 'JVBERi0=' }).success).toBe(
      false,
    );
    expect(CHANNELS['fs:read-binary'].response.safeParse({ ...res, bytes: 6.5 }).success).toBe(
      false,
    );
  });

  it('keeps the fs:read-binary ceiling at 200MB', () => {
    expect(MAX_READ_BINARY_BYTES).toBe(209_715_200);
  });

  it('validates fs:copy-file both-paths-required shapes', () => {
    const req: RequestOf<'fs:copy-file'> = {
      from: '/Users/ada/Downloads/gunn1972.pdf',
      to: '/work/my-paper/references/gunn1972.pdf',
    };
    expect(CHANNELS['fs:copy-file'].request.parse(req)).toEqual(req);
    expect(CHANNELS['fs:copy-file'].request.safeParse({ from: req.from }).success).toBe(false);
    expect(CHANNELS['fs:copy-file'].request.safeParse({ ...req, to: '' }).success).toBe(false);
    const res: ResponseOf<'fs:copy-file'> = { path: req.to };
    expect(CHANNELS['fs:copy-file'].response.parse(res)).toEqual(res);
  });

  it('allows a cancelled dialog:pick-file but never an empty path', () => {
    const req: RequestOf<'dialog:pick-file'> = { title: 'Attach PDF', extensions: ['pdf'] };
    expect(CHANNELS['dialog:pick-file'].request.parse(req)).toEqual(req);
    expect(CHANNELS['dialog:pick-file'].request.parse({ ...req, extensions: [] }).extensions).toEqual(
      [],
    );
    expect(CHANNELS['dialog:pick-file'].response.parse({ path: null })).toEqual({ path: null });
    expect(CHANNELS['dialog:pick-file'].response.safeParse({ path: '' }).success).toBe(false);
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

  it('requires a non-empty prompt and dir on ai:ask', () => {
    const req: RequestOf<'ai:ask'> = { prompt: 'why is the sky blue', dir: '/work/my-paper' };
    expect(CHANNELS['ai:ask'].request.parse(req)).toEqual(req);
    expect(CHANNELS['ai:ask'].request.safeParse({ ...req, prompt: '' }).success).toBe(false);
    expect(CHANNELS['ai:ask'].request.safeParse({ prompt: req.prompt }).success).toBe(false);
    const res: ResponseOf<'ai:ask'> = { askId: 'ai-ask-1' };
    expect(CHANNELS['ai:ask'].response.parse(res)).toEqual(res);
  });

  it('requires a non-empty askId on ai:cancel', () => {
    const req: RequestOf<'ai:cancel'> = { askId: 'ai-ask-1' };
    expect(CHANNELS['ai:cancel'].request.parse(req)).toEqual(req);
    expect(CHANNELS['ai:cancel'].request.safeParse({ askId: '' }).success).toBe(false);
  });
});

describe('EVENT_CHANNELS', () => {
  it('namespaces lit progress/done events by searchId', () => {
    expect(EVENT_CHANNELS.litProgress('lit-ai-1')).toBe('lit:progress:lit-ai-1');
    expect(EVENT_CHANNELS.litDone('lit-ai-1')).toBe('lit:done:lit-ai-1');
  });

  it('namespaces ai:ask progress/done events by askId', () => {
    expect(EVENT_CHANNELS.aiAskProgress('ai-ask-1')).toBe('ai:progress:ai-ask-1');
    expect(EVENT_CHANNELS.aiAskDone('ai-ask-1')).toBe('ai:done:ai-ask-1');
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
