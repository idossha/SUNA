#!/usr/bin/env node
/**
 * Normalise the site's Markdown for VitePress's Vue-flavoured pipeline.
 *
 * VitePress compiles every page as a Vue SFC template, and CommonMark runs
 * first. Two characters inside a <kbd> break that order, both with the same
 * baffling "Element is missing end tag" error:
 *
 *   <kbd>⌘\</kbd>   the backslash escapes the closing tag's `<`
 *   <kbd>⌃`</kbd>   the backtick opens a code span that swallows </kbd> when
 *                   the same paragraph mentions another backtick
 *
 * `&#92;` and `&#96;` render identically and survive both passes.
 *
 * Run it after editing pages by hand, and before committing:
 *
 *   node website/scripts/normalize.mjs          rewrite in place
 *   node website/scripts/normalize.mjs --check  exit 1 if anything would change
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', '.vitepress', 'public'])
const check = process.argv.includes('--check')

function pages(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...pages(full))
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}

const UNSAFE_IN_KBD = [
  ['\\', '&#92;'],
  ['`', '&#96;'],
]

/** Entity-escape the characters that break a <kbd>…</kbd> at compile time. */
function normalize(source) {
  return source.replace(/<kbd>([^<]*)<\/kbd>/g, (whole, inner) => {
    let next = inner
    for (const [char, entity] of UNSAFE_IN_KBD) next = next.replaceAll(char, entity)
    return next === inner ? whole : `<kbd>${next}</kbd>`
  })
}

const changed = []
for (const file of pages(SITE)) {
  const before = readFileSync(file, 'utf8')
  const after = normalize(before)
  if (after === before) continue
  changed.push(relative(SITE, file))
  if (!check) writeFileSync(file, after)
}

if (changed.length === 0) {
  console.log('markdown is normalised')
} else if (check) {
  console.error(`needs normalising:\n  ${changed.join('\n  ')}`)
  process.exit(1)
} else {
  console.log(`normalised:\n  ${changed.join('\n  ')}`)
}
