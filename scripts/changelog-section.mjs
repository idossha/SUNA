#!/usr/bin/env node
// Print CHANGELOG.md's section for one version, for release.yml to use as the
// body of the GitHub Release.
//
//   node scripts/changelog-section.mjs 1.1.0
//
// Node rather than awk or sed because the heading contains `[` and `]` and the
// body contains backticks and `$` — every one of which a shell would eat.
//
// A missing section is NOT fatal. A release whose notes are a placeholder is
// worth more than a release workflow that dies at step two, and GitHub's
// generated commit summary is appended underneath either way.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const version = process.argv[2]
if (!version) {
  console.error('usage: node scripts/changelog-section.mjs <version>')
  process.exit(2)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')

// `## [1.1.0]` up to the next `## ` heading. The date suffix is optional so
// this also works on a section release.sh has not dated yet.
const escaped = version.replace(/\./g, '\\.')
const match = text.match(new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))

const body = match?.[1]?.trim()
if (body) {
  console.log(body)
} else {
  console.error(`no CHANGELOG.md section for ${version} — emitting a placeholder`)
  console.log(`SUNA ${version}.`)
  console.log()
  console.log('See the commits below for what changed.')
}

// Every release says this, and it is the thing a first-time downloader most
// needs: which file to take.
console.log(`
---

### Downloads

| Platform | Take |
| --- | --- |
| macOS, Apple silicon | \`SUNA-${version}-mac-arm64.dmg\` |
| macOS, Intel | \`SUNA-${version}-mac-x64.dmg\` |
| Windows | \`SUNA-${version}-win-x64.exe\` |
| Debian / Ubuntu | \`SUNA-${version}-linux-amd64.deb\` |
| Other Linux | \`SUNA-${version}-linux-x86_64.AppImage\` |

The macOS builds are signed with a Developer ID and notarized by Apple: open
the \`.dmg\`, drag SUNA to Applications, and double-click it. Installing and
running is covered in [the guide](https://idossha.github.io/SUNA/guide/install).`)
