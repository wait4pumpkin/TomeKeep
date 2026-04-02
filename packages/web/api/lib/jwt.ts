// api/lib/jwt.ts
// HMAC-SHA256 JWT — minimal implementation using Web Crypto API

export interface JwtPayload {
  sub: string       // user id
  username: string
  iat: number
  exp: number
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - s.length % 4)
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), c => c.charCodeAt(0))
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresIn = 86400): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const full: JwtPayload = { ...payload, iat: now, exp: now + expiresIn }
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) as unknown as ArrayBuffer)
  const body = b64url(new TextEncoder().encode(JSON.stringify(full)) as unknown as ArrayBuffer)
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`) as unknown as ArrayBuffer)
  return `${header}.${body}.${b64url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sigB64] = parts
  const key = await importKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    fromB64url(sigB64) as unknown as ArrayBuffer,
    new TextEncoder().encode(`${header}.${body}`) as unknown as ArrayBuffer,
  )
  if (!valid) return null
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as JwtPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}
