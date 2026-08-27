// The build's entry point. electron-builder auto-discovers this file (it
// prefers electron-builder.yml when one exists, which is why the static
// config is named electron-builder.base.yml instead): the signing story has
// to be decided at build time, and YAML cannot ask whether a certificate is
// present.
//
// Everything static lives in electron-builder.base.yml; this file loads it
// and overrides only what depends on the environment.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const yaml = require('js-yaml')

const config = yaml.load(readFileSync(join(__dirname, 'electron-builder.base.yml'), 'utf8'))

// GitHub Actions sets an env var for every `secrets.X` reference, even one
// that does not exist — as an EMPTY STRING. electron-builder reads CSC_LINK
// itself and treats "defined but empty" as "a certificate was provided",
// then fails trying to import one from a path of ''. Unset the empties so
// absent credentials look absent.
for (const key of [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID'
]) {
  if (!process.env[key]) delete process.env[key]
}

// A Developer ID certificate reaches CI as CSC_LINK (base64 .p12) +
// CSC_KEY_PASSWORD, which electron-builder imports and selects on its own —
// so the identity must be left unset for it to search the keychain.
// Without a certificate we ad-hoc sign, which keeps the bundle valid even
// though Gatekeeper will still refuse a browser download.
const hasCert = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
config.mac.identity = hasCert ? process.env.CSC_NAME || null : '-'

// Notarization needs all three credentials; asking for it without them fails
// the build, so it stays off until they are present.
const notarizable =
  hasCert &&
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
config.mac.notarize = notarizable ? { teamId: process.env.APPLE_TEAM_ID } : false

if (process.platform === 'darwin') {
  console.log(
    notarizable
      ? '  • signing with Developer ID and notarizing'
      : `  • ${hasCert ? 'signing with Developer ID, NOT notarizing' : 'ad-hoc signing (no certificate)'} — downloads will be blocked by Gatekeeper`
  )
}

module.exports = config
