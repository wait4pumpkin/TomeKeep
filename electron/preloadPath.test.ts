import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePreloadPath } from './preloadPath'

describe('resolvePreloadPath', () => {
  it('returns preload.cjs in the given directory', () => {
    expect(resolvePreloadPath('/some/dir')).toBe(path.join('/some/dir', 'preload.cjs'))
  })
})
