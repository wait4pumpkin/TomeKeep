# TomeKeep

TomeKeep is a desktop application designed to help book lovers manage their personal library, track wishlists, and automatically compare prices across various online retailers.

## Features

- **Inventory Management**: Catalog your physical book collection with details like ISBN, author, and reading status.
- **Wishlist Tracking**: Maintain a list of books you want to buy.
- **Price Comparison**: Automatically check prices from multiple online stores to find the best deals.
- **Local Storage**: All data is stored locally for privacy and offline access.

## Tech Stack

- **Framework**: Electron
- **UI Library**: React (with Vite)
- **Language**: TypeScript
- **State Management**: React Context / Hooks
- **Database**: Lowdb (Local JSON storage)
- **Package Manager**: pnpm

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- pnpm (v8 or higher)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd TomeKeep
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

### Development

To start the development server (concurrently running React and Electron):

```bash
pnpm dev
```

### Build

To build the application for macOS:

```bash
pnpm electron:build
```

The output will be in the `release` directory.

## Documentation

- [Project Standards](docs/standards/)
- [Product Specs](docs/product-specs/)
- [Architecture](ARCHITECTURE.md)

## License

[MIT](LICENSE)
