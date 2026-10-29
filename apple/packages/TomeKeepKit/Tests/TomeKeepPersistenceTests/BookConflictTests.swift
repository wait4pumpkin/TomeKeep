import Foundation
import SwiftData
import Testing
import TomeKeepDomain
@testable import TomeKeepPersistence

@MainActor
struct BookConflictTests {
    private let instant = Date(timeIntervalSince1970: 1_700_000_000)

    private func context() throws -> ModelContext {
        let config = ModelConfiguration(schema: PersistenceConfiguration.schema, isStoredInMemoryOnly: true)
        return try ModelContext(ModelContainer(for: PersistenceConfiguration.schema, configurations: [config]))
    }

    @Test func journalRetiresAliasWithoutServerDeleteAndReplaysAfterRestart() throws {
        let context = try context()
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = try BookConflictStore(accountID: "test-user", directory: directory)
        let canonical = Book(id: "remote", title: "Dune", author: "Author", isbn: "9780306406157", tags: ["A"], addedAt: instant, updatedAt: instant, syncStatus: .synced)
        let local = Book(id: "local", title: "Dune", author: "Author", isbn: "0306406152", tags: ["B"], addedAt: instant, updatedAt: instant)
        context.insert(StoredBook(book: canonical)); context.insert(StoredBook(book: local))
        context.insert(StoredReadingState(state: ReadingState(profileID: "p1", bookID: "local", status: .read, completedAt: instant, updatedAt: instant)))
        try context.save()
        let repo = LocalSyncRepository(context: context)
        var entry = try repo.prepareConflict(localID: "local", canonical: canonical, revision: 1, store: store)
        #expect(try store.entries().first?.local == local)
        #expect(try BookConflictStore(accountID: "other-user", directory: directory).entries().isEmpty)
        #expect(entry.conflictingFields.isEmpty)
        #expect(entry.mergedBook().tags == ["A", "B"])
        #expect(throws: BookConflictError.invalidIdentity) { try repo.retireConflictAlias(entry) }
        entry.aliasVerifiedAbsent = true
        try store.save(entry)
        try repo.retireConflictAlias(entry)
        try repo.retireConflictAlias(try #require(BookConflictStore(accountID: "test-user", directory: directory).entries().first))
        #expect(try BookRepository(context: context).books().map(\.id) == ["remote"])
        #expect(try repo.pendingBooks().isEmpty)
        #expect(try repo.pendingReadingStates().first?.bookID == "remote")
        #expect(try repo.pendingReadingStates().first?.completedAt == instant)
        let confirmed = entry.mergedBook()
        try repo.finishConflict(entry, confirmed: confirmed, selected: confirmed, expectedLocalUpdate: instant)
        #expect(try repo.book(id: "remote")?.tags == ["A", "B"])
        #expect(try store.entries().first?.local.tags == ["B"])
    }

    @Test func differentFieldsAndReadingProfilesRequireExplicitChoices() {
        let left = Book(id: "local", title: "Local", author: "", isbn: "9780306406157", publisher: "Publisher", coverFileName: "local.jpg", rating: 4, tags: ["A"], addedAt: instant, updatedAt: instant)
        let right = Book(id: "remote", title: "Cloud", author: "Author", isbn: "9780306406157", coverKey: "covers/remote", rating: 3, tags: ["B"], addedAt: instant.addingTimeInterval(10), updatedAt: instant)
        let localStates = [ReadingState(profileID: "p1", bookID: "local", status: .unread, updatedAt: instant), ReadingState(profileID: "p2", bookID: "local", status: .read, completedAt: instant, updatedAt: instant)]
        let cloudStates = [ReadingState(profileID: "p1", bookID: "remote", status: .read, completedAt: instant, updatedAt: instant)]
        var entry = BookIdentityConflict(local: left, canonical: right, localReading: localStates, canonicalReading: cloudStates, revision: 1)
        #expect(Set(entry.conflictingFields) == ["title", "cover", "rating", "reading:p1"])
        #expect(entry.needsChoice)
        #expect(entry.mergedBook().title == "Cloud")
        #expect(entry.mergedBook().publisher == "Publisher")
        #expect(entry.mergedBook().author == "Author")
        #expect(entry.mergedBook().addedAt == instant)
        entry.localChoices = ["title", "reading:p1"]
        #expect(!entry.needsChoice)
        #expect(entry.mergedBook().title == "Local")
        #expect(entry.mergedBook().rating == 3)
        #expect(entry.mergedReading().first { $0.profileID == "p1" }?.status == .unread)
        #expect(entry.mergedReading().first { $0.profileID == "p2" }?.completedAt == instant)
    }

    @Test func changedLocalDataCannotBeSilentlyDiscarded() throws {
        let context = try context()
        let remote = Book(id: "remote", title: "Book", author: "", isbn: "9780306406157", addedAt: instant, updatedAt: instant, syncStatus: .synced)
        let local = Book(id: "local", title: "Book", author: "", isbn: "9780306406157", addedAt: instant, updatedAt: instant)
        context.insert(StoredBook(book: remote)); context.insert(StoredBook(book: local)); try context.save()
        var entry = BookIdentityConflict(local: local, canonical: remote, localReading: [], canonicalReading: [], revision: 1)
        entry.aliasVerifiedAbsent = true
        var changed = local; changed.title = "New edit"; changed.updatedAt = instant.addingTimeInterval(1)
        // Simulate an edit without going through the duplicate-ISBN guard.
        let stored = try #require(context.fetch(FetchDescriptor<StoredBook>()).first { $0.id == "local" })
        stored.title = changed.title; stored.updatedAt = changed.updatedAt; try context.save()
        #expect(throws: BookConflictError.changedLocally) { try LocalSyncRepository(context: context).retireConflictAlias(entry) }
        #expect(try BookRepository(context: context).books().count == 2)
    }

    @Test func staleReviewCannotApplyChoicesToNewerSnapshot() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try BookConflictStore(accountID: "test", directory: directory)
        let local = Book(id: "local", title: "Local", author: "", isbn: "9780306406157", addedAt: instant, updatedAt: instant)
        let remote = Book(id: "remote", title: "Remote", author: "", isbn: "9780306406157", addedAt: instant, updatedAt: instant)
        let original = BookIdentityConflict(local: local, canonical: remote, localReading: [], canonicalReading: [], revision: 1)
        try store.save(original)
        var changed = original; changed.revision = 2
        try store.save(changed)
        #expect(throws: BookConflictError.changedLocally) {
            try store.choose(id: original.id, expected: original, localFields: ["title"])
        }
        #expect(try store.entries().first?.localChoices == nil)
        try store.choose(id: changed.id, expected: changed, localFields: ["title"])
        #expect(try store.entries().first?.localChoices == ["title"])
    }

    @Test func syncAcknowledgementDoesNotEraseEditMadeDuringUpload() throws {
        let context = try context()
        let book = Book(id: "book", title: "Edited", author: "", addedAt: instant, updatedAt: instant.addingTimeInterval(1))
        context.insert(StoredBook(book: book)); try context.save()
        let repo = LocalSyncRepository(context: context)
        try repo.markBookSynced(id: book.id, expectedUpdatedAt: instant)
        #expect(try repo.pendingBooks().count == 1)
        try repo.markBookSynced(id: book.id, expectedUpdatedAt: book.updatedAt)
        #expect(try repo.pendingBooks().isEmpty)
    }

    @Test func confirmedWishlistPurchaseUsesNormalizedExistingIdentity() throws {
        let context = try context()
        let book = Book(id: "book", title: "Keep title", author: "Author", isbn: "0306406152", tags: ["A"], addedAt: instant, updatedAt: instant)
        context.insert(StoredBook(book: book))
        let wish = WishlistItem(id: "wish", title: "Wishlist title", author: "", isbn: "9780306406157", tags: ["B"], priority: .medium, addedAt: instant, updatedAt: instant)
        context.insert(StoredWishlistItem(item: wish)); try context.save()
        let repository = WishlistRepository(context: context)
        #expect(throws: WishlistRepositoryError.duplicateISBN) { try repository.moveToLibrary(id: wish.id) }
        let result = try repository.completePurchaseUsingExistingBook(id: wish.id)
        #expect(result.id == book.id)
        #expect(result.title == "Keep title")
        #expect(result.tags == ["A", "B"])
        #expect(try BookRepository(context: context).books().count == 1)
        #expect(try repository.items().isEmpty)
        #expect(try LocalSyncRepository(context: context).pendingWishlist().first?.deletedAt != nil)
    }
}
