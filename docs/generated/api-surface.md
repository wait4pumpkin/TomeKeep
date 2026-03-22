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
  coverUrl?: string
  status: 'unread' | 'reading' | 'read'
  addedAt: string      // ISO 8601
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
  coverUrl?: string
  priority: 'high' | 'medium' | 'low'
  addedAt: string      // ISO 8601
}
```

### Renderer Global APIs (preload)
- window.db
  - purpose: local persistence for inventory and wishlist
  - methods:
    - getBooks() -> Book[]
    - addBook(book) -> Book
    - updateBook(book) -> Book | null
    - deleteBook(id) -> boolean
    - getWishlist() -> WishlistItem[]
    - addWishlistItem(item) -> WishlistItem
    - deleteWishlistItem(id) -> boolean

- window.meta
  - purpose: fetch book metadata by ISBN (best-effort)
  - methods:
    - lookupIsbn(isbn13) -> { ok: true, value: BookMetadata } | { ok: false, error }
    - lookupDouban(input) -> { ok: true, value: BookMetadata } | { ok: false, error }
  - errors:
    - lookupIsbn:
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

### IPC Channels (main process)
| Channel | Direction | Handler |
|---|---|---|
| db:get-books | renderer→main | returns Book[] |
| db:add-book | renderer→main | persists Book, returns Book |
| db:update-book | renderer→main | updates Book by id, returns Book\|null |
| db:delete-book | renderer→main | removes Book by id, returns boolean |
| db:get-wishlist | renderer→main | returns WishlistItem[] |
| db:add-wishlist-item | renderer→main | persists WishlistItem, returns WishlistItem |
| db:delete-wishlist-item | renderer→main | removes WishlistItem by id, returns boolean |
| meta:lookup-isbn | renderer→main | fetches metadata from Open Library |
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

