import { describe, expect, it } from 'vitest'
import { signJwt, verifyJwt } from './jwt.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac-validation'

describe('verifyJwt', () => {
  it('accepts a valid token', async () => {
    const token = await signJwt({ sub: 'user-1', username: 'reader' }, SECRET, 60)

    await expect(verifyJwt(token, SECRET)).resolves.toMatchObject({
      sub: 'user-1',
      username: 'reader',
    })
  })

  it('rejects expired tokens', async () => {
    const token = await signJwt({ sub: 'user-1', username: 'reader' }, SECRET, -1)

    await expect(verifyJwt(token, SECRET)).resolves.toBeNull()
  })

  it.each([
    '',
    'not-a-token',
    'a.b.c',
    'e30.e30.invalid',
    `${'a'.repeat(8_193)}.b.c`,
  ])('rejects malformed input without throwing: %s', async (token) => {
    await expect(verifyJwt(token, SECRET)).resolves.toBeNull()
  })

  it('rejects a token after its signed header is changed', async () => {
    const token = await signJwt({ sub: 'user-1', username: 'reader' }, SECRET, 60)
    const [, body, signature] = token.split('.')
    const wrongHeader = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    await expect(verifyJwt(`${wrongHeader}.${body}.${signature}`, SECRET)).resolves.toBeNull()
  })
})
