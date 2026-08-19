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
import { DEFAULT_LIBRARY_CONFIG, DEFAULT_LIBRARY_ROOTS } from './library';
import { type LitResult } from './lit';
import { DEFAULT_PROJECT_DIRS } from './project';

/** Gunn & Gott 1972 — the paper feature-plan-10's own examples are written around. */
const GUNN: LitResult = {
  source: 'crossref',
  id: '10.1086/151605',
  doi: '10.1086/151605',
  title: 'On the Infall of Matter Into Clusters of Galaxies and Some Effects on Their Evolution',
  authors: ['James E. Gunn', 'J. Richard Gott III'],
  year: 1972,
  venue: 'The Astrophysical Journal',
  citedByCount: 4212,
  openAccessUrl: null,
  abstract: null,
};

describe('CHANNELS', () => {
  it('declares exactly the workspace channel set', () => {
    expect(Object.keys(CHANNELS).sort()).toEqual([
      'agent:chat',
      'agent:provider-status',
      'agent:set-key',
      'agent:write-mcp-config',
      'ai:ask',
      'ai:cancel',
      'ai:repair-bundle',
      'app:capture-rect',
      'app:dev-info',
      'comments:read',
      'comments:write',
      'dialog:pick-directory',
      'dialog:pick-file',
      'docx:analyze',
      'docx:commit',
      'env:create',
      'env:detect',
      'env:select',
      'env:selected',
      'env:uv-available',
      'export:docx',
      'export:html',
      'export:pdf',
      'figure:create',
      'figure:duplicate',
      'figure:export',
      'figure:write-binary',
      'fs:copy-file',
      'fs:create-file',
      'fs:delete',
      'fs:file-size',
      'fs:list',
      'fs:mkdir',
      'fs:move',
      'fs:read-binary',
      'fs:read-text',
      'fs:rename',
      'fs:write-text',
      'git:abort',
      'git:apply-hunk',
      'git:branches',
      'git:check-remote',
      'git:commit',
      'git:conflict-state',
      'git:continue',
      'git:create-branch',
      'git:delete-branch',
      'git:diff-file',
      'git:discard',
      'git:fetch',
      'git:file-history',
      'git:graph',
      'git:init',
      'git:last-message',
      'git:log',
      'git:mark-resolved',
      'git:merge-branch',
      'git:pull',
      'git:push',
      'git:remote',
      'git:resolve-conflict',
      'git:set-remote',
      'git:show-commit',
      'git:ssh-status',
      'git:stage',
      'git:status',
      'git:switch-branch',
      'git:undo-commit',
      'git:unstage',
      'github:create-repo',
      'github:device-poll',
      'github:device-start',
      'github:owners',
      'github:session',
      'github:sign-out',
      'library:acquire-pdf',
      'library:find-pdf',
      'library:read-config',
      'library:write-config',
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
      'project:migrate',
      'project:open',
      'project:open-example',
      'project:recents',
      'project:scaffold',
      'project:scaffold-status',
      'project:touch-recent',
      'project:update-settings',
      'refnotes:embed',
      'refnotes:list-all',
      'refnotes:read',
      'refnotes:write',
      'settings:get',
      'settings:set',
      'shell:open-path',
      'shell:reveal',
      'term:create',
      'term:kill',
      'term:resize',
      'term:write',
    ]);
  });

  it('carries a migration outcome on every project open', () => {
    const res: ResponseOf<'project:open'> = {
      manifest: {
        schemaVersion: 1,
        name: 'My Paper',
        activeProfileId: 'nature-astronomy',
        directories: DEFAULT_PROJECT_DIRS,
        createdAt: '2026-08-13T09:30:00Z',
      },
      manuscriptPresent: true,
      migration: { migrated: false, notes: ['project is already flat'], error: null },
    };
    expect(CHANNELS['project:open'].response.parse(res)).toEqual(res);
    // The outcome is not optional: a renderer must always know what happened.
    const { migration: _dropped, ...withoutMigration } = res;
    expect(CHANNELS['project:open'].response.safeParse(withoutMigration).success).toBe(false);
  });

  it('reports an abandoned migration as a non-null error with migrated false', () => {
    const req: RequestOf<'project:migrate'> = { dir: '/work/my-paper' };
    expect(CHANNELS['project:migrate'].request.parse(req)).toEqual(req);
    const res: ResponseOf<'project:migrate'> = {
      migrated: false,
      notes: ['nothing was changed — the project is exactly as it was'],
      error: 'manuscript.md already exists — refusing to overwrite it with the migrated prose',
    };
    expect(CHANNELS['project:migrate'].response.parse(res)).toEqual(res);
    expect(
      CHANNELS['project:migrate'].response.safeParse({ migrated: true, notes: [] }).success,
    ).toBe(false);
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
      documentPath: null,
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
      agentLayerWritten: true,
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

  it('validates fs:move batch shapes and keeps the partial-outcome halves separate', () => {
    const req: RequestOf<'fs:move'> = {
      paths: ['/work/my-paper/fig.svg', '/work/my-paper/notes.md'],
      targetDir: '/work/my-paper/data',
    };
    expect(CHANNELS['fs:move'].request.parse(req)).toEqual(req);
    expect(CHANNELS['fs:move'].request.safeParse({ ...req, targetDir: '' }).success).toBe(false);
    expect(CHANNELS['fs:move'].request.safeParse({ paths: [''], targetDir: '/x' }).success).toBe(
      false,
    );
    const res: ResponseOf<'fs:move'> = {
      moved: [{ from: '/work/my-paper/notes.md', to: '/work/my-paper/data/notes.md' }],
      failed: [
        {
          path: '/work/my-paper/fig.svg',
          reason: 'refusing to overwrite an existing file: /work/my-paper/data/fig.svg',
        },
      ],
    };
    expect(CHANNELS['fs:move'].response.parse(res)).toEqual(res);
    // Both halves are always present — "nothing failed" is an empty array, not
    // an absent key, so a caller can loop over both without a guard.
    expect(CHANNELS['fs:move'].response.safeParse({ moved: [] }).success).toBe(false);
    expect(
      CHANNELS['fs:move'].response.safeParse({ moved: [], failed: [{ path: '/x' }] }).success,
    ).toBe(false);
  });

  it('models a successful shell action as a null error on both shell channels', () => {
    const req: RequestOf<'shell:reveal'> = { path: '/work/my-paper/fig.svg' };
    expect(CHANNELS['shell:reveal'].request.parse(req)).toEqual(req);
    expect(CHANNELS['shell:open-path'].request.parse(req)).toEqual(req);
    expect(CHANNELS['shell:reveal'].request.safeParse({ path: '' }).success).toBe(false);
    expect(CHANNELS['shell:reveal'].response.parse({ error: null })).toEqual({ error: null });
    const refused: ResponseOf<'shell:open-path'> = {
      error: 'refusing to open an executable with the OS: setup.command',
    };
    expect(CHANNELS['shell:open-path'].response.parse(refused)).toEqual(refused);
    // Electron's '' success sentinel must be mapped to null before it gets here.
    expect(CHANNELS['shell:open-path'].response.safeParse({}).success).toBe(false);
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
      path: '/work/my-paper/output/figures/fig-spectrum.png',
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
        { id: 'biorxiv', hasKey: false, keyless: true },
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

  it('answers library:read-config with the config AND what its roots resolve to', () => {
    const res: ResponseOf<'library:read-config'> = {
      config: DEFAULT_LIBRARY_CONFIG,
      path: '/Users/ada/SunaConfig/library.json',
      source: 'file',
      error: null,
      expanded: {
        roots: ['/Users/ada/Downloads', '/Users/ada/Documents'],
        // Reported in the STORED form, so the Settings row the user sees is
        // the string they typed — not an expanded path they never wrote.
        missing: ['~/Zotero/storage', '~/Papers'],
        notes: ['library root ~/Papers → /Users/ada/Papers skipped: no such directory'],
      },
    };
    expect(CHANNELS['library:read-config'].response.parse(res)).toEqual(res);
    // Settings cannot say "3 of 4 roots" without it, so it is not optional.
    const { expanded: _dropped, ...withoutExpanded } = res;
    expect(CHANNELS['library:read-config'].response.safeParse(withoutExpanded).success).toBe(false);
  });

  it('keeps a usable config beside a non-null error when library.json is unusable', () => {
    const res: ResponseOf<'library:read-config'> = {
      config: DEFAULT_LIBRARY_CONFIG,
      path: '/Users/ada/SunaConfig/library.json',
      source: 'defaults',
      error: '/Users/ada/SunaConfig/library.json is not valid JSON — using the default library settings',
      expanded: { roots: [], missing: [...DEFAULT_LIBRARY_ROOTS], notes: [] },
    };
    expect(CHANNELS['library:read-config'].response.parse(res)).toEqual(res);
    expect(
      CHANNELS['library:read-config'].response.safeParse({ ...res, source: 'guessed' }).success,
    ).toBe(false);
  });

  it('takes a partial library:write-config patch and rejects an out-of-range one', () => {
    const req: RequestOf<'library:write-config'> = { patch: { useSpotlight: false } };
    expect(CHANNELS['library:write-config'].request.parse(req)).toEqual(req);
    expect(
      CHANNELS['library:write-config'].request.parse({ patch: { roots: ['~/Zotero/storage'] } }),
    ).toEqual({ patch: { roots: ['~/Zotero/storage'] } });
    // The file's own version is not a setting: it never travels in a patch.
    expect(CHANNELS['library:write-config'].request.parse({ patch: { schemaVersion: 1 } })).toEqual({
      patch: {},
    });
    expect(
      CHANNELS['library:write-config'].request.safeParse({ patch: { maxDepth: 0 } }).success,
    ).toBe(false);
    expect(
      CHANNELS['library:write-config'].request.safeParse({ patch: { download: 'sci-hub' } }).success,
    ).toBe(false);
    expect(CHANNELS['library:write-config'].request.safeParse({ patch: { roots: [''] } }).success).toBe(
      false,
    );
  });

  it('carries the whole search context on library:find-pdf, not just the matches', () => {
    const req: RequestOf<'library:find-pdf'> = { result: GUNN, projectRoot: '/work/my-paper' };
    expect(CHANNELS['library:find-pdf'].request.parse(req)).toEqual(req);
    expect(CHANNELS['library:find-pdf'].request.safeParse({ result: GUNN }).success).toBe(false);

    const res: ResponseOf<'library:find-pdf'> = {
      matches: [
        {
          path: '/Users/ada/Zotero/storage/ABCD1234/Gunn_1972_Infall.pdf',
          sizeBytes: 812_345,
          confidence: 'high',
          evidence: ['doi-in-bytes', 'filename-author-year'],
        },
      ],
      rootsSearched: ['/Users/ada/Downloads'],
      rootsMissing: ['~/Papers'],
      scanned: 1_204,
      truncated: false,
      notes: ['library root ~/Papers → /Users/ada/Papers skipped: no such directory'],
      error: null,
    };
    expect(CHANNELS['library:find-pdf'].response.parse(res)).toEqual(res);
    // "No match anywhere" and "we could not search" must not look alike.
    const { error: _dropped, ...withoutError } = res;
    expect(CHANNELS['library:find-pdf'].response.safeParse(withoutError).success).toBe(false);
    // A match with no evidence is a guess, and guesses are not returned.
    expect(
      CHANNELS['library:find-pdf'].response.safeParse({
        ...res,
        matches: [{ ...res.matches[0], evidence: [] }],
      }).success,
    ).toBe(false);
    expect(
      CHANNELS['library:find-pdf'].response.safeParse({ ...res, scanned: -1 }).success,
    ).toBe(false);
  });

  it('requires an explicit policy on library:acquire-pdf, null meaning "as configured"', () => {
    const req: RequestOf<'library:acquire-pdf'> = {
      result: GUNN,
      citekey: 'gunn1972',
      projectRoot: '/work/my-paper',
      policy: null,
    };
    expect(CHANNELS['library:acquire-pdf'].request.parse(req)).toEqual(req);
    expect(CHANNELS['library:acquire-pdf'].request.parse({ ...req, policy: 'off' }).policy).toBe(
      'off',
    );
    // Explicitly null, never absent — the renderer must say which it means.
    const { policy: _dropped, ...withoutPolicy } = req;
    expect(CHANNELS['library:acquire-pdf'].request.safeParse(withoutPolicy).success).toBe(false);
    expect(
      CHANNELS['library:acquire-pdf'].request.safeParse({ ...req, citekey: '' }).success,
    ).toBe(false);
  });

  it('names which acquisition happened, or nulls it beside an error', () => {
    const copied: ResponseOf<'library:acquire-pdf'> = {
      acquisition: 'copied-local',
      path: '/work/my-paper/references/gunn1972.pdf',
      relativePath: 'references/gunn1972.pdf',
      source: '/Users/ada/Zotero/storage/ABCD1234/Gunn_1972_Infall.pdf',
      matches: [
        {
          path: '/Users/ada/Zotero/storage/ABCD1234/Gunn_1972_Infall.pdf',
          sizeBytes: 812_345,
          confidence: 'high',
          evidence: ['doi-in-bytes'],
        },
      ],
      notes: ['local scan: 1 match across 1 root (/Users/ada/Zotero/storage), 1204 files examined'],
      error: null,
    };
    expect(CHANNELS['library:acquire-pdf'].response.parse(copied)).toEqual(copied);

    // Nothing was attempted: that is NOT 'metadata-only', which means "we
    // looked everywhere and there is no PDF".
    const refused: ResponseOf<'library:acquire-pdf'> = {
      acquisition: null,
      path: null,
      relativePath: null,
      source: null,
      matches: [],
      notes: [],
      error: 'path is outside any open project: /etc',
    };
    expect(CHANNELS['library:acquire-pdf'].response.parse(refused)).toEqual(refused);
    expect(
      CHANNELS['library:acquire-pdf'].response.safeParse({ ...copied, acquisition: 'unresolved' })
        .success,
    ).toBe(false);
  });

  it('requires a non-empty prompt and dir on ai:ask', () => {
    const req: RequestOf<'ai:ask'> = { prompt: 'why is the sky blue', dir: '/work/my-paper' };
    expect(CHANNELS['ai:ask'].request.parse(req)).toEqual(req);
    expect(CHANNELS['ai:ask'].request.safeParse({ ...req, prompt: '' }).success).toBe(false);
    expect(CHANNELS['ai:ask'].request.safeParse({ prompt: req.prompt }).success).toBe(false);
    const res: ResponseOf<'ai:ask'> = { askId: 'ai-ask-1' };
    expect(CHANNELS['ai:ask'].response.parse(res)).toEqual(res);
  });

  it('validates docx:analyze and docx:commit shapes end to end', () => {
    const analysis: RequestOf<'docx:commit'>['analysis'] = {
      sourcePath: '/Users/ada/Downloads/sleepTI_draft_v0.9.docx',
      tempDir: '/tmp/suna-docx-import-1',
      title: { value: 'Sleep and thermal inertia', reason: 'first fully-bold paragraph before body text' },
      authors: [
        {
          name: 'Ada Researcher',
          given: 'Ada',
          family: 'Researcher',
          markers: ['1'],
          affiliationRefs: ['1'],
        },
      ],
      authorsReason: 'paragraph after the title containing <sup> markers',
      affiliations: [{ marker: '1', text: 'Department of Sleep Medicine' }],
      affiliationsReason: 'short paragraphs after the author line starting with a digit marker',
      abstract: { value: 'We report on…', reason: 'paragraph following a heading matching /abstract/i' },
      significance: { value: 'Why it matters.', reason: 'prose under a "Significance" heading' },
      highlights: { value: ['Slow waves increase.'], reason: '1 bullet under a "Highlights" heading' },
      keywords: { value: ['sleep', 'tTIS'], reason: 'a paragraph starting "Keywords:…"' },
      sections: [{ heading: 'Introduction', level: 1, markdown: 'Body text.' }],
      references: [
        {
          raw: '1. Smith, J. (2020). A title. J. Sleep, 1, 1-2.',
          style: 'numbered',
          number: 1,
          authors: ['Smith, J.'],
          year: '2020',
          title: 'A title',
          journal: 'J. Sleep',
          doi: null,
          citeKey: 'smith2020atitle',
        },
      ],
      citationReport: { mappedCount: 1, literalCount: 0 },
      figures: [{ id: 'imported-1', tempPath: '/tmp/suna-docx-import-1/image-1.png', ext: 'png', alt: '' }],
      warnings: [{ code: 'omml-equations', message: '2 equations detected (OMML) — not converted', context: null }],
    };
    const analyzeReq: RequestOf<'docx:analyze'> = { path: analysis.sourcePath };
    expect(CHANNELS['docx:analyze'].request.parse(analyzeReq)).toEqual(analyzeReq);
    const analyzeRes: ResponseOf<'docx:analyze'> = { analysis };
    expect(CHANNELS['docx:analyze'].response.parse(analyzeRes)).toEqual(analyzeRes);

    const commitReq: RequestOf<'docx:commit'> = { analysis, dir: '/work/imported-paper', force: false };
    expect(CHANNELS['docx:commit'].request.parse(commitReq)).toEqual(commitReq);
    const commitRes: ResponseOf<'docx:commit'> = { dir: '/work/imported-paper' };
    expect(CHANNELS['docx:commit'].response.parse(commitRes)).toEqual(commitRes);
  });

  it('rejects a docx:commit analysis with an unknown reference style', () => {
    const bad: unknown = {
      analysis: {
        sourcePath: '/x.docx',
        tempDir: null,
        title: { value: null, reason: 'no heading or bold paragraph found' },
        authors: [],
        authorsReason: 'no candidate paragraph found',
        affiliations: [],
        affiliationsReason: 'no marker paragraphs found',
        abstract: { value: null, reason: 'no heading matching /abstract|summary/i found' },
        sections: [],
        references: [
          {
            raw: 'x',
            style: 'apa', // not a valid DocxReferenceStyle
            number: null,
            authors: [],
            year: null,
            title: null,
            journal: null,
            citeKey: 'x',
          },
        ],
        citationReport: { mappedCount: 0, literalCount: 0 },
        figures: [],
        warnings: [],
      },
      dir: '/work/x',
      force: false,
    };
    expect(CHANNELS['docx:commit'].request.safeParse(bad).success).toBe(false);
  });

  it('requires a non-empty askId on ai:cancel', () => {
    const req: RequestOf<'ai:cancel'> = { askId: 'ai-ask-1' };
    expect(CHANNELS['ai:cancel'].request.parse(req)).toEqual(req);
    expect(CHANNELS['ai:cancel'].request.safeParse({ askId: '' }).success).toBe(false);
  });

  it('validates export:docx request/response shapes', () => {
    const req: RequestOf<'export:docx'> = {
      dir: '/work/my-paper',
      profileId: 'nature-astronomy',
      outputName: 'my-paper',
      figurePngPaths: { 'fig-spectrum': '/work/my-paper/output/figures/fig-spectrum.png' },
      options: { doubleSpacing: true, lineNumbers: true, pageNumbers: true },
      target: 'manuscript',
    };
    expect(CHANNELS['export:docx'].request.parse(req)).toEqual(req);
    expect(CHANNELS['export:docx'].request.safeParse({ ...req, dir: '' }).success).toBe(false);
    const res: ResponseOf<'export:docx'> = {
      path: '/work/my-paper/output/my-paper.docx',
    };
    expect(CHANNELS['export:docx'].response.parse(res)).toEqual(res);
  });

  it('validates export:pdf request/response shapes', () => {
    const req: RequestOf<'export:pdf'> = {
      dir: '/work/my-paper',
      profileId: 'science',
      outputName: 'my-paper',
      figurePngPaths: {},
      options: { doubleSpacing: false, lineNumbers: false, pageNumbers: true },
      target: 'manuscript',
    };
    expect(CHANNELS['export:pdf'].request.parse(req)).toEqual(req);
    const res: ResponseOf<'export:pdf'> = { path: '/work/my-paper/output/my-paper.pdf' };
    expect(CHANNELS['export:pdf'].response.parse(res)).toEqual(res);
  });

  it('validates export:html request/response shapes', () => {
    const req: RequestOf<'export:html'> = {
      dir: '/work/my-paper',
      profileId: 'suna',
      outputName: 'my-paper',
      figurePngPaths: { 'fig-spectrum': '/work/my-paper/output/figures/fig-spectrum.png' },
      options: { doubleSpacing: false, lineNumbers: false, pageNumbers: true },
      target: 'manuscript',
    };
    expect(CHANNELS['export:html'].request.parse(req)).toEqual(req);
    expect(CHANNELS['export:html'].request.safeParse({ ...req, outputName: '' }).success).toBe(
      false,
    );
    const res: ResponseOf<'export:html'> = { path: '/work/my-paper/output/my-paper.html' };
    expect(CHANNELS['export:html'].response.parse(res)).toEqual(res);
  });

  it('defaults the export target to manuscript so a target-less request stays valid (additive)', () => {
    const legacy = {
      dir: '/work/my-paper',
      profileId: 'nature-astronomy',
      outputName: 'my-paper',
      figurePngPaths: {},
      options: { doubleSpacing: false, lineNumbers: false, pageNumbers: true },
    };
    expect(CHANNELS['export:docx'].request.parse(legacy).target).toBe('manuscript');
    expect(CHANNELS['export:html'].request.parse(legacy).target).toBe('manuscript');
    expect(CHANNELS['export:pdf'].request.parse(legacy).target).toBe('manuscript');
  });

  it('round-trips the supplement target and rejects an unknown one', () => {
    const req: RequestOf<'export:docx'> = {
      dir: '/work/my-paper',
      profileId: 'sleep',
      outputName: 'my-paper-supplement',
      figurePngPaths: {},
      options: { doubleSpacing: false, lineNumbers: false, pageNumbers: true },
      target: 'supplement',
    };
    expect(CHANNELS['export:docx'].request.parse(req).target).toBe('supplement');
    expect(CHANNELS['export:html'].request.parse(req).target).toBe('supplement');
    expect(CHANNELS['export:pdf'].request.parse(req).target).toBe('supplement');
    expect(
      CHANNELS['export:docx'].request.safeParse({ ...req, target: 'appendix' }).success,
    ).toBe(false);
    expect(
      CHANNELS['export:pdf'].request.safeParse({ ...req, target: 'appendix' }).success,
    ).toBe(false);
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
