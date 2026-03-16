import fs from 'node:fs'
import path from 'node:path'

export function resolvePreloadPath(dir: string): string {
  const mjs = path.join(dir, 'preload.mjs')
  if (fs.existsSync(mjs)) return mjs
  return path.join(dir, 'preload.js')
}
