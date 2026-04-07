// api/index.ts
// Hono application — registers all route modules

import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { HonoEnv } from './lib/types.ts'

import authRoutes from './routes/auth.ts'
import bookRoutes from './routes/books.ts'
import wishlistRoutes from './routes/wishlist.ts'
import readingStateRoutes from './routes/readingStates.ts'
import profileRoutes from './routes/profiles.ts'
import coverRoutes from './routes/covers.ts'
import metadataRoutes from './routes/metadata.ts'
import priceRoutes from './routes/prices.ts'
import syncRoutes from './routes/sync.ts'

const app = new Hono<HonoEnv>().basePath('/api')

// Apply security headers to all responses:
// X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
// Referrer-Policy, Strict-Transport-Security, etc.
app.use('*', secureHeaders())

app.route('/auth', authRoutes)
app.route('/books', bookRoutes)
app.route('/wishlist', wishlistRoutes)
app.route('/reading-states', readingStateRoutes)
app.route('/profiles', profileRoutes)
app.route('/covers', coverRoutes)
app.route('/metadata', metadataRoutes)
app.route('/prices', priceRoutes)
app.route('/sync', syncRoutes)

// Health check
app.get('/health', (c) => c.json({ ok: true }))

export default app
