/**
 * afterPack hook: ensures the output .app is named TomeKeep.app
 * regardless of electron-builder's intermittent rename failure.
 */
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appOutDir = context.appOutDir
  const entries = fs.readdirSync(appOutDir)
  const existing = entries.find(e => e.endsWith('.app'))
  if (!existing) {
    console.error('[afterPack] No .app found in', appOutDir)
    return
  }
  if (existing === 'TomeKeep.app') {
    console.log('[afterPack] Already named TomeKeep.app — no rename needed')
    return
  }
  const from = path.join(appOutDir, existing)
  const to = path.join(appOutDir, 'TomeKeep.app')
  fs.renameSync(from, to)
  console.log(`[afterPack] Renamed ${existing} → TomeKeep.app`)
}
