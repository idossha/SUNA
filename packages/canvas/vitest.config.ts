import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The inverse-integrity fuzz suite serializes a real matplotlib fixture
    // after every one of 34 commands, then again through a full undo-all /
    // redo-all / undo-all, comparing bytes at each step. Alone it takes ~3.5 s;
    // sharing a machine with the rest of `pnpm -r test` it crosses vitest's 5 s
    // default and fails as a TIMEOUT, which reads exactly like a byte-identity
    // regression in the repo's most load-bearing assertion.
    //
    // That misreading is not the only cost. `pnpm -r` stops at the first failing
    // package, so a canvas flake here means `apps/desktop` — 170 files, 2315
    // tests — never runs at all, and a whole suite silently going unrun is a
    // worse outcome than a slow one. The budget is raised, not the assertion
    // weakened.
    testTimeout: 30_000,
  },
});
