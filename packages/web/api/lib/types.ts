// api/lib/types.ts
// Cloudflare Workers environment bindings and shared Hono context types
// D1Database and R2Bucket come from the global ambient types injected by
// tsconfig "types": ["@cloudflare/workers-types"] — no explicit import needed.

import type { JwtPayload } from './jwt.ts'

export interface Env {
  DB: D1Database
  COVERS: R2Bucket
  JWT_SECRET: string
}

export type HonoEnv = {
  Bindings: Env
  Variables: {
    user: JwtPayload
  }
}
