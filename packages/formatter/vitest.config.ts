import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The word-limit rules are exercised against deliberately enormous inputs —
    // `words(90000)` is a manuscript an order of magnitude past any real one,
    // which is the point: the rule must hold at the extreme, not just at a
    // plausible length. Counting that many words crosses vitest's 5 s default
    // on an unloaded machine, and it then fails as a TIMEOUT, which reads like
    // a compliance-checker regression rather than a slow fixture.
    //
    // `pnpm -r` stops at the first failing package, so this one flake also
    // prevents `@suna/agent` and `apps/desktop` from running at all in the same
    // invocation. The budget is raised; no assertion is weakened.
    testTimeout: 30_000,
  },
});
