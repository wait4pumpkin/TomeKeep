import { describe, expect, it } from 'vitest'
import { detectedImageMime } from './image.ts'

describe('detectedImageMime', () => {
  it.each([
    [[0xff, 0xd8, 0xff, 0x00], 'image/jpeg'],
    [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
    [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
    [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'image/webp'],
  ])('recognizes supported raster signatures', (bytes, expected) => {
    expect(detectedImageMime(Uint8Array.from(bytes as number[]).buffer)).toBe(expected)
  })

  it('rejects content whose declared type could be forged', () => {
    expect(detectedImageMime(new TextEncoder().encode('<svg onload=alert(1)>').buffer)).toBeNull()
  })
})
