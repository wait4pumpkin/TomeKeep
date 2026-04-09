# Web API Routes Map / Web API 路由表

> Generated from `packages/web/api/routes/`. All routes are prefixed with `/api`.
> Routes outside `/api/auth/*` require a valid JWT via `Authorization: Bearer <token>` header or httpOnly `tk` cookie.

---

## Auth Routes / 认证路由

Base path: `/api/auth`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `POST` | `/api/auth/admin-setup` | Token header | One-time admin account bootstrap. Requires `Authorization: Bearer <ADMIN_SETUP_TOKEN>`. Permanently disabled once any admin exists. |
| `POST` | `/api/auth/register` | None (invite code) | Register a new user. Requires a valid single-use invite code. Sets httpOnly JWT cookie. Rate limited: 5 req / 15 min per IP. |
| `POST` | `/api/auth/login` | None | Log in. Returns JWT in response body and sets httpOnly `tk` cookie. Rate limited: 10 req / 15 min per IP. |
| `POST` | `/api/auth/logout` | None | Clears the `tk` httpOnly cookie. |
| `GET` | `/api/auth/me` | JWT | Returns the current authenticated user (`AuthUser`). |
| `POST` | `/api/auth/invite` | JWT + Admin | Generate a new single-use invite code. Returns `{ code: string }`. |
| `GET` | `/api/auth/invites?page=1` | JWT + Admin | Paginated list of all invite codes (10/page). Returns `{ items, total, page, pageSize }`. |
| `DELETE` | `/api/auth/invites/:code` | JWT + Admin | Delete an unused invite code. Returns 409 if already used. |

---

## Books Routes / 书库路由

Base path: `/api/books`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/books` | JWT | List all books for the authenticated user, ordered by `added_at DESC`. |
| `GET` | `/api/books?since=<ISO>` | JWT | Incremental sync: return books with `updated_at > since`, ordered by `updated_at ASC`. Used by desktop sync. |
| `POST` | `/api/books` | JWT | Create a book. Accepts caller-supplied `id` (pass desktop record id for identity-stable migration). Required: `title`. Optional: `author`, `isbn`, `publisher`, `cover_key`, `detail_url`, `tags[]`, `added_at`. Returns 201. |
| `PUT` | `/api/books/:id` | JWT | Update an existing book. Partial update — only provided fields are changed. Returns 404 if not found, 403 if not owner. |
| `DELETE` | `/api/books/:id` | JWT | Soft-delete a book (sets `deleted_at`, bumps `updated_at`). Soft deletes propagate via incremental sync. Returns 404/403 as above. |

---

## Wishlist Routes / 愿望清单路由

Base path: `/api/wishlist`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/wishlist` | JWT | List all wishlist items for the authenticated user, ordered by `added_at DESC`. |
| `GET` | `/api/wishlist?since=<ISO>` | JWT | Incremental sync: items with `updated_at > since`. |
| `POST` | `/api/wishlist` | JWT | Create a wishlist item. Accepts caller-supplied `id`. Required: `title`. Optional: `author`, `isbn`, `publisher`, `cover_key`, `detail_url`, `tags[]`, `priority` (default: `medium`), `pending_buy` (0/1), `added_at`. Returns 201. |
| `PUT` | `/api/wishlist/:id` | JWT | Update an existing wishlist item. Partial update. Returns 404/403 as above. |
| `DELETE` | `/api/wishlist/:id` | JWT | Soft-delete a wishlist item. |
| `POST` | `/api/wishlist/:id/move-to-inventory` | JWT | **Atomic operation**: soft-deletes the wishlist item and inserts a new book record in a single D1 batch transaction. Returns 201 `{ bookId, title }`. |

---

## Reading States Routes / 阅读状态路由

Base path: `/api/reading-states`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/reading-states` | JWT | List all reading states for the authenticated user. |
| `GET` | `/api/reading-states?since=<ISO>` | JWT | Incremental sync: states with `updated_at > since`. |
| `GET` | `/api/reading-states?profile_id=<uuid>` | JWT | Filter by profile. Use `profile_id=null` for legacy account-level states. |
| `PUT` | `/api/reading-states` | JWT | Upsert a reading state. Body: `{ book_id, status, completed_at?, profile_id? }`. Status must be `unread`, `reading`, or `read`. `completed_at` is auto-set when `status === 'read'`. Uses `ON CONFLICT ... DO UPDATE`. |

---

## Profiles Routes / 档案路由

Base path: `/api/profiles`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/profiles` | JWT | List all profiles for the authenticated user (max 5). |
| `POST` | `/api/profiles` | JWT | Create a profile. Body: `{ name }`. Maximum 5 profiles per account. |
| `PUT` | `/api/profiles/:id` | JWT | Rename a profile. Body: `{ name }`. |
| `DELETE` | `/api/profiles/:id` | JWT | Delete a profile and all its associated reading states (cascade). |

---

## Covers Routes / 封面路由

Base path: `/api/covers`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `POST` | `/api/covers/upload` | JWT | Upload a cover image. Accepts `multipart/form-data` with `file` field. Image is compressed to WebP before storing in R2. Returns `{ coverKey }` where `coverKey` is the R2 object path (`covers/<owner_id>/<uuid>.webp`). Max size enforced. |
| `GET` | `/api/covers/:key` | JWT | Serve a cover image. Validates ownership (key must belong to the authenticated user's books or wishlist). Returns a 302 redirect to a signed R2 URL (production) or streams directly (local dev). |

---

## Metadata Routes / 元数据路由

Base path: `/api/metadata`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/metadata/douban?isbn=<isbn>` | JWT | Proxy Douban book metadata lookup by ISBN. Returns normalized `BookMetadata`. |
| `GET` | `/api/metadata/openlibrary?isbn=<isbn>` | JWT | Proxy OpenLibrary metadata lookup by ISBN. Returns normalized `BookMetadata`. |

---

## Prices Routes / 价格路由

Base path: `/api/prices`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/prices?isbn=<isbn>` | JWT | Read-only price cache lookup by ISBN. Written by the desktop client; consumed by the PWA. Returns cached `PriceCacheEntry[]` or empty array if not cached. |

---

## Sync Routes / 同步路由

Base path: `/api/sync`

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/sync/status` | JWT | Returns the latest `updated_at` timestamp per table for the authenticated user. Used by the desktop client to decide whether to pull incremental changes. Response: `{ books: ISO, wishlist: ISO, readingStates: ISO }`. |

---

## Health

| Method | Path | Auth Required | Description |
|--------|------|:---:|---|
| `GET` | `/api/health` | None | Returns `{ ok: true }`. Used by CI and monitoring. |

---

## Companion Server Routes (LAN) / 伴侣服务器路由（局域网）

These routes are served by the in-app HTTPS companion server (`electron/companion-server.ts`), **not** Cloudflare Pages. The server listens on a random LAN port.

| Method | Path | Auth | Description |
|--------|------|:---:|---|
| `GET` | `/` | None | Serves the mobile scanning page (`mobile-scan.html`). |
| `GET` | `/events?token=T` | Token in query | SSE stream. Sends `{ type: 'ack', isbn, hasMetadata, title? }` and `{ type: 'delete-ack', isbn }` events to the phone. |
| `POST` | `/scan?token=T` | Token in query | Receives `{ isbn }` from the phone scanner. Fires `companion:isbn-received` IPC to the Electron renderer. |
| `POST` | `/delete-entry?token=T` | Token in query | Receives `{ isbn }` from the phone. Fires `companion:delete-entry` IPC and broadcasts `delete-ack` SSE. |
| `GET` | `/vendor/*` | None | Serves local static assets (e.g. `zxing-library.min.js`). |
| `GET` | `/ping` | None | Health check. Returns `{ alive: true }`. |

The `token` is a 16-byte random hex string generated per session and invalidated when `stop()` is called. It is distributed to the phone via QR code.

---

## Response Conventions / 响应约定

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Created |
| `204` | No content |
| `400` | Bad request (missing/invalid fields) |
| `401` | Unauthorized (missing or invalid JWT) |
| `403` | Forbidden (wrong user or invalid token) |
| `404` | Not found |
| `409` | Conflict (duplicate, already used, etc.) |
| `413` | Payload too large (cover upload) |
| `422` | Unprocessable entity (image processing failed) |
| `429` | Too many requests (rate limited) |

All error responses follow the format: `{ "error": "<error_code>" }`.
