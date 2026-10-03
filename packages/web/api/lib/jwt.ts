// api/lib/jwt.ts
// HMAC-SHA256 JWT — minimal implementation using Web Crypto API

export interface JwtPayload {
  sub: string       // user id
  username: string
  iat: number
  exp: number
}

interface JwtHeader {
  alg: string
  typ: string
}

const MAX_TOKEN_LENGTH = 8_192
const CLOCK_SKEW_SECONDS = 5 * 60

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

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresIn = 60 * 60 * 24 * 90): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const full: JwtPayload = { ...payload, iat: now, exp: now + expiresIn }
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) as unknown as ArrayBuffer)
  const body = b64url(new TextEncoder().encode(JSON.stringify(full)) as unknown as ArrayBuffer)
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`) as unknown as ArrayBuffer)
  return `${header}.${body}.${b64url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerPart, bodyPart, signaturePart] = parts

    const header = JSON.parse(
      new TextDecoder().decode(fromB64url(headerPart)),
    ) as Partial<JwtHeader>
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null

    const key = await importKey(secret)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromB64url(signaturePart) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${headerPart}.${bodyPart}`) as unknown as ArrayBuffer,
    )
    if (!valid) return null

    const payload = JSON.parse(
      new TextDecoder().decode(fromB64url(bodyPart)),
    ) as Partial<JwtPayload>
    if (
      typeof payload.sub !== 'string' || !payload.sub ||
      typeof payload.username !== 'string' || !payload.username ||
      typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) ||
      typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
    ) {
      return null
    }

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp <= now || payload.iat > now + CLOCK_SKEW_SECONDS || payload.exp <= payload.iat) {
      return null
    }

    return payload as JwtPayload
  } catch {
    return null
  }
}
