---
title: "Book Tags — Add/Remove & Filter"
status: active
created: 2026-03-22
author: engineering
---

# Execution Plan: Book Tags

## Goal

Add free-form tagging support to Library (Inventory) and Wishlist items, with inline card editing and AND-logic tag filtering.

## User Stories

- As a user, I can add one or more tags to any book in my library or wishlist (e.g. "科幻", "经典", "待重读").
- As a user, I can remove a tag from a book by clicking × on the tag chip.
- As a user, I can filter my library/wishlist by selecting one or more tags; only items containing **all** selected tags are shown (AND logic).
- As a user, typing a new tag shows autocomplete suggestions drawn from all existing tags across the library and wishlist.

## Design Decisions

| Question | Decision | Rationale |
|---|---|---|
| Tag management | Free-form input with autocomplete | Lowest friction; no need to pre-define a taxonomy |
| Filter logic | AND (all selected tags must match) | More precise; users can narrow by combining tags |
| Edit entry point | Inline on book card | No extra modal; consistent with existing status-toggle UX |
| Wishlist scope | Yes, same implementation | Symmetric with Library |
| New dependencies | None | Use React state + native browser APIs; no new runtime deps |

## Constraints Followed

- No new runtime dependencies (platform capabilities only).
- All DB mutations via IPC bridge; renderer never accesses lowdb directly.
- API surface changes documented in `docs/generated/api-surface.md`.
- No new environment variables.

## Affected Files

| File | Change |
|---|---|
| `electron/db.ts` | Add `tags?: string[]` to `Book` and `WishlistItem`; add `db:get-all-tags` and `db:update-wishlist-item` IPC handlers |
| `electron/preload.ts` | Expose `getAllTags()` and `updateWishlistItem()` on `window.db` |
| `src/vite-env.d.ts` | Update `Window.db` type declarations |
| `src/pages/Inventory.tsx` | Inline tag editor on book cards; tag filter bar; updated `filteredBooks` memo |
| `src/pages/Wishlist.tsx` | Inline tag editor on wishlist cards; tag filter bar; new `filteredItems` memo |
| `docs/generated/api-surface.md` | Update schemas and IPC channel table |
| `docs/product-specs/book-management.md` | Add FR-INV-07, FR-INV-08, FR-WISH-04, FR-WISH-05 |

## IPC Changes

### New channels

| Channel | Direction | Handler |
|---|---|---|
| `db:get-all-tags` | renderer→main | Returns `string[]` of all distinct tags across books and wishlist, sorted |
| `db:update-wishlist-item` | renderer→main | Updates a WishlistItem by id, returns `WishlistItem \| null` |

### Existing channels (no signature change)

`db:update-book` already handles full `Book` object replacement — `tags` field will be included naturally once added to the interface.

## Data Model Changes

```ts
interface Book {
  // ... existing fields ...
  tags?: string[]   // NEW: free-form labels, e.g. ["科幻", "经典"]
}

interface WishlistItem {
  // ... existing fields ...
  tags?: string[]   // NEW: same semantics as Book.tags
}
```

Existing records without `tags` treat the field as `undefined`, which is semantically equivalent to `[]` in all filter and display logic.

## UI Behaviour

### Tag chips on book/wishlist cards

- Tags displayed as small coloured chips below the author/publisher line, inside the card body.
- Each chip has an `×` button; clicking it removes that tag and calls `updateBook` / `updateWishlistItem`.
- An `+` add button opens a small inline input at the end of the chip row.
- The input provides a datalist-style dropdown with all existing tags (from `getAllTags`).
- Pressing Enter or losing focus with a non-empty value adds the tag (deduplicated, trimmed).

### Tag filter bar (Inventory + Wishlist)

- Shown between the search/status bar and the card grid.
- Displays all distinct tags currently in use across the respective collection.
- Clicking a tag chip toggles it; selected tags are highlighted.
- `filteredBooks` / `filteredItems` memo: item must contain **all** selected tag-filter values.
- If no tags are selected, the filter has no effect (all items shown).
- The filter bar is hidden when there are no tags in the collection.

## Validation

- `pnpm test` must pass (all existing unit tests; no new unit tests required for this plan since tag logic is pure array ops on already-tested data shapes).
- Manual smoke test: add tags, verify persistence across restart, verify AND filter, verify autocomplete.

## Rollout Notes

- Schema change is backward-compatible: `tags` is optional; existing `db.json` records without the field continue to work without migration.
