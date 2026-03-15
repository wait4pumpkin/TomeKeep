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
- **Add Book**: User manually enters ISBN or scans a barcode (future) to add a book. The system fetches metadata (title, author, cover) automatically if possible.
- **Search & Filter**: User searches for a book by title or author to check if they already own it.
- **Edit/Delete**: User updates reading status (e.g., "Unread", "Reading", "Read") or removes a book.

### 2.2 Wishlist & Purchasing
- **Add to Wishlist**: User adds a book to the wishlist.
- **Compare Prices**: The system queries configured online retailers (e.g., JD, DangDang, Amazon) and displays current prices.
- **View Best Deal**: User sees the lowest price highlighted and clicks a link to purchase.

## 3. Functional Requirements

### 3.1 Inventory Module
- **FR-INV-01**: System SHALL store book details: Title, Author, ISBN, Publisher, Publish Date, Cover Image, Status (Unread, Reading, Read), Location (Shelf/Box ID), and Rating.
- **FR-INV-02**: System SHALL allow CRUD operations on book records.
- **FR-INV-03**: System SHALL support keyword search across Title, Author, and ISBN.

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
