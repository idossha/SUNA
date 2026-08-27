// electron-builder reads this in preference to electron-builder.yml: the
// signing story has to be decided at build time, and YAML cannot ask whether
// a certificate is present.
//
// Everything static lives in electron-builder.yml; this file loads it and
// overrides only what depends on the environment.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const yaml = require('js-yaml')

const config = yaml.load(readFileSync(join(__dirname, 'electron-builder.yml'), 'utf8'))

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
