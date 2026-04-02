# Product Spec: Book Management & Price Comparison

## 1. Introduction

### 1.1 Purpose
The Book Management System (TomeKeep) is a desktop application designed to help users organize their physical book collection and manage book purchasing needs efficiently. It solves the problem of scattered book information and manual price comparison across different online retailers.

### 1.2 Goals
- Provide a centralized inventory for physical books.
- Streamline the book purchasing process with automated price comparisons.
- Ensure data privacy and offline accessibility through local storage.
- Build a foundation for future cross-platform (mobile) support.

## 2. User Scenarios

### 2.1 Inventory Management
- **Add Book**: User manually enters ISBN or scans a barcode to fill ISBN when adding a book. The system attempts to fetch and fill metadata (title, author, cover, publisher) after an explicit user action (ISBN Fill or Douban Fill).
- **ISBN Barcode Scan**: User opens the scan modal; the camera preview displays a live bounding-box overlay highlighting detected barcode candidates. On successful decode, a short audio beep plays and the modal closes automatically.
- **ISBN Semantics**: Each book card displays the language/region derived from the ISBN registration group (e.g. "中文 · 中国大陆"). If the ISBN registrant prefix matches a known publisher, the publisher name is shown in italics as an inferred value (not persisted). Tapping the semantic label copies the raw ISBN to the clipboard.
- **Reading Status**: Reading status (`unread` / `reading` / `read`) is **per-user** and stored independently of the book record. Each user maintains their own reading state for any shared book. Status is indicated by a colour-coded icon badge overlaid on the book cover (green checkmark = Read, yellow open-book = Reading, grey closed-book = Unread). Users without an explicit state for a book are treated as `unread` by default. When a book transitions to `read`, the completion date (`completedAt`) is automatically recorded as an ISO timestamp and displayed on the card as `✓ YYYY-MM-DD`. Transitioning away from `read` clears the completion date.
- **Sort (Library)**: The Library page provides a sort control (icon button group, same row as the search bar) with four keys: Entry Date (`addedAt`, default desc), Completion Date (`completedAt`, desc; books without a date sort last), Title (asc), Author (asc). Clicking the active key toggles direction; clicking a new key switches to it at its default direction.
- **User Profiles**: Users are managed within the app (no passwords). A user selector appears in the sidebar when two or more profiles exist. Switching users reloads reading states for that user without reloading the shared book list. Deleting a user also deletes all their reading states (requires confirmation).
- **Delete**: Delete button is located at the bottom-right of each card.
- **Search & Filter**: User searches for a book by title or author to check if they already own it.

### 2.2 Wishlist & Purchasing
- **Add to Wishlist**: User adds a book to the wishlist. User can optionally paste an ISBN or a Douban book detail URL to fill metadata (title, author, cover, publisher).
- **ISBN Semantics**: Same language/region label and click-to-copy behaviour as inventory cards.
- **Compare Prices**: The system queries configured online retailers (e.g., JD, DangDang, BooksChina) and displays current prices.
- **View Best Deal**: User sees prices per retailer and clicks a link to purchase.
- **Delete**: Remove button is located at the bottom-right of each wishlist row.
- **Sort (Wishlist)**: The Wishlist page provides a sort control (icon button group, displayed as a dedicated row above the tag filter bar) with four keys: Entry Date (`addedAt`, default desc), Title (asc), Author (asc), Priority (asc: High → Medium → Low). Clicking the active key toggles direction; clicking a new key switches to it at its default direction.

## 3. Functional Requirements

### 3.1 Inventory Module
- **FR-INV-01**: System SHALL store book details: Title, Author, ISBN, Publisher (from metadata fill only; not inferred from ISBN prefix), Cover Image, and addedAt timestamp. Reading status is stored separately per user as a `ReadingState` record (not on the Book record).
- **FR-INV-02**: System SHALL allow CRUD operations on book records.
- **FR-INV-03**: System SHALL support keyword search across Title, Author, and ISBN.
- **FR-INV-04**: System SHALL decode the ISBN registration group to display language/region semantics inline on each card, without a network request.
- **FR-INV-05**: System SHALL play an audio beep and display a bounding-box overlay when a barcode is successfully detected during ISBN scanning.
- **FR-INV-06**: Clicking the ISBN semantic label SHALL copy the raw ISBN-13 value to the clipboard.
- **FR-INV-07**: System SHALL allow adding and removing free-form text tags on each book record; tags are persisted alongside the book.
- **FR-INV-08**: System SHALL provide a tag filter bar on the Inventory page; selecting multiple tags filters books using AND logic (book must contain all selected tags).
- **FR-INV-09**: System SHALL support multiple user profiles with independent per-user reading states. Book records (title, author, ISBN, cover, tags, etc.) are shared across all users.
- **FR-INV-10**: System SHALL persist and restore the last active user on launch. When no users exist, reading state interaction is disabled.
- **FR-INV-11**: Deleting a user SHALL require confirmation and SHALL also delete all associated `ReadingState` records.
- **FR-INV-12**: A user selector SHALL appear in the sidebar only when two or more user profiles exist.
- **FR-INV-13**: When a book's reading status transitions to `read`, the system SHALL record the current timestamp as `completedAt` in the `ReadingState` record and display it on the book card as `✓ YYYY-MM-DD`. Transitioning away from `read` SHALL clear `completedAt`.
- **FR-INV-14**: The Library page SHALL provide a sort control with keys: Entry Date, Completion Date, Title, Author. The active sort key and direction SHALL be reflected visually on the control.
- **FR-INV-15**: The Library compact view SHALL provide a column-count slider (range 8–20, default 8) in the toolbar row. The selected column count SHALL be persisted to `localStorage` and restored on next visit.
- **FR-INV-17**: The Library page SHALL display a reading progress bar below the tag filter row. The bar SHALL span the full content width, be visually subtle (thin track), show a pulsing animation at all times, and display a `{read}/{total} 已读` label. Progress is computed from the currently filtered book set (respects active search, status, and tag filters). The bar SHALL only be visible when the library is non-empty.

### 3.2 Wishlist Module
- **FR-WISH-01**: System SHALL maintain a list of books to purchase.
- **FR-WISH-02**: System SHALL allow setting priority (High, Medium, Low) for wishlist items.
- **FR-WISH-03**: System SHALL support moving a book from Wishlist to Inventory upon purchase.
- **FR-WISH-04**: System SHALL allow adding and removing free-form text tags on each wishlist item; tags are persisted alongside the item.
- **FR-WISH-05**: System SHALL provide a tag filter bar on the Wishlist page; selecting multiple tags filters items using AND logic (item must contain all selected tags).
- **FR-WISH-06**: The Wishlist page SHALL provide a sort control with keys: Entry Date, Title, Author, Priority. The active sort key and direction SHALL be reflected visually on the control.

### 3.3 Price Comparison Module
- **FR-PRICE-01**: System SHALL provide an interface to fetch prices for a given ISBN/Title.
- **FR-PRICE-02**: System SHALL support pluggable price providers (Architecture to support multiple sources).
- **FR-PRICE-03**: System SHALL display price, stock status, and direct link to product page.
- **FR-PRICE-04**: When a book is added to the wishlist, the system SHALL automatically trigger price capture for all three configured retailers (JD, Dangdang, BooksChina) concurrently in the background without requiring user interaction.
- **FR-PRICE-05**: Automated price capture SHALL use a local LLM (`qwen2.5:3b` via ollama) to filter irrelevant search result candidates, falling back to bigram similarity when ollama is unavailable or times out. The lowest-priced matching result SHALL be selected.
- **FR-PRICE-06**: If automated price capture encounters a login wall or CAPTCHA for a channel, the system SHALL open a visible browser window on that channel for the user to resolve. Once resolved, capture SHALL resume automatically. If not resolved within 5 minutes, that channel SHALL be skipped.
- **FR-PRICE-07**: Prices obtained via automated capture SHALL be stored with `source: 'auto'` (or `undefined`). Prices obtained via manual capture window SHALL be stored with `source: 'manual'` and SHALL display a ✎ amber badge on the price row. Clicking the badge SHALL remove the manual flag (sets source to `undefined`) without triggering re-capture.
- **FR-PRICE-08**: For channels where a product has already been linked (i.e. a `productId` exists), automated price capture SHALL refresh the price directly from the product page rather than repeating the search-and-match flow.

## 4. Non-Functional Requirements

### 4.1 Platform
- **NFR-PLAT-01**: The application MUST run as a native macOS application (Electron).
- **NFR-PLAT-02**: The UI MUST be responsive and touch-friendly (preparation for mobile).

### 4.2 Data & Privacy
- **NFR-DATA-01**: All data MUST be stored locally (SQLite/JSON).
- **NFR-DATA-02**: No user data shall be sent to external servers except for specific search queries (price comparison) initiated by the user.

### 4.3 Performance
- **NFR-PERF-01**: Application startup time SHOULD be under 2 seconds.
- **NFR-PERF-02**: Inventory search results SHOULD appear within 200ms for a library of up to 10,000 books.

## 5. UI/UX Guidelines
- **Design System**: Clean, modern interface using Tailwind CSS.
- **Theme**: Support Light/Dark mode based on system settings.
- **Navigation**: Sidebar navigation for main modules (Inventory, Wishlist, Settings).
- **View Modes**: Both the Library and Wishlist pages support two view modes, toggled via icon buttons at the right end of the toolbar:
  - **详细视图 (Detail)** (default): Responsive card grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). Each card shows cover, title, author, publisher, tags, ISBN badge, and action controls.
  - **简要视图 (Compact)**: Dense cover grid with user-adjustable column count (range 8–20, default 8). Column count is controlled by a slider in the toolbar row (alongside the tag filter bar), persisted to `localStorage` (`inventoryCompactCols`), and restored on next visit. Each cell shows an `aspect-[2/3]` cover thumbnail and a 2-line title scaled proportionally to cell width (11px at 8 cols, 8px at 20 cols). Clicking a cover toggles an inline expanded panel (`col-span-full`) inserted immediately after the last card in the same row, containing the full detail card. Clicking the title navigates to `book.doubanUrl` if set; otherwise to `https://isbnsearch.org/isbn/<isbn>` if ISBN is set; otherwise shows a toast "无法跳转：未填写 ISBN".
  - The selected view mode for each page is persisted to `localStorage` (`inventoryViewMode` / `wishlistViewMode`) and restored on next visit. Switching view mode resets any open inline expansion.
