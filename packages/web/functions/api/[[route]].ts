// functions/api/[[route]].ts
// Cloudflare Pages Functions entry point — mounts the Hono app.
// This file is picked up automatically by Cloudflare Pages' file-system routing.
// The [[route]] catch-all matches /api/* requests.

import type { EventContext } from '@cloudflare/workers-types'
import app from '../../api/index.ts'
import type { Env } from '../../api/lib/types.ts'

export async function onRequest(context: EventContext<Env, string, Record<string, unknown>>): Promise<Response> {
  return app.fetch(context.request as unknown as Request, context.env)
}
