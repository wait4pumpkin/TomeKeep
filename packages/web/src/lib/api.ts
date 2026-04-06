// src/lib/api.ts
// Fetch wrapper for the Hono backend API.
// Uses httpOnly cookie for auth (browser handles it automatically).
// On 401, clears local auth state and redirects to /login.

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })

  if (res.status === 401) {
    // Clear cached auth and bounce to login
    localStorage.removeItem('tk_user')
    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized')
  }

  if (!res.ok) {
    let msg = res.statusText
    try {
      const data = await res.json() as { error?: string }
      if (data.error) msg = data.error
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, msg)
  }

  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>('GET', path, undefined, signal),

  post: <T>(path: string, body: unknown) =>
    request<T>('POST', path, body),

  put: <T>(path: string, body: unknown) =>
    request<T>('PUT', path, body),

  patch: <T>(path: string, body: unknown) =>
    request<T>('PATCH', path, body),

  delete: <T>(path: string) =>
    request<T>('DELETE', path),

  /** Upload a file (multipart). Returns the parsed JSON body. */
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    if (res.status === 401) {
      localStorage.removeItem('tk_user')
      window.location.href = '/login'
      throw new ApiError(401, 'Unauthorized')
    }
    if (!res.ok) {
      let msg = res.statusText
      try {
        const data = await res.json() as { error?: string }
        if (data.error) msg = data.error
      } catch {
        // ignore
      }
      throw new ApiError(res.status, msg)
    }
    return res.json() as Promise<T>
  },
}
