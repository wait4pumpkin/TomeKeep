# External Constraints

## Vendors / Providers
- Provider A:
  - rate limits:
  - auth model:
  - retry guidance:
  - docs source:

- Provider B:
  - rate limits:
  - auth model:
  - retry guidance:
  - docs source:

- JD.com (Price Comparison):
  - rate limits: unknown; apply client-side throttling (serial queue + minimum interval)
  - auth model: may require login and/or anti-bot verification (risk pages)
  - retry guidance: no automatic retries by default; user retries after verification
  - notes:
    - search may redirect to risk handler pages

- BooksChina (Price Comparison):
  - rate limits: unknown; apply client-side throttling (serial queue + minimum interval)
  - auth model: none for basic access; may enforce anti-scraping/verification
  - retry guidance: no automatic retries by default; user can retry manually
  - notes:
    - /book_find2/ enforces a Referer check; direct navigation returns 403.
      Workaround: load homepage first, then JS-redirect to the search URL so the
      browser supplies Referer: https://www.bookschina.com/ automatically.
    - search encoding uses JS escape()-style %uXXXX for non-ASCII characters (not UTF-8 or GBK percent-encoding)
    - product page URL pattern: https://www.bookschina.com/<digits>.htm

- Dangdang (Price Comparison):
  - rate limits: unknown; apply client-side throttling (serial queue + minimum interval)
  - auth model: none for basic access; may enforce anti-scraping/verification
  - retry guidance: no automatic retries by default; user can retry manually
  - notes:
    - search backend expects GBK percent-encoding (%XX); UTF-8 (encodeURIComponent) causes mojibake and empty results
    - book category must be set with all three params: category_path=01.00.00.00.00.00&medium=01&type=01.00.00.00.00.00
    - product page URL pattern: https://product.dangdang.com/<digits>.html

- Open Library (Book Metadata):
  - rate limits: unknown (treat as best-effort; avoid aggressive retries)
  - auth model: none
  - retry guidance: no retries by default; short timeout; user can retry manually
  - docs source: Open Library Books API (ISBN lookup)

- Douban (Book Detail Page HTML):
  - rate limits: unknown (treat as best-effort; avoid aggressive retries)
  - auth model: none
  - retry guidance: no retries by default; short timeout; user can retry manually
  - notes:
    - HTML structure may change; parsing should be best-effort
    - may enforce anti-scraping; add browser-like headers and fail gracefully

## Regulatory / Policy Constraints
- constraint 1
- constraint 2

## Notes
This document should be updated when external contracts or provider behavior changes.
