#!/usr/bin/env tsx
/**
 * scripts/cleanup-orphans.ts
 *
 * One-shot maintenance script for TomeKeep local data.
 *
 * What it does:
 *   1. Reads ~/Library/Application Support/TomeKeep/db.json
 *   2. Identifies cover files in the covers/ directory that have no matching
 *      book or wishlist ID ("orphan" files — left over from deleted records).
 *   3. Moves those orphan files to /Users/amazing/Documents/tmp (or a custom
 *      BACKUP_DIR env var) for safe-keeping before deletion.
 *   4. Clears the coverKey field on every book and wishlist item in db.json
 *      so that the next `pnpm migrate:cloud` run re-uploads all covers.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-orphans.ts
 *
 *   # Optionally override the backup directory:
 *   BACKUP_DIR=/path/to/backup pnpm tsx scripts/cleanup-orphans.ts
 *
 *   # Dry-run (no files moved, no db.json written):
 *   DRY_RUN=1 pnpm tsx scripts/cleanup-orphans.ts
 *
 * After running this script:
 *   1. Manually clear the R2 bucket (Cloudflare dashboard or wrangler)
 *   2. Re-run: pnpm migrate:cloud
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TomeKeep')
const DB_PATH = path.join(DATA_DIR, 'db.json')
const COVERS_DIR = path.join(DATA_DIR, 'covers')
const BACKUP_DIR = process.env['BACKUP_DIR'] ?? path.join(os.homedir(), 'Documents', 'tmp')
const DRY_RUN = process.env['DRY_RUN'] === '1'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Book {
  id: string
  coverKey?: string
  [key: string]: unknown
}

interface WishlistItem {
  id: string
  coverKey?: string
  [key: string]: unknown
}

interface DatabaseSchema {
  books: Book[]
  wishlist: WishlistItem[]
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('TomeKeep Orphan Cover Cleanup')
  if (DRY_RUN) console.log('(DRY RUN — no files will be moved or written)')
  console.log('')

  // -- 1. Read db.json --------------------------------------------------------
  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: db.json not found at ${DB_PATH}`)
    process.exit(1)
  }
  const db: DatabaseSchema = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
  const books: Book[] = db.books ?? []
  const wishlist: WishlistItem[] = db.wishlist ?? []

  // Build a set of all valid IDs
  const validIds = new Set<string>([
    ...books.map(b => b.id),
    ...wishlist.map(w => w.id),
  ])

  console.log(`Local data:`)
  console.log(`  Books:    ${books.length}`)
  console.log(`  Wishlist: ${wishlist.length}`)
  console.log(`  Valid IDs: ${validIds.size}`)
  console.log('')

  // -- 2. Scan covers directory -----------------------------------------------
  if (!fs.existsSync(COVERS_DIR)) {
    console.log('No covers directory found — nothing to do.')
    return
  }

  const coverFiles = fs.readdirSync(COVERS_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))

  const orphans = coverFiles.filter(f => {
    const id = path.parse(f).name
    return !validIds.has(id)
  })

  const valid = coverFiles.filter(f => {
    const id = path.parse(f).name
    return validIds.has(id)
  })

  console.log(`Cover files:`)
  console.log(`  Total:   ${coverFiles.length}`)
  console.log(`  Valid:   ${valid.length}`)
  console.log(`  Orphans: ${orphans.length}`)
  console.log('')

  // -- 3. Move orphan files to backup directory --------------------------------
  if (orphans.length > 0) {
    console.log(`Moving orphan files to: ${BACKUP_DIR}`)
    if (!DRY_RUN) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
    }

    for (const filename of orphans) {
      const src = path.join(COVERS_DIR, filename)
      const dst = path.join(BACKUP_DIR, filename)
      if (DRY_RUN) {
        console.log(`  [DRY] would move: ${filename}`)
      } else {
        fs.renameSync(src, dst)
        console.log(`  Moved: ${filename}`)
      }
    }
    console.log('')
  } else {
    console.log('No orphan files found.')
    console.log('')
  }

  // -- 4. Clear coverKey from all books and wishlist items --------------------
  const booksWithKey = books.filter(b => b.coverKey).length
  const wishWithKey = wishlist.filter(w => w.coverKey).length
  const totalKeys = booksWithKey + wishWithKey

  console.log(`Clearing coverKey fields in db.json:`)
  console.log(`  Books with coverKey:    ${booksWithKey}`)
  console.log(`  Wishlist with coverKey: ${wishWithKey}`)
  console.log(`  Total to clear:         ${totalKeys}`)

  if (!DRY_RUN) {
    for (const book of books) {
      delete book.coverKey
    }
    for (const item of wishlist) {
      delete item.coverKey
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8')
    console.log('  Written: db.json')
  } else {
    console.log('  [DRY] would clear all coverKey fields and rewrite db.json')
  }

  console.log('')
  console.log('Done!')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Manually clear the R2 bucket (Cloudflare dashboard or wrangler r2 object delete)')
  console.log('  2. Run: pnpm migrate:cloud')
}

main()
