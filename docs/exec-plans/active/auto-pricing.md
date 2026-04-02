# Execution Plan: Automated Wishlist Price Capture

## Status: Implemented

## Goal

When a book is added to the wishlist, automatically fetch prices from all three configured retailers (JD, Dangdang, BooksChina) in the background, with no required user interaction except when a login wall or CAPTCHA is encountered.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Trigger | On wishlist item add + manual re-trigger | Keeps data fresh without user friction |
| Automation level | Fully automatic; popup only on login wall / CAPTCHA | Minimal interruption |
| CAPTCHA / login handling | Show modal — user resolves, flow continues | Can't skip; user must unblock |
| Manual-flag UI | ✎ amber button on the price row; click removes flag | Distinguishes human-selected from auto-selected prices |
| Remove-manual-flag semantics | Source field only (`manual` → `undefined`); no re-capture triggered | Preserves user-selected product |
| Version matching | Loose — same title+author, any edition | Maximises chance of finding a price |
| Candidate selection | LLM/bigram filter irrelevant titles → `pickLowestOffer()` | Best price, not just first result |
| Single-channel manual capture | Unchanged (existing BrowserWindow flow) | Not broken by this change |
| Already-linked channels | Refresh price on existing `productId` directly (skip search) | Faster + avoids mis-matching |

## Architecture

```
Wishlist.tsx handleAdd()
  └─ window.pricing.autoCaptureAll(input)        [renderer → IPC]
       └─ pricing:auto-capture-all handler        [main process]
            ├─ autoCaptureChannel('jd', ...)
            ├─ autoCaptureChannel('dangdang', ...)
            └─ autoCaptureChannel('bookschina', ...)
                 ├─ if existingQuote.productId → headlessFetch(productUrl) → parseProductPrice
                 └─ else → headlessFetch(searchUrl) → parseSearchOffers → filterMatchingOffers (ollama/bigram) → pickLowestOffer → headlessFetch(productUrl) → parseProductPrice
                 └─ progress pushed via sender.send('pricing:auto-progress', event)
```

Progress events are pushed to the renderer via `pricing:auto-progress` IPC channel and consumed by the `onAutoProgress` subscription in `Wishlist.tsx`, which updates `autoCapturingKeys` state and refreshes `priceCache` on terminal events.

## Files Changed

| File | Change |
|---|---|
| `electron/db.ts` | `PriceQuote.productId?: string`; `source` extended to `'manual' \| 'auto' \| undefined` |
| `electron/ollama.ts` | New — LLM title-matching module (`filterMatchingOffers`; bigram fallback) |
| `electron/pricing.ts` | New: `headlessFetch`, `isLoginOrCaptchaPage`, `parseSearchOffers`, `parseProductPrice`, `autoCaptureChannel`; new IPC handlers `pricing:auto-capture-all`, `pricing:remove-manual-flag`; new type `AutoCaptureProgressEvent` |
| `electron/preload.ts` | `window.pricing` extended: `autoCaptureAll`, `removeManualFlag`, `onAutoProgress` |
| `src/lib/pricing.ts` | `PriceOffer` extended with `title?`, `author?`; new: `parseJdOffersFromSearchHtml`, `parseJdPriceFromProductHtml`, `extractProductId` |
| `src/lib/pricing.test.ts` | Tests for new parsing functions (15 tests total, all passing) |
| `src/lib/i18n.ts` | New keys: `auto_pricing`, `price_delisted`, `manual_source_tip`, `remove_manual_flag` |
| `src/vite-env.d.ts` | `window.pricing` type extended |
| `src/pages/Wishlist.tsx` | Auto-capture trigger on add; `autoCapturingKeys` state; progress subscription; `handleRemoveManualFlag`; `ChannelRow` updated with `isAutoCapturing` + ✎ badge |

## LLM Matching

- Model: `qwen2.5:3b` via local `ollama` CLI (`/usr/local/bin/ollama`)
- Timeout: 15 s per request
- Fallback: bigram similarity (threshold 0.3) when ollama is unavailable or times out
- Input: up to 8 search result candidates (`SEARCH_RESULT_LIMIT = 8`)

## Login / CAPTCHA Handling

- Detected by `isLoginOrCaptchaPage(channel, url, html)` — inspects URL path and HTML keywords per channel
- On detection: a visible `BrowserWindow` is opened at the blocked URL on the `persist:bookstores` session; the user resolves the challenge manually
- Timeout: 5 minutes (`LOGIN_RESOLVE_TIMEOUT_MS`); if the user does not resolve in time, the channel is skipped

## Constraints Followed

- No new undocumented environment variables introduced
- Architecture boundaries respected: main-process logic stays in `electron/`, renderer logic in `src/`
- `window.pricing` API documented in `docs/generated/api-surface.md`
- Dependency policy: no new npm packages added (uses existing `electron`, built-in `child_process` for ollama CLI, existing `lowdb`)
