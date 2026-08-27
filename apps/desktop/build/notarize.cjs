// afterSign hook: submit the signed .app to Apple's notary service.
//
// Same approach as TI-Toolbox (idossha/TI-Toolbox, package/build/notarize.js):
// electron-builder signs, this hook notarizes, and the DMG built afterwards
// carries the stapled ticket. Without credentials it is a no-op, so an
// unsigned local build still works.
const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('  • skipping notarization — no APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID')
    return
  }

  const appPath = `${appOutDir}/${context.packager.appInfo.productFilename}.app`
  console.log(`  • notarizing   ${appPath} (this takes several minutes)`)
  await notarize({ appPath, appleId, appleIdPassword, teamId })
  console.log('  • notarization complete')
}
