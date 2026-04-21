/**
 * afterPack hook:
 * 1. Ensures the output .app is named TomeKeep.app
 *    regardless of electron-builder's intermittent rename failure.
 * 2. Applies a deep ad-hoc codesign so macOS Gatekeeper shows
 *    "unidentified developer" instead of "damaged" when identity: null.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appOutDir = context.appOutDir
  const entries = fs.readdirSync(appOutDir)
  const existing = entries.find(e => e.endsWith('.app'))
  if (!existing) {
    console.error('[afterPack] No .app found in', appOutDir)
    return
  }

  // Step 1: rename if needed
  if (existing !== 'TomeKeep.app') {
    const from = path.join(appOutDir, existing)
    const to = path.join(appOutDir, 'TomeKeep.app')
    fs.renameSync(from, to)
    console.log(`[afterPack] Renamed ${existing} → TomeKeep.app`)
  } else {
    console.log('[afterPack] Already named TomeKeep.app — no rename needed')
  }

  // Step 2: deep ad-hoc codesign (required when identity: null to avoid "damaged" on macOS)
  const appPath = path.join(appOutDir, 'TomeKeep.app')
  console.log('[afterPack] Applying deep ad-hoc codesign...')
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
  console.log('[afterPack] Codesign done.')
}
