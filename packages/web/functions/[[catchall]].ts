// functions/[[catchall]].ts
// In production (Cloudflare Pages), static assets and the built SPA are served
// automatically — this function is never reached for front-end routes.
//
// In local dev (wrangler pages dev --proxy 5173), wrangler does NOT automatically
// fall back to the proxy when a Functions route returns 404.  This catch-all
// explicitly proxies every non-/api/* request to the Vite dev server so that
// SPA routes like /login, /register, /admin etc. work correctly.
//
// The more-specific functions/api/[[route]].ts takes precedence over this file
// for all /api/* requests, so there is no conflict.

export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url)

  // In production the static assets are handled before Functions.
  // As a safety net, skip if somehow an /api/* request reaches here.
  if (url.pathname.startsWith('/api/')) {
    return new Response('Not found', { status: 404 })
  }

  // Forward to Vite dev server (port 5173).
  const target = new URL(context.request.url)
  target.port = '5173'

  return fetch(target.toString(), {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD'
      ? context.request.body
      : undefined,
  })
}
