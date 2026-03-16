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
  - errors:
    - invalid_isbn
    - not_found
    - timeout
    - network
    - bad_response
