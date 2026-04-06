# API Surface

> This file is generated or maintained from code and should reflect current public API behavior.

## Endpoints / Interfaces
### Data Schemas

#### Book
```ts
interface Book {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string   // from metadata fill (OpenLibrary / Douban); not inferred from ISBN
  coverUrl?: string    // app:// local path (new records) or remote URL (legacy records)
  status?: 'unread' | 'reading' | 'read'  // legacy field; per-user status now stored in ReadingState
  tags?: string[]      // free-form labels, e.g. ["科幻", "经典"]; undefined = no tags
  doubanUrl?: string   // optional custom Douban URL override; if absent, derived from isbn or title
  addedAt: string      // ISO 8601
}
```

#### BookMetadata
```ts
type BookMetadata = {
  isbn13?: string    // undefined when source has no standard ISBN (e.g. old Chinese book numbers)
  title?: string
  author?: string
  publisher?: string
  coverUrl?: string
}
```

#### UserProfile
```ts
interface UserProfile {
  id: string       // UUID
  name: string
  createdAt: string  // ISO 8601
  language?: 'zh' | 'en'  // UI language preference; defaults to 'zh' when absent
}
```

#### ReadingState
```ts
interface ReadingState {
  userId: string       // UserProfile.id
  bookId: string       // Book.id
  status: 'unread' | 'reading' | 'read'
  completedAt?: string // ISO 8601; set automatically when status transitions to 'read', cleared otherwise
}
```

#### WishlistItem
```ts
interface WishlistItem {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string   // from metadata fill (Douban); not inferred from ISBN
  coverUrl?: string    // app:// local path (new records) or remote URL (legacy records)
  tags?: string[]      // free-form labels; undefined = no tags
  priority: 'high' | 'medium' | 'low'
  addedAt: string      // ISO 8601
}
```

#### PriceQuote
```ts
interface PriceQuote {
  channel: PriceChannel          // 'jd' | 'dangdang' | 'bookschina'
  status: 'ok' | 'not_found' | 'error'
  priceCny?: number              // present when status === 'ok'
  url: string                    // product detail page URL
  productId?: string             // channel-specific product ID; set after first successful capture
  source?: 'manual' | 'auto'    // 'manual' = captured via capture window; 'auto' = automated capture; undefined = legacy
  fetchedAt?: string             // ISO 8601
  message?: string               // human-readable error detail when status === 'error'
}
```

### Renderer Global APIs (preload)
- window.db
  - purpose: local persistence for inventory, wishlist, users, and per-user reading state
  - methods:
    - getBooks() -> Book[]
    - addBook(book) -> Book
    - updateBook(book) -> Book | null
    - deleteBook(id) -> boolean
    - getWishlist() -> WishlistItem[]
    - addWishlistItem(item) -> WishlistItem
    - updateWishlistItem(item) -> WishlistItem | null
    - deleteWishlistItem(id) -> boolean
    - getAllTags() -> string[]  (returns all distinct tags across books + wishlist, sorted)
    - getUsers() -> UserProfile[]
    - addUser(name: string) -> UserProfile
    - deleteUser(id: string) -> boolean  (also deletes all ReadingState rows for this user)
    - getActiveUser() -> UserProfile | null
    - setActiveUser(id: string) -> UserProfile | null
    - renameUser(id: string, name: string) -> UserProfile | null
    - setUserLanguage(id: string, language: 'zh' | 'en') -> UserProfile | null  (persists language preference to DB)
    - getReadingStates(userId: string) -> ReadingState[]
    - setReadingState(state: ReadingState) -> ReadingState  (upsert; pass completedAt to record finish date)

- window.meta
  - purpose: fetch book metadata by ISBN (best-effort)
  - session partition for Douban fetches: `persist:douban` (Chromium session with persistent cookies, shared with the Douban login window)
  - methods:
    - lookupIsbn(isbn13) -> { ok: true, value: BookMetadata } | { ok: false, error }
    - lookupIsbnSearch(isbn13) -> { ok: true, value: BookMetadata } | { ok: false, error }
    - lookupDouban(input) -> { ok: true, value: BookMetadata } | { ok: false, error }
    - searchDouban(query: string) -> SearchDoubanResult  (search Douban by title/author string; uses `persist:douban` session)
    - lookupWaterfall(isbn13: string) -> WaterfallResult  (Douban → OpenLibrary → isbnsearch, returns first successful hit)
    - resolveCaptcha(isbn13: string) -> { ok: true, value: BookMetadata } | { ok: false, error }
      (opens a small BrowserWindow at isbnsearch.org/isbn/<isbn13> on the `persist:isbnsearch` session; parses the page on both `did-finish-load` and `did-stop-loading` events with a mutex to prevent concurrent scrapes; resolves with `{ ok: true, value: BookMetadata }` on success, `{ ok: false, error: 'not_found' }` if the user closes the window without solving)
    - loginDouban() -> { ok: true } | { ok: false; error: string }  (opens Douban login BrowserWindow on `persist:douban` partition; resolves when user leaves accounts.douban.com)
    - doubanStatus() -> { loggedIn: boolean }  (checks for `dbcl2` auth cookie in `persist:douban` session)
  - errors:
    - lookupIsbn / lookupIsbnSearch:
      - invalid_isbn
      - not_found
      - timeout
      - network
      - bad_response
    - lookupDouban:
      - invalid_url
      - not_found
      - timeout
      - network
      - bad_response

- window.pricing
  - purpose: read price cache, open in-app capture windows for manual price collection, and trigger automated background price capture
  - methods:
    - get(keys: string[]) -> Record<string, PriceCacheEntry>
      - reads cached price entries for the given normalized keys (no network requests)
    - openCapture(input: PricingInput & { channel: CaptureChannel }) -> OpenCaptureResult
      - opens a BrowserWindow for the given channel loaded at the channel's search page
      - the user browses normally (login, captcha, search) then confirms a product
      - on confirm: writes PriceQuote (status: ok, source: manual) into priceCache and returns { ok: true, quote }
      - on cancel / window close: returns { ok: false, reason: 'cancelled' }
      - on error: returns { ok: false, reason: 'error' }
      - currently supported channels: jd, dangdang, bookschina
    - autoCaptureAll(input: PricingInput) -> void
      - triggers background price capture for all three channels concurrently
      - progress events are pushed to the renderer via the `pricing:auto-progress` IPC channel
      - if a channel returns a login wall or CAPTCHA, a visible BrowserWindow opens for user resolution (5-minute timeout)
      - channels with an existing `productId` refresh price directly from the product page
    - removeManualFlag(key: string, channel: CaptureChannel) -> void
      - sets `PriceQuote.source` to `undefined` for the given key+channel (removes ✎ badge); does NOT trigger re-capture
    - onAutoProgress(cb: (event: AutoCaptureProgressEvent) => void) -> () => void
      - registers a callback for auto-capture progress events pushed from the main process
      - returns a dispose function; call it to remove the listener
  - types:
    - CaptureChannel: 'jd' | 'dangdang' | 'bookschina'
    - PricingInput: { key: string; title: string; author?: string; isbn?: string }
    - AutoCaptureProgressEvent: { key: string; channel: CaptureChannel; status: 'started' | 'done' | 'error' | 'skipped'; quote?: PriceQuote }
    - PriceQuote.source: 'manual' | 'auto' | undefined  (manual = captured via capture window; auto = automated capture)
    - PriceQuote.productId?: string  (channel-specific product ID; set after first successful capture)
    - PriceQuote.url: product detail page URL (e.g. https://item.jd.com/<sku>.html, https://product.dangdang.com/<id>.html, https://www.bookschina.com/<id>.htm)

- window.stores
  - purpose: retailer session / cookie management
  - methods:
    - openLogin(channel) -> boolean  (opens login BrowserWindow, shared persist:bookstores session)
    - openPage(url) -> { ok: true } | { ok: false, error }  (opens whitelisted URL in-app)
    - getStatus(channel) -> { ok: true, loggedIn: boolean }
    - clearCookies(channel) -> { ok: true }
  - allowed domains for openPage: *.jd.com, *.bookschina.com, *.dangdang.com

- window.app
  - purpose: system-level utilities
  - methods:
    - openExternal(url) -> { ok: true } | { ok: false, error: 'invalid_url' }

- window.covers
  - purpose: download and persist cover images to local storage
  - methods:
    - saveCover(id, url) -> Promise<string | undefined>
      - downloads the image at `url` to `userData/covers/<id>.jpg`
      - returns `app://covers/<id>.jpg` on success
      - returns `undefined` if `url` is empty, already starts with `app://`, download fails, times out (10 s), the downloaded file is a GIF placeholder, or its MD5 matches a known placeholder image (e.g. the isbndb "not available" JPEG, md5=`6516a47fc69b0f3956f12e7efc984eb1`)
      - never throws; always resolves
    - saveCoverData(id, dataUrl) -> string | null
      - writes a base64 data URL (e.g. from a local file picker) to `userData/covers/<id>.<ext>`
      - returns `app://covers/<id>.<ext>` on success, or `null` on failure
      - never throws; always resolves

- window.companion
  - purpose: manage the LAN HTTPS companion server for mobile barcode scanning
  - methods:
    - start() -> Promise<{ ok: true; url: string; token: string } | { ok: false; error: string }>
      - starts the HTTPS server (or returns existing session if already running)
      - `url` is the full LAN URL including `?token=<token>`; render as QR code for the phone to scan
      - `token` is a 16-byte random hex string; invalidated when stop() is called
    - stop() -> Promise<void>
      - stops the server, closes all SSE connections, and invalidates the token
    - status() -> Promise<{ running: true; url: string } | { running: false }>
      - returns current server state without side effects
    - onIsbnReceived(cb: (isbn: string) => void) -> () => void
      - registers a callback invoked for each ISBN the phone scanner sends
      - returns a dispose function; call it to remove the listener
    - sendScanAck(isbn: string, hasMetadata: boolean, title?: string) -> void
      - notifies the phone (via SSE) whether the ISBN was saved with full metadata
      - optional `title` is displayed on the phone scan list when metadata was resolved
      - phone UI updates the scan list item accordingly
    - onDeleteEntryReceived(cb: (isbn: string) => void) -> () => void
      - registers a callback invoked when the phone sends a `POST /delete-entry` request
      - the callback receives the isbn to remove; the renderer should remove it from the scan list and delete it from the library
      - returns a dispose function; call it to remove the listener

### Client-side isbnSearch library (`src/lib/isbnSearch.ts`)

Pure functions exported for renderer use. No IPC involved.

| Function | Signature | Description |
|---|---|---|
| `isIsbndbPlaceholderUrl` | `(url: string) -> boolean` | Returns true if the URL matches the isbndb ISBN-derived placeholder pattern (`/covers/XX/YY/<isbn>.jpg`). Served with HTTP 200 but contains a generic "no cover" image. |
| `isPlaceholderCoverUrl` | `(url: string) -> boolean` | Returns true if the URL is any known placeholder cover from any source: isbndb ISBN-derived path, Douban `book-default-lpic` GIF, or Douban `book-default-spic` GIF. Should be called before persisting any cover URL. |

### Client-side author library (`src/lib/author.ts`)

Pure functions exported for renderer use. Also inlined in `electron/db.ts` for the startup migration (no cross-boundary import).

| Function | Signature | Description |
|---|---|---|
| `normalizeAuthor` | `(raw: string) -> string` | Normalize an author string: ensures exactly one space after nationality bracket prefixes (`[美]`, `（英）`, `(日)`, etc.), collapses internal whitespace, splits multi-author strings on `,` / `/` / `、` and re-joins with `, ` |

**Normalization rule — nationality prefix spacing**: Bracket patterns `[X]`, `【X】`, `(X)`, `（X）` where X is 1–6 CJK characters are treated as nationality prefixes. If the name immediately follows the closing bracket with no space (or multiple spaces), exactly one space is inserted.

**Applied at**: `commitBook`, `commitBookFromRef`, `handleSaveEdit` in `Inventory.tsx`; `handleAdd` in `Wishlist.tsx`. Also run as a startup migration in `electron/db.ts` `setupDatabase()` to fix existing records.

### Client-side ISBN library (`src/lib/isbn.ts`)

Pure functions exported for renderer use. No IPC involved.

| Function | Signature | Description |
|---|---|---|
| `normalizeIsbn` | `(raw: string) -> NormalizeIsbnResult` | Parse and validate raw ISBN-10 or ISBN-13 string |
| `toIsbn13` | `(value: NormalizedIsbn) -> string \| null` | Convert NormalizedIsbn to ISBN-13 digits |
| `isValidIsbn13` | `(isbn13: string) -> boolean` | Validate ISBN-13 checksum |
| `isValidIsbn10` | `(isbn10: string) -> boolean` | Validate ISBN-10 checksum |
| `convertIsbn10ToIsbn13` | `(isbn10: string) -> string \| null` | Convert ISBN-10 to ISBN-13 |
| `parseIsbnSemantics` | `(raw: string) -> IsbnSemantics \| null` | Resolve language/region from ISBN registration group (built-in table, ~85% coverage) |
| `parseIsbnPublisher` | `(raw: string) -> string \| null` | Resolve publisher name from ISBN registrant prefix (built-in table, covers major CN publishers; returns null if unknown) |

**`IsbnSemantics`**:
```ts
type IsbnSemantics = { region: string; language: string }
```

**Coverage of `parseIsbnSemantics`**: 978-0/1 (English), 978-2 (French), 978-3 (German), 978-4 (Japanese), 978-5 (Russian), 978-7 (China mainland), 978-957/986 (Taiwan), 978-988 (Hong Kong), 978-99937 (Macau), major 978 two- and three-digit groups, 979-8/10/11/12 block.

**Coverage of `parseIsbnPublisher`**: ~100 well-known publishers within China mainland (978-7). Other groups always return null. Full coverage is not achievable without the ISBN Agency's non-public publisher registry.

### Client-side localStorage keys

| Key | Values | Default | Description |
|---|---|---|---|
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | UI theme preference; managed by `src/lib/theme.ts` |
| `inventoryViewMode` | `'detail' \| 'compact'` | `'detail'` | View mode for the Library page; persisted on toggle, restored on next visit |
| `wishlistViewMode` | `'detail' \| 'compact'` | `'detail'` | View mode for the Wishlist page; persisted on toggle, restored on next visit |
| `inventoryCompactCols` | integer 8–20 | `8` | Column count for the Library compact view; controlled by the column slider in the toolbar; persisted on change, restored on next visit |

### Client-side DOM events

Custom events dispatched on `window` by the renderer for cross-component communication (no IPC involved).

| Event name | Payload (`CustomEvent.detail`) | Dispatched by | Consumed by |
|---|---|---|---|
| `active-user-changed` | `UserProfile \| null` | user-switcher in `Layout.tsx` after `setActiveUser` | `LangProvider` in `src/lib/i18n.ts` |

### Renderer entry point (`src/main.tsx`)

An `ErrorBoundary` (class component) wraps the root `<App />`. If a render-time exception propagates to the root, the boundary displays a red error message on screen instead of a blank white screen, aiding debugging.

### Client-side theme library (`src/lib/theme.ts`)

Pure functions for dark/light/auto mode management. No IPC.

| Function | Signature | Description |
|---|---|---|
| `getStoredTheme` | `() -> ThemeMode` | Read stored preference from `localStorage` (key: `theme`); defaults to `'auto'` |
| `setStoredTheme` | `(mode: ThemeMode) -> void` | Persist preference to `localStorage` |
| `applyTheme` | `(mode: ThemeMode) -> void` | Add/remove `dark` class on `<html>` based on mode and system pref |
| `cycleTheme` | `(current: ThemeMode) -> ThemeMode` | Cycle Auto → Light → Dark → Auto |

**`ThemeMode`**: `'auto' | 'light' | 'dark'`

### Client-side i18n library (`src/lib/i18n.ts`)

Bilingual (zh/en) translation system. No IPC. Language preference is stored per-user in the DB via `window.db.setUserLanguage`.

| Export | Type/Signature | Description |
|---|---|---|
| `Lang` | `'zh' \| 'en'` | Supported language codes |
| `DictKey` | string union | Keys of the translation dictionary; includes all UI strings for both zh and en. Key count grows with features — see `src/lib/i18n.ts` for the current set. |
| `LangContext` | `React.Context<LangContextValue>` | Context carrying `{ lang, t, setLang }` |
| `LangProvider` | `({ children }) -> JSX` | Provides `LangContext`; reads language from the active user on mount; listens to `active-user-changed` DOM events for user switches |
| `useLang` | `() -> LangContextValue` | Hook to consume `LangContext`; returns `{ lang, t, setLang }` |

**`LangContextValue`**:
```ts
type LangContextValue = {
  lang: Lang
  t: (key: DictKey, vars?: Record<string, string | number>) => string
  setLang: (lang: Lang) => Promise<void>  // updates state + persists to DB
}
```

**Variable interpolation**: `t('some_key', { name: 'Alice' })` replaces `{name}` in the translated string.

**`LangProvider` lifecycle**: On mount, calls `window.db.getActiveUser()` and sets language from the returned profile. Subscribes to the `active-user-changed` CustomEvent (dispatched by the user-switcher) to update language when the active user changes.

### Client-side weather library (`src/lib/weather.ts`)

No IPC. Uses browser Geolocation API + Open-Meteo free API (no key required).

| Function | Signature | Description |
|---|---|---|
| `fetchWeather` | `() -> Promise<WeatherState>` | Resolves geolocation, fetches `api.open-meteo.com`, returns current condition + is_day |

**`WeatherCondition`**: `'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm' | 'unknown'`

**`WeatherState`**: `{ condition: WeatherCondition; isDay: boolean }`

WMO code mapping: 0=clear, 1-3=partly-cloudy, 4-49=cloudy/fog, 50-59=drizzle, 60-69=rain, 70-79=snow, 80-86=rain/snow showers, 87-99=thunderstorm.

### IPC Channels (main process)
| Channel | Direction | Handler |
|---|---|---|
| db:get-books | renderer→main | returns Book[] |
| db:add-book | renderer→main | persists Book, returns Book; idempotent — if a book with the same id already exists, skips insert and returns the existing record |
| db:update-book | renderer→main | updates Book by id, returns Book\|null |
| db:delete-book | renderer→main | removes Book by id, returns boolean |
| db:get-wishlist | renderer→main | returns WishlistItem[] |
| db:add-wishlist-item | renderer→main | persists WishlistItem, returns WishlistItem |
| db:update-wishlist-item | renderer→main | updates WishlistItem by id, returns WishlistItem\|null |
| db:delete-wishlist-item | renderer→main | removes WishlistItem by id, returns boolean |
| db:get-all-tags | renderer→main | returns string[] of all distinct tags across books+wishlist, sorted |
| db:get-users | renderer→main | returns UserProfile[] |
| db:add-user | renderer→main | creates UserProfile by name, returns UserProfile |
| db:rename-user | renderer→main | renames UserProfile by id, returns UserProfile\|null |
| db:delete-user | renderer→main | removes UserProfile and its ReadingState rows, returns boolean |
| db:get-active-user | renderer→main | returns active UserProfile or null |
| db:set-active-user | renderer→main | persists activeUserId, returns UserProfile or null |
| db:set-user-language | renderer→main | updates UserProfile.language field, returns UserProfile\|null |
| db:get-reading-states | renderer→main | returns ReadingState[] for a userId |
| db:set-reading-state | renderer→main | upserts a ReadingState, returns ReadingState |
| meta:lookup-isbn | renderer→main | fetches metadata from Open Library |
| meta:lookup-isbnsearch | renderer→main | fetches metadata from isbnsearch.org HTML |
| meta:lookup-douban | renderer→main | fetches metadata from Douban HTML (uses `persist:douban` session) |
| meta:search-douban | renderer→main | searches Douban by title/author string (uses `persist:douban` session) |
| meta:lookup-isbn-waterfall | renderer→main | Douban → OpenLibrary → isbnsearch waterfall lookup |
| meta:resolve-captcha | renderer→main | opens captcha window for isbnsearch, retries after user resolves |
| meta:login-douban | renderer→main | opens Douban login BrowserWindow (`persist:douban`); resolves on navigation away from accounts.douban.com |
| meta:douban-status | renderer→main | returns `{ loggedIn: boolean }` based on `dbcl2` cookie in `persist:douban` session |
| pricing:get | renderer→main | reads priceCache for given keys |
| pricing:open-capture | renderer→main | opens capture BrowserWindow, awaits user confirmation |
| pricing:auto-capture-all | renderer→main | triggers concurrent automated price capture for all channels; progress pushed via `pricing:auto-progress` |
| pricing:remove-manual-flag | renderer→main | sets PriceQuote.source to undefined for a given key+channel |
| pricing:auto-progress | main→renderer | pushed per-channel during `pricing:auto-capture-all`; payload: `AutoCaptureProgressEvent` |
| capture:result | capture-preload→main | payload from user confirming a product price |
| capture:cancel | capture-preload→main | user closed or cancelled capture window |
| stores:open-login | renderer→main | opens retailer login window |
| stores:open-page | renderer→main | opens whitelisted URL in-app |
| stores:get-status | renderer→main | checks login cookie presence |
| stores:clear-cookies | renderer→main | clears cookies for a retailer |
| app:open-external | renderer→main | opens URL in system browser |
| covers:save-cover | renderer→main | downloads remote cover image to userData/covers/; returns `app://` URL on success, `undefined` on failure (network error, timeout, GIF placeholder, or known MD5 placeholder) |
| covers:save-cover-data | renderer→main | writes base64 data URL cover to userData/covers/, returns app:// URL or null |
| companion:start | renderer→main | starts HTTPS companion server; returns `{ ok, url, token }` |
| companion:stop | renderer→main | stops companion server and invalidates session token |
| companion:status | renderer→main | returns `{ running, url? }` without side effects |
| companion:isbn-received | main→renderer | pushed for each ISBN received from the phone scanner |
| companion:scan-ack | renderer→main | renderer notifies main to broadcast SSE ack to phone; payload `{ isbn, hasMetadata, title? }` |
| companion:delete-entry | main→renderer | pushed when phone requests deletion of a failed scan entry; payload `isbn: string` |
| companion:cover-received | main→renderer | pushed when phone sends a cover photo; payload `{ dataUrl: string, session: string }` |
| sync:login | renderer→main | POST credentials to `/auth/login`, store token, kick off `pullAll()` |
| sync:logout | renderer→main | clear stored token |
| sync:status | renderer→main | returns `{ loggedIn: boolean, lastSyncAt: string \| null }` |
| sync:pull | renderer→main | triggers incremental `pullAll()` |
| sync:push-pending | renderer→main | replays all locally-pending items |
| sync:migrate | renderer→main | one-shot migration: upload covers then upsert all books/wishlist/reading-states; reports per-phase progress via `sync:migrate-progress` |
| sync:migrate-progress | main→renderer | pushed during `sync:migrate`; payload: `{ phase: 'covers' \| 'books' \| 'wishlist' \| 'readingStates' \| 'done', current: number, total: number }` |

### Web/PWA API endpoints (books)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`  | `/api/books?since=<ISO>` | Logged in | Return all books (or books updated after `since`). |
| `POST` | `/api/books` | Logged in | Create a book. Body fields: `id?` (caller-supplied UUID; falls back to server-generated UUID — pass the local desktop id during migration to keep ids in sync), `title` (required), `author?`, `isbn?`, `publisher?`, `cover_key?`, `detail_url?`, `tags?`, `added_at?` (ISO 8601; falls back to `datetime('now')`). Returns 201 with the created book row. |
| `PUT`  | `/api/books/:id` | Logged in | Update an existing book. Returns 404 `{ error: 'not_found' }` if no book with that id exists. Returns 403 if the book belongs to another user. |
| `DELETE` | `/api/books/:id` | Logged in | Soft-delete a book (sets `deleted_at`). Returns 404/403 as above. |

### Web/PWA API endpoints (wishlist)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`  | `/api/wishlist?since=<ISO>` | Logged in | Return all wishlist items (or items updated after `since`). |
| `POST` | `/api/wishlist` | Logged in | Create a wishlist item. Body fields: `id?` (caller-supplied UUID; falls back to server-generated UUID — pass the local desktop id during migration to keep ids in sync), `title` (required), `author?`, `isbn?`, `publisher?`, `cover_key?`, `detail_url?`, `tags?`, `priority?`, `pending_buy?`, `added_at?` (ISO 8601; falls back to `datetime('now')`). Returns 201 with the created item row. |
| `PUT`  | `/api/wishlist/:id` | Logged in | Update an existing wishlist item. Returns 404/403 as above. |
| `DELETE` | `/api/wishlist/:id` | Logged in | Soft-delete a wishlist item. |
| `POST` | `/api/wishlist/:id/move-to-inventory` | Logged in | Atomically delete a wishlist item and create a new book from it. Returns 201 `{ bookId, title }`. |

All routes are prefixed `/api`. Routes outside `/api/auth/*` require a valid JWT (via httpOnly cookie for PWA, or `Authorization: Bearer <token>` for Electron).

### Data schemas

#### AuthUser
```ts
interface AuthUser {
  id: string          // UUID v4
  username: string
  name: string
  language: 'zh' | 'en'
  is_admin: boolean
}
```

#### InviteCode
```ts
interface InviteCode {
  code: string
  created_by: string        // user id
  used_by: string | null    // user id, null if unused
  used_by_username: string | null  // joined from users table
  used_at: string | null    // ISO 8601
  created_at: string        // ISO 8601
}
```

### Auth endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/admin-setup` | `Authorization: Bearer <ADMIN_SETUP_TOKEN>` | Create the single admin account. Returns 409 if an admin already exists. Body: `{ username, password, name }` |
| `POST` | `/api/auth/register` | Public (invite code required) | Register a new user. Sets httpOnly JWT cookie. Body: `{ username, password, name, inviteCode }` |
| `POST` | `/api/auth/login` | Public | Log in. Sets httpOnly JWT cookie. Body: `{ username, password }` |
| `POST` | `/api/auth/logout` | Logged in | Clear httpOnly JWT cookie |
| `GET`  | `/api/auth/me` | Logged in | Return `AuthUser` for the current session |
| `POST` | `/api/auth/invite` | Admin only | Generate a new invite code. Returns `{ code: string }` |
| `GET`  | `/api/auth/invites?page=1` | Admin only | Paginated list of all invite codes (10/page). Returns `{ items: InviteCode[], page: number, totalPages: number }` |
| `DELETE` | `/api/auth/invites/:code` | Admin only | Delete an unused invite code. Returns 409 if the code has already been used |

**Cookie behavior**: `httpOnly; SameSite=Strict`. `Secure` flag is added only when the `CF_PAGES` environment variable is present (omitted for local `http://` dev).

**JWT payload**:
```json
{ "sub": "<user-id>", "username": "alice", "is_admin": false, "iat": 0, "exp": 86400 }
```

### Web/PWA localStorage keys

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `tk_user` | JSON `AuthUser` or absent | — | Cached regular-user session. `getStoredUser()` returns `null` if value has `is_admin: true` |
| `tk_admin` | JSON `AuthUser` or absent | — | Cached admin session. `getStoredAdmin()` returns `null` if value has `is_admin: false` |
| `tk_lang` | `'zh' \| 'en'` | `'zh'` | UI language preference for PWA (persisted independently of user DB record) |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | Shared with desktop; managed by `@tomekeep/shared/theme` |

### Companion HTTP Routes (companion-server.ts)
| Method + Path | Auth | Description |
|---|---|---|
| `GET /` | — | serves `public/mobile-scan.html` |
| `GET /events?token=T` | token | SSE stream; sends `{ type:'ack', isbn, hasMetadata, title? }` and `{ type:'delete-ack', isbn }` events |
| `POST /scan?token=T` | token | receives `{ isbn }`, fires `companion:isbn-received` IPC |
| `POST /delete-entry?token=T` | token | receives `{ isbn }`, fires `companion:delete-entry` IPC and broadcasts `{ type:'delete-ack', isbn }` SSE |
| `GET /vendor/*` | — | serves local static assets (e.g. `zxing-library.min.js`) |
| `GET /ping` | — | health check, returns `{ alive: true }` |

