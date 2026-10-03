---
title: "Reliability Baseline"
owner: "platform-team"
status: active
last_reviewed: 2026-03-14
review_cycle_days: 30
---

# Reliability Baseline

## Service Expectations
- availability target:
- latency target:
- error budget:
- recovery expectations:

## Failure Modes
- upstream timeout
- dependency outage
- invalid input spikes
- background job backlog

## Reliability Controls
- retries
- timeouts
- circuit breaking
- idempotency
- dead-letter queues
- alerting

## Desktop ↔ Cloud Sync Repair (2026-08)

### Failure Mode
Local writes (books / wishlist / reading states) are pushed to the cloud asynchronously after each add/update. A failed push (token expired or cleared on 401, network outage, API error) leaves the record with `syncStatus: 'pending'` locally. Previously nothing replayed the pending queue, so records could stay stuck locally (invisible on the PWA) indefinitely.

### Control: Startup Repair
- On app launch, after a successful login, and on a manual pull (`立即同步`), the desktop runs `runSyncRepair()` (`electron/sync.ts`):
  1. **Cover backfill** — any book/wishlist with a local cover file but no R2 `coverKey` is uploaded and marked pending (fixes records synced with `cover_key = NULL`).
  2. **Pending replay** — all records with `syncStatus: 'pending'` are pushed (PUT, fallback POST); failures stay pending.
- Idempotent; safe to run on every launch. Skipped entirely when not logged in (no token).

### Known Cover-Upload Race (fixed after v1.0.6)

Adding a new book / wishlist item on the desktop used to race: the form's cover preview calls `covers:save-cover` before the record is inserted, and that handler starts a fire-and-forget R2 upload immediately. The upload usually completed before the user submitted the form, the callback found no record in lowdb, and the returned `coverKey` was silently discarded. The record was then pushed with `cover_key = NULL` and showed no cover on the PWA until a later `runSyncRepair` (startup / login / manual pull) backfilled it.

Fix: `pushBook` / `pushWishlistItem` now call `ensureCoverKey()` first — if the record has a local cover file but no `coverKey`, the cover is uploaded and the key persisted **before** the record is pushed. The cover therefore travels with the record regardless of timing; the startup repair remains as a safety net for legacy records.

### Known Path Bug (fixed in v1.0.6)
The token file path was computed at module load, before `app.setPath('userData', .../TomeKeep)` ran, so the token landed in the default userData dir (`~/Library/Application Support/@tomekeep/desktop/.sync-token`) instead of the data dir (`.../TomeKeep/`). Reads and writes were internally consistent, so sync worked, but the file lived outside the app's data directory. Fixed by computing the path inside `getToken`/`setToken`/`clearToken`. Users must log in once after upgrading (the old-path token is no longer read).

### Failure Recovery
- Records that fail during repair keep `syncStatus: 'pending'` and are retried on the next launch/login — no data is lost.
- Server returns the authoritative `updated_at` (LWW); repaired records never overwrite newer cloud state.

## Observability Requirements
- structured logging
- core metrics
- trace propagation where applicable
- dashboards for critical flows

## Reading-State Default-Profile Repair (2026-09)

Migration `0004_reading_state_default_uniqueness.sql` repairs a SQLite NULL
uniqueness gap introduced when `profile_id` was added. Before creating a
partial unique index, it keeps the most recently updated account-level row for
each `(user_id, book_id)` pair and removes older duplicate rows. Subsequent
`profile_id IS NULL` writes use the partial index as their upsert target.

## Profile Tombstones (2026-09)

Migration `0005_profile_tombstones.sql` adds durable profile deletion markers.
Apply it before deploying native clients that request `include_deleted=1`.
Profile deletion uses one D1 batch to write the tombstone and remove that
profile's reading states; the API refuses deletion of the last active profile.

Migration `0006_price_cache_sync.sql` adds cache key, descriptive fields,
expiry/message data and `updated_at` to legacy quote rows. Native macOS writes
each channel with an owner-derived id and client timestamp; D1 only accepts an
equal-or-newer update. Native clients page the owner-scoped rows and merge them
back into local `PriceCacheEntry` values; iOS never runs retailer scraping.
Migration `0007_price_cache_backfill.sql` derives a stable legacy cache key
from ISBN (or row id) and supplies title/expiry defaults so pre-native rows can
be decoded without discarding historical prices.

## Required Runbooks
- deployment rollback
- queue backlog response
- dependency outage response
- incident escalation

## Apple Preview Signing

原生 iOS 预览版的双机安装、Personal Team 到期检查、自动重签和失败恢复见 [`apple-device-signing.md`](./apple-device-signing.md)。重签不承担数据备份职责；跨设备数据安全依赖已发布的生产同步服务，发布门禁见 [`production-sync-deployment.md`](./production-sync-deployment.md)。
