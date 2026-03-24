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

#### UserProfile
```ts
interface UserProfile {
  id: string    // UUID
  name: string
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
    - getReadingStates(userId: string) -> ReadingState[]
    - setReadingState(state: ReadingState) -> ReadingState  (upsert; pass completedAt to record finish date)

- window.meta
  - purpose: fetch book metadata by ISBN (best-effort)
  - methods:
    - lookupIsbn(isbn13) -> { ok: true, value: BookMetadata } | { ok: false, error }
    - lookupIsbnSearch(isbn13) -> { ok: true, value: BookMetadata } | { ok: false, error }
    - lookupDouban(input) -> { ok: true, value: BookMetadata } | { ok: false, error }
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
  - purpose: read price cache and open in-app capture windows for manual price collection
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
  - types:
    - CaptureChannel: 'jd' | 'dangdang' | 'bookschina'
    - PricingInput: { key: string; title: string; author?: string; isbn?: string }
    - PriceQuote.source: 'manual' | undefined  (manual = captured via capture window)
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
    - saveCover(id, url) -> string
      - downloads the image at `url` to `userData/covers/<id>.jpg`
      - returns `app://covers/<id>.jpg` on success
      - returns original `url` unchanged if `url` is empty, already starts with `app://`, download fails, or times out (10 s)
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

### Client-side theme library (`src/lib/theme.ts`)

Pure functions for dark/light/auto mode management. No IPC.

| Function | Signature | Description |
|---|---|---|
| `getStoredTheme` | `() -> ThemeMode` | Read stored preference from `localStorage` (key: `theme`); defaults to `'auto'` |
| `setStoredTheme` | `(mode: ThemeMode) -> void` | Persist preference to `localStorage` |
| `applyTheme` | `(mode: ThemeMode) -> void` | Add/remove `dark` class on `<html>` based on mode and system pref |
| `cycleTheme` | `(current: ThemeMode) -> ThemeMode` | Cycle Auto → Light → Dark → Auto |

**`ThemeMode`**: `'auto' | 'light' | 'dark'`

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
| db:add-book | renderer→main | persists Book, returns Book |
| db:update-book | renderer→main | updates Book by id, returns Book\|null |
| db:delete-book | renderer→main | removes Book by id, returns boolean |
| db:get-wishlist | renderer→main | returns WishlistItem[] |
| db:add-wishlist-item | renderer→main | persists WishlistItem, returns WishlistItem |
| db:update-wishlist-item | renderer→main | updates WishlistItem by id, returns WishlistItem\|null |
| db:delete-wishlist-item | renderer→main | removes WishlistItem by id, returns boolean |
| db:get-all-tags | renderer→main | returns string[] of all distinct tags across books+wishlist, sorted |
| db:get-users | renderer→main | returns UserProfile[] |
| db:add-user | renderer→main | creates UserProfile by name, returns UserProfile |
| db:delete-user | renderer→main | removes UserProfile and its ReadingState rows, returns boolean |
| db:get-active-user | renderer→main | returns active UserProfile or null |
| db:set-active-user | renderer→main | persists activeUserId, returns UserProfile or null |
| db:get-reading-states | renderer→main | returns ReadingState[] for a userId |
| db:set-reading-state | renderer→main | upserts a ReadingState, returns ReadingState |
| meta:lookup-isbn | renderer→main | fetches metadata from Open Library |
| meta:lookup-isbnsearch | renderer→main | fetches metadata from isbnsearch.org HTML |
| meta:lookup-douban | renderer→main | fetches metadata from Douban HTML |
| pricing:get | renderer→main | reads priceCache for given keys |
| pricing:open-capture | renderer→main | opens capture BrowserWindow, awaits user confirmation |
| capture:result | capture-preload→main | payload from user confirming a product price |
| capture:cancel | capture-preload→main | user closed or cancelled capture window |
| stores:open-login | renderer→main | opens retailer login window |
| stores:open-page | renderer→main | opens whitelisted URL in-app |
| stores:get-status | renderer→main | checks login cookie presence |
| stores:clear-cookies | renderer→main | clears cookies for a retailer |
| app:open-external | renderer→main | opens URL in system browser |
| covers:save-cover | renderer→main | downloads remote cover image to userData/covers/, returns app:// URL |
| covers:save-cover-data | renderer→main | writes base64 data URL cover to userData/covers/, returns app:// URL or null |
| companion:start | renderer→main | starts HTTPS companion server; returns `{ ok, url, token }` |
| companion:stop | renderer→main | stops companion server and invalidates session token |
| companion:status | renderer→main | returns `{ running, url? }` without side effects |
| companion:isbn-received | main→renderer | pushed for each ISBN received from the phone scanner |
| companion:scan-ack | renderer→main | renderer notifies main to broadcast SSE ack to phone; payload `{ isbn, hasMetadata, title? }` |

