// api/lib/password.ts
// PBKDF2-SHA256 password hashing using Web Crypto API (Workers-compatible)

const ITERATIONS = 100_000
const KEY_LEN = 32
const HASH = 'SHA-256'

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await derive(password, salt)
  return `${toBase64(salt.buffer as ArrayBuffer)}:${toBase64(key)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':')
  if (!saltB64 || !hashB64) return false
  const salt = fromBase64(saltB64)
  const key = await derive(password, salt)
  const expected = fromBase64(hashB64)
  // Constant-time comparison
  if (key.byteLength !== expected.byteLength) return false
  const a = new Uint8Array(key)
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ expected[i]
  return diff === 0
}

async function derive(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: HASH, salt: salt as unknown as ArrayBuffer, iterations: ITERATIONS },
    baseKey,
    KEY_LEN * 8,
  )
}
