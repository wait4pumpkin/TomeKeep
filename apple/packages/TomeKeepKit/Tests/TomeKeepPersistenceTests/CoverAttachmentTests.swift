import Foundation
import SwiftData
import Testing
import TomeKeepDomain
import TomeKeepPersistence

@MainActor
struct CoverAttachmentTests {
    @Test func missingFilesAreRetriedInStableOrderAndStaleDownloadsCannotReplaceNewCovers() throws {
        let configuration = ModelConfiguration(schema: PersistenceConfiguration.schema, isStoredInMemoryOnly: true)
        let container = try ModelContainer(for: PersistenceConfiguration.schema, configurations: [configuration])
        let context = ModelContext(container)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        for id in ["b", "a"] {
            context.insert(StoredBook(book: Book(id: id, title: id, author: "", coverKey: "covers/\(id)", coverFileName: "absent-\(id).jpg", addedAt: now, updatedAt: now, syncStatus: .synced)))
        }
        context.insert(StoredWishlistItem(item: WishlistItem(id: "wish", title: "Wish", author: "", coverKey: "covers/new", coverFileName: "absent.jpg", priority: .medium, addedAt: now, updatedAt: now, syncStatus: .synced)))
        try context.save()
        let repository = LocalSyncRepository(context: context)
        #expect(try repository.missingBookCovers().map(\.recordID) == ["a", "b"])
        #expect(try repository.missingWishlistCovers().map(\.recordID) == ["wish"])
        try repository.attachDownloadedCover(.init(recordID: "a", coverKey: "covers/old"), fileName: "stale.jpg", isWishlist: false)
        #expect(try BookRepository(context: context).books().first { $0.id == "a" }?.coverFileName == "absent-a.jpg")
        try repository.attachDownloadedCover(.init(recordID: "wish", coverKey: "covers/old"), fileName: "stale.jpg", isWishlist: true)
        #expect(try WishlistRepository(context: context).items().first?.coverFileName == "absent.jpg")
        try repository.attachDownloadedCover(.init(recordID: "a", coverKey: "covers/a"), fileName: "downloaded.jpg", isWishlist: false)
        let book = try #require(BookRepository(context: context).books().first { $0.id == "a" })
        #expect(book.coverFileName == "downloaded.jpg")
        #expect(book.updatedAt == now)
        #expect(book.syncStatus == .synced)
        try WishlistRepository(context: context).softDelete(id: "wish", at: now)
        try repository.attachDownloadedCover(.init(recordID: "wish", coverKey: "covers/new"), fileName: "ignored.jpg", isWishlist: true)
        let deleted = try #require(context.fetch(FetchDescriptor<StoredWishlistItem>()).first)
        #expect(deleted.coverFileName == "absent.jpg")
    }
}
