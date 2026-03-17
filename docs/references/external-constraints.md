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
