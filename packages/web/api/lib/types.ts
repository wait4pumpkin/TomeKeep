// api/lib/types.ts
// Cloudflare Workers environment bindings and shared Hono context types
// D1Database and R2Bucket come from the global ambient types injected by
// tsconfig "types": ["@cloudflare/workers-types"] — no explicit import needed.

import type { JwtPayload } from './jwt.ts'

export interface Env {
  DB: D1Database
  COVERS: R2Bucket
  JWT_SECRET: string
  ADMIN_SETUP_TOKEN?: string
  /** Public CDN base URL for the covers R2 bucket, e.g. https://covers.cbbnews.top */
  COVERS_PUBLIC_URL: string
  /** Set automatically by Cloudflare Pages on production deployments */
  CF_PAGES?: string
}

export type HonoEnv = {
  Bindings: Env
  Variables: {
    user: JwtPayload
  }
}
