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
- **Reading Status**: Reading status is indicated by a colour-coded icon badge overlaid on the book cover (green checkmark = Read, yellow open-book = Reading, grey closed-book = Unread).
- **Delete**: Delete button is located at the bottom-right of each card.
- **Search & Filter**: User searches for a book by title or author to check if they already own it.

### 2.2 Wishlist & Purchasing
- **Add to Wishlist**: User adds a book to the wishlist. User can optionally paste an ISBN or a Douban book detail URL to fill metadata (title, author, cover, publisher).
- **ISBN Semantics**: Same language/region label and click-to-copy behaviour as inventory cards.
- **Compare Prices**: The system queries configured online retailers (e.g., JD, DangDang, BooksChina) and displays current prices.
- **View Best Deal**: User sees prices per retailer and clicks a link to purchase.
- **Delete**: Remove button is located at the bottom-right of each wishlist row.

## 3. Functional Requirements

### 3.1 Inventory Module
- **FR-INV-01**: System SHALL store book details: Title, Author, ISBN, Publisher (from metadata fill only; not inferred from ISBN prefix), Cover Image, Status (Unread, Reading, Read), and addedAt timestamp.
- **FR-INV-02**: System SHALL allow CRUD operations on book records.
- **FR-INV-03**: System SHALL support keyword search across Title, Author, and ISBN.
- **FR-INV-04**: System SHALL decode the ISBN registration group to display language/region semantics inline on each card, without a network request.
- **FR-INV-05**: System SHALL play an audio beep and display a bounding-box overlay when a barcode is successfully detected during ISBN scanning.
- **FR-INV-06**: Clicking the ISBN semantic label SHALL copy the raw ISBN-13 value to the clipboard.

### 3.2 Wishlist Module
- **FR-WISH-01**: System SHALL maintain a list of books to purchase.
- **FR-WISH-02**: System SHALL allow setting priority (High, Medium, Low) for wishlist items.
- **FR-WISH-03**: System SHALL support moving a book from Wishlist to Inventory upon purchase.

### 3.3 Price Comparison Module
- **FR-PRICE-01**: System SHALL provide an interface to fetch prices for a given ISBN/Title.
- **FR-PRICE-02**: System SHALL support pluggable price providers (Architecture to support multiple sources).
- **FR-PRICE-03**: System SHALL display price, stock status, and direct link to product page.

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
