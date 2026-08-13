/** Shared helpers for @suna/canvas tests (not exported from the package). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CommandResult, CommandSuccess } from '@suna/core';
import { CanvasDocument } from './document';
import { createBrowserDomAdapter } from './dom';

/** vitest runs with cwd = the package root (where vitest.config.ts lives). */
export const FIXTURE_PATH = resolve(process.cwd(), 'fixtures/mpl-two-panel.svg');

export function readFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf8');
}

export function open(svgText: string): CanvasDocument {
  return new CanvasDocument(svgText, createBrowserDomAdapter());
}

export function openFixture(): { doc: CanvasDocument; source: string } {
  const source = readFixture();
  return { doc: open(source), source };
}

/** Narrow a CommandResult to success, failing the test loudly otherwise. */
export function mustOk(result: CommandResult): CommandSuccess {
  if (!result.ok) {
    throw new Error(`expected command to succeed, got ${result.error.code}: ${result.error.message}`);
  }
  return result;
}
