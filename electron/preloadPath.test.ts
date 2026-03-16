import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePreloadPath } from './preloadPath'

describe('resolvePreloadPath', () => {
  it('prefers preload.mjs when present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tomekeep-preload-'))
    await writeFile(path.join(dir, 'preload.mjs'), '')
    await writeFile(path.join(dir, 'preload.js'), '')
    expect(resolvePreloadPath(dir)).toBe(path.join(dir, 'preload.mjs'))
  })

  it('falls back to preload.js when preload.mjs missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tomekeep-preload-'))
    await writeFile(path.join(dir, 'preload.js'), '')
    expect(resolvePreloadPath(dir)).toBe(path.join(dir, 'preload.js'))
  })
})

