/** Internal helpers shared by the figure and manuscript checkers. */

/**
 * Inline citation of the profile section's stated source, appended to
 * diagnostic messages when the first source URL is short enough to read
 * inline; empty string otherwise.
 */
export function sourceSuffix(sources: readonly string[], maxLen = 64): string {
  const first = sources[0];
  return first !== undefined && first.length > 0 && first.length <= maxLen
    ? ` (per ${first})`
    : '';
}

/** Render a measured number compactly (max two decimals, no trailing zeros). */
export function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}
