import Foundation
import SwiftData
import Testing
import TomeKeepDomain
import TomeKeepPersistence

@MainActor
struct LibraryRepositoriesTests {
    @Test
    func editingWishlistMetadataPreservesLegacyPriority() throws {
        let repository = WishlistRepository(context: try makeContext())
        let instant = Date(timeIntervalSince1970: 1_700_000_000)
        let original = WishlistItem(
            id: "legacy-priority", title: "原书名", author: "作者",
            priority: .high, addedAt: instant, updatedAt: instant
        )
        try repository.add(original)
        var edited = try #require(repository.items().first)
        edited.title = "更新书名"
        edited.tags = ["文学"]
        edited.updatedAt = instant.addingTimeInterval(10)
        try repository.update(edited)
        let saved = try #require(repository.items().first)
        #expect(saved.priority == .high)
        #expect(saved.title == "更新书名")
        #expect(saved.tags == ["文学"])
    }

    @Test
    func wishlistCRUDAndMoveToLibraryAreAtomic() throws {
        let context = try makeContext()
        let wishlist = WishlistRepository(context: context)
        let books = BookRepository(context: context)
        let instant = Date(timeIntervalSince1970: 1_700_000_000)
        let item = WishlistItem(
            id: "wish-1",
            title: "想读的书",
            author: "作者",
            isbn: "9780306406157",
            coverFileName: "wish-1.jpg",
            tags: ["文学"],
            priority: .high,
            pendingBuy: true,
            addedAt: instant,
            updatedAt: instant
        )

        try wishlist.add(item)
        #expect(try wishlist.items() == [item])

        try wishlist.softDelete(id: item.id, at: instant.addingTimeInterval(30))
        #expect(try wishlist.items().isEmpty)
        try wishlist.restore(id: item.id, at: instant.addingTimeInterval(45))
        #expect(try wishlist.items().map(\.id) == [item.id])

        let moved = try wishlist.moveToLibrary(id: item.id, at: instant.addingTimeInterval(60))
        #expect(moved.title == item.title)
        #expect(moved.coverFileName == item.coverFileName)
        #expect(try wishlist.items().isEmpty)
        #expect(try books.books() == [moved])
    }

    @Test
    func movingDuplicateISBNLeavesWishlistUntouched() throws {
        let context = try makeContext()
        let wishlist = WishlistRepository(context: context)
        let books = BookRepository(context: context)
        let instant = Date(timeIntervalSince1970: 1_700_000_000)
        try books.add(Book(
            id: "book-1", title: "已有", author: "作者", isbn: "9780306406157",
            addedAt: instant, updatedAt: instant
        ))
        try wishlist.add(WishlistItem(
            id: "wish-1", title: "重复", author: "作者", isbn: "9780306406157",
            priority: .medium, addedAt: instant, updatedAt: instant
        ))

        #expect(throws: WishlistRepositoryError.duplicateISBN) {
            try wishlist.moveToLibrary(id: "wish-1", at: instant)
        }
        #expect(try wishlist.items().count == 1)
        #expect(try books.books().count == 1)
    }

    @Test
    func profilesCascadeReadingStatesAndPreserveCompletionDate() throws {
        let context = try makeContext()
        let repository = ProfileRepository(context: context, mutationStore: nil)
        let first = try repository.add(name: " 我 ")
        let second = try repository.add(name: "家人")
        #expect(first.name == "我")
        try repository.setActiveProfile(id: second.id)

        let firstReadAt = Date(timeIntervalSince1970: 1_700_000_000)
        let updatedAt = firstReadAt.addingTimeInterval(300)
        _ = try repository.setReadingStatus(.read, bookID: "book-1", profileID: second.id, at: firstReadAt)
        let unchanged = try repository.setReadingStatus(.read, bookID: "book-1", profileID: second.id, at: updatedAt)
        #expect(unchanged.completedAt == firstReadAt)

        try repository.delete(id: second.id)
        #expect(try repository.activeProfileID() == first.id)
        #expect(try repository.readingStates(profileID: second.id).isEmpty)
        #expect(throws: ProfileRepositoryError.lastProfile) {
            try repository.delete(id: first.id)
        }
    }

    @Test
    func blankProfileNamesAreRejected() throws {
        let repository = ProfileRepository(context: try makeContext(), mutationStore: nil)
        #expect(throws: ProfileRepositoryError.emptyName) {
            try repository.add(name: "  \n")
        }
    }

    @Test
    func syncMergeKeepsNewerPendingBookAndAdvancesCursor() throws {
        let context = try makeContext()
        let repository = LocalSyncRepository(context: context)
        let newer = Date(timeIntervalSince1970: 1_800_000_000)
        let older = newer.addingTimeInterval(-60)
        let local = StoredBook(book: Book(
            id: "book-1", title: "本机新版", author: "作者",
            addedAt: older, updatedAt: newer, syncStatus: .pending
        ))
        context.insert(local)
        try context.save()

        try repository.mergeBooks([
            BookSyncRecord(
                book: Book(
                    id: "book-1", title: "服务器旧版", author: "作者",
                    addedAt: older, updatedAt: older, syncStatus: .synced
                ),
                deletedAt: nil
            )
        ], cursor: "2026-09-24T00:00:00Z")

        #expect(local.title == "本机新版")
        #expect(local.syncStatusRawValue == SyncStatus.pending.rawValue)
        #expect(try repository.cursors().books == "2026-09-24T00:00:00Z")
    }

    @Test
    func syncMergeAppliesNewerRemoteDeletion() throws {
        let context = try makeContext()
        let repository = LocalSyncRepository(context: context)
        let older = Date(timeIntervalSince1970: 1_700_000_000)
        let newer = older.addingTimeInterval(60)
        let local = StoredBook(book: Book(
            id: "book-1", title: "旧标题", author: "作者",
            addedAt: older, updatedAt: older, syncStatus: .pending
        ))
        context.insert(local)
        try context.save()

        try repository.mergeBooks([
            BookSyncRecord(
                book: Book(
                    id: "book-1", title: "新标题", author: "作者",
                    addedAt: older, updatedAt: newer, syncStatus: .synced
                ),
                deletedAt: newer
            )
        ], cursor: nil)

        #expect(local.title == "新标题")
        #expect(local.deletedAt == newer)
        #expect(local.syncStatusRawValue == SyncStatus.synced.rawValue)
    }

    @Test
    func syncImportsOnlyMissingProfiles() throws {
        let context = try makeContext()
        let repository = LocalSyncRepository(context: context)
        let localDate = Date(timeIntervalSince1970: 100)
        context.insert(try StoredUserProfile(profile: UserProfile(id: "p1", name: "本机名称", createdAt: localDate)))
        try context.save()

        try repository.mergeMissingProfiles([
            UserProfile(id: "p1", name: "远端名称", createdAt: localDate),
            UserProfile(id: "p2", name: "远端新增", createdAt: localDate),
        ])

        let profiles = try repository.profiles().sorted { $0.id < $1.id }
        #expect(profiles.map(\.id) == ["p1", "p2"])
        #expect(profiles.first?.name == "本机名称")
    }

    @Test
    func priceCacheUpsertReplacesEntryWithoutDuplicatingIt() throws {
        let context = try makeContext()
        let repository = PriceCacheRepository(context: context)
        let instant = Date(timeIntervalSince1970: 1_700_000_000)
        let url = URL(string: "https://item.jd.com/123.html")!
        let original = PriceCacheEntry(
            key: "书::作者", title: "书", quotes: [
                PriceQuote(channel: .jd, currency: "CNY", url: url, fetchedAt: instant, status: .ok, priceCNY: 20)
            ], updatedAt: instant, expiresAt: instant.addingTimeInterval(60)
        )
        try repository.upsert(original)
        var updated = original
        updated.quotes[0].priceCNY = 18
        updated.updatedAt = instant.addingTimeInterval(10)
        try repository.upsert(updated)

        #expect(try repository.entries().count == 1)
        #expect(try repository.entry(key: original.key)?.quotes.first?.priceCNY == 18)
    }

    @Test
    func priceCacheSyncKeepsNewestEntry() throws {
        let context = try makeContext()
        let local = PriceCacheRepository(context: context)
        let sync = LocalSyncRepository(context: context)
        let instant = Date(timeIntervalSince1970: 1_700_000_000)
        let url = URL(string: "https://item.jd.com/123.html")!
        let newer = PriceCacheEntry(
            key: "book::author", title: "Book", quotes: [
                PriceQuote(channel: .jd, currency: "CNY", url: url, fetchedAt: instant, status: .ok, priceCNY: 20)
            ], updatedAt: instant.addingTimeInterval(10), expiresAt: instant.addingTimeInterval(60)
        )
        try local.upsert(newer)
        var older = newer
        older.quotes[0].priceCNY = 1
        older.updatedAt = instant
        try sync.mergePriceCache([older])
        #expect(try local.entry(key: newer.key)?.quotes.first?.priceCNY == 20)

        var newest = newer
        newest.quotes[0].priceCNY = 18
        newest.updatedAt = instant.addingTimeInterval(20)
        try sync.mergePriceCache([newest])
        #expect(try local.entry(key: newer.key)?.quotes.first?.priceCNY == 18)
    }

    @Test
    func versionedSchemaCreatesAndReopensStore() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "TomeKeep.store")
        do {
            let container = try PersistenceConfiguration.makeContainer(url: url)
            let context = ModelContext(container)
            try BookRepository(context: context).add(Book(id: "v1", title: "版本化", author: "", addedAt: .now, updatedAt: .now))
        }
        do {
            let container = try PersistenceConfiguration.makeContainer(url: url)
            let context = ModelContext(container)
            #expect(try BookRepository(context: context).books().map(\.id) == ["v1"])
        }
    }

    private func makeContext() throws -> ModelContext {
        let configuration = ModelConfiguration(
            schema: PersistenceConfiguration.schema,
            isStoredInMemoryOnly: true
        )
        let container = try ModelContainer(
            for: PersistenceConfiguration.schema,
            configurations: [configuration]
        )
        return ModelContext(container)
    }
}
