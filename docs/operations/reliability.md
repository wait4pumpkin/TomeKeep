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

## Required Runbooks
- deployment rollback
- queue backlog response
- dependency outage response
- incident escalation