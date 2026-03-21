# API Surface

> This file is generated or maintained from code and should reflect current public API behavior.

## Endpoints / Interfaces
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

