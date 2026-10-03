import Foundation
import SwiftData
import TomeKeepDomain

public struct BookSyncRecord: Sendable {
    public var book: Book
    public var deletedAt: Date?

    public init(book: Book, deletedAt: Date?) {
        self.book = book
        self.deletedAt = deletedAt
    }
}

public struct WishlistSyncRecord: Sendable {
    public var item: WishlistItem
    public var deletedAt: Date?

    public init(item: WishlistItem, deletedAt: Date?) {
        self.item = item
        self.deletedAt = deletedAt
    }
}

public struct LocalCoverReference: Equatable, Sendable {
    public var recordID: String
    public var coverKey: String

    public init(recordID: String, coverKey: String) {
        self.recordID = recordID
        self.coverKey = coverKey
    }
}

public struct ProfileSyncRecord: Equatable, Sendable {
    public var profile: UserProfile
    public var deletedAt: Date?

    public init(profile: UserProfile, deletedAt: Date?) {
        self.profile = profile
        self.deletedAt = deletedAt
    }
}

@MainActor
public struct LocalSyncRepository {
    private let context: ModelContext

    public init(context: ModelContext) {
        self.context = context
    }

    public func pendingBooks() throws -> [BookSyncRecord] {
        let descriptor = FetchDescriptor<StoredBook>(predicate: #Predicate { $0.syncStatusRawValue == "pending" })
        return try context.fetch(descriptor).map { BookSyncRecord(book: $0.snapshot(), deletedAt: $0.deletedAt) }
    }

    public func pendingWishlist() throws -> [WishlistSyncRecord] {
        let descriptor = FetchDescriptor<StoredWishlistItem>(predicate: #Predicate { $0.syncStatusRawValue == "pending" })
        return try context.fetch(descriptor).map { WishlistSyncRecord(item: $0.snapshot(), deletedAt: $0.deletedAt) }
    }

    public func pendingReadingStates() throws -> [ReadingState] {
        let descriptor = FetchDescriptor<StoredReadingState>(predicate: #Predicate { $0.syncStatusRawValue == "pending" })
        return try context.fetch(descriptor).map { $0.snapshot() }
    }

    public func profiles() throws -> [UserProfile] {
        try context.fetch(FetchDescriptor<StoredUserProfile>()).map { $0.snapshot() }
    }

    public func priceCacheEntries() throws -> [PriceCacheEntry] {
        try context.fetch(FetchDescriptor<StoredPriceCacheEntry>()).map { try $0.snapshot() }
    }

    /// Imports profiles that only exist in the account. Existing local profiles
    /// are intentionally preserved because the legacy profile model has no
    /// per-record revision; local edits are subsequently upserted to the server.
    public func mergeMissingProfiles(_ profiles: [UserProfile]) throws {
        let existingIDs = Set(try context.fetch(FetchDescriptor<StoredUserProfile>()).map(\.id))
        var insertedFirstID: String?
        for profile in profiles where !existingIDs.contains(profile.id) {
            context.insert(try StoredUserProfile(profile: profile))
            insertedFirstID = insertedFirstID ?? profile.id
        }
        let state = try libraryState()
        if state.activeProfileID == nil { state.activeProfileID = insertedFirstID }
        try context.save()
    }

    public func mergeProfiles(_ records: [ProfileSyncRecord]) throws {
        let existing = Dictionary(
            uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredUserProfile>()).map { ($0.id, $0) }
        )
        let states = try context.fetch(FetchDescriptor<StoredReadingState>())
        for record in records {
            if record.deletedAt != nil {
                if let stored = existing[record.profile.id] { context.delete(stored) }
                for state in states where state.profileID == record.profile.id { context.delete(state) }
            } else if let stored = existing[record.profile.id] {
                stored.name = record.profile.name
            } else {
                context.insert(try StoredUserProfile(profile: record.profile))
            }
        }
        let library = try libraryState()
        let deletedIDs = Set(records.filter { $0.deletedAt != nil }.map { $0.profile.id })
        if let activeID = library.activeProfileID, deletedIDs.contains(activeID) {
            library.activeProfileID = records.first { $0.deletedAt == nil }?.profile.id
        } else if library.activeProfileID == nil {
            library.activeProfileID = records.first { $0.deletedAt == nil }?.profile.id
        }
        try context.save()
    }

    public func cursors() throws -> SyncCursors {
        let state = try libraryState()
        return SyncCursors(books: state.bookCursor, wishlist: state.wishlistCursor, readingStates: state.readingStateCursor)
    }

    public func markBookSynced(id: String) throws {
        var descriptor = FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        try context.fetch(descriptor).first?.syncStatusRawValue = SyncStatus.synced.rawValue
        try context.save()
    }

    public func markWishlistSynced(id: String) throws {
        var descriptor = FetchDescriptor<StoredWishlistItem>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        try context.fetch(descriptor).first?.syncStatusRawValue = SyncStatus.synced.rawValue
        try context.save()
    }

    public func markReadingStateSynced(profileID: String, bookID: String) throws {
        let id = StoredReadingState.identifier(profileID: profileID, bookID: bookID)
        var descriptor = FetchDescriptor<StoredReadingState>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        try context.fetch(descriptor).first?.syncStatusRawValue = SyncStatus.synced.rawValue
        try context.save()
    }

    public func setBookCoverKey(id: String, coverKey: String) throws {
        var descriptor = FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        try context.fetch(descriptor).first?.coverKey = coverKey
        try context.save()
    }

    public func setWishlistCoverKey(id: String, coverKey: String) throws {
        var descriptor = FetchDescriptor<StoredWishlistItem>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        try context.fetch(descriptor).first?.coverKey = coverKey
        try context.save()
    }

    public func missingBookCovers() throws -> [LocalCoverReference] {
        try context.fetch(FetchDescriptor<StoredBook>()).compactMap { stored in
            guard stored.deletedAt == nil,
                  stored.coverFileName == nil,
                  let key = stored.coverKey,
                  !key.isEmpty
            else { return nil }
            return LocalCoverReference(recordID: stored.id, coverKey: key)
        }
    }

    public func missingWishlistCovers() throws -> [LocalCoverReference] {
        try context.fetch(FetchDescriptor<StoredWishlistItem>()).compactMap { stored in
            guard stored.deletedAt == nil,
                  stored.coverFileName == nil,
                  let key = stored.coverKey,
                  !key.isEmpty
            else { return nil }
            return LocalCoverReference(recordID: stored.id, coverKey: key)
        }
    }

    public func setBookCoverFileName(id: String, fileName: String) throws {
        var descriptor = FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        try context.fetch(descriptor).first?.coverFileName = fileName
        try context.save()
    }

    public func setWishlistCoverFileName(id: String, fileName: String) throws {
        var descriptor = FetchDescriptor<StoredWishlistItem>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        try context.fetch(descriptor).first?.coverFileName = fileName
        try context.save()
    }

    public func mergeBooks(_ records: [BookSyncRecord], cursor: String?) throws {
        let existing = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredBook>()).map { ($0.id, $0) })
        for record in records {
            if let stored = existing[record.book.id] {
                guard record.book.updatedAt > stored.updatedAt else { continue }
                apply(record, to: stored)
            } else {
                let stored = StoredBook(book: record.book)
                stored.deletedAt = record.deletedAt
                stored.syncStatusRawValue = SyncStatus.synced.rawValue
                context.insert(stored)
            }
        }
        let state = try libraryState()
        if let cursor { state.bookCursor = cursor }
        state.lastSyncAt = .now
        try context.save()
    }

    public func mergeWishlist(_ records: [WishlistSyncRecord], cursor: String?) throws {
        let existing = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredWishlistItem>()).map { ($0.id, $0) })
        for record in records {
            if let stored = existing[record.item.id] {
                guard record.item.updatedAt > stored.updatedAt else { continue }
                apply(record, to: stored)
            } else {
                let stored = StoredWishlistItem(item: record.item)
                stored.deletedAt = record.deletedAt
                stored.syncStatusRawValue = SyncStatus.synced.rawValue
                context.insert(stored)
            }
        }
        let state = try libraryState()
        if let cursor { state.wishlistCursor = cursor }
        state.lastSyncAt = .now
        try context.save()
    }

    public func mergeReadingStates(_ states: [ReadingState], cursor: String?) throws {
        let existing = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredReadingState>()).map { ($0.id, $0) })
        for var state in states {
            state.syncStatus = .synced
            let id = StoredReadingState.identifier(profileID: state.profileID, bookID: state.bookID)
            if let stored = existing[id] {
                guard state.updatedAt > stored.updatedAt else { continue }
                stored.statusRawValue = state.status.rawValue
                stored.completedAt = state.completedAt
                stored.updatedAt = state.updatedAt
                stored.syncStatusRawValue = SyncStatus.synced.rawValue
            } else {
                context.insert(StoredReadingState(state: state))
            }
        }
        let library = try libraryState()
        if let cursor { library.readingStateCursor = cursor }
        library.lastSyncAt = .now
        try context.save()
    }

    public func mergePriceCache(_ entries: [PriceCacheEntry]) throws {
        let existing = Dictionary(
            uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredPriceCacheEntry>()).map { ($0.key, $0) }
        )
        for entry in entries {
            if let stored = existing[entry.key] {
                guard entry.updatedAt >= stored.updatedAt else { continue }
                stored.title = entry.title
                stored.author = entry.author
                stored.isbn = entry.isbn
                stored.quotesData = try JSONEncoder().encode(entry.quotes)
                stored.updatedAt = entry.updatedAt
                stored.expiresAt = entry.expiresAt
            } else {
                context.insert(try StoredPriceCacheEntry(entry: entry))
            }
        }
        try context.save()
    }

    private func apply(_ record: BookSyncRecord, to stored: StoredBook) {
        stored.title = record.book.title
        stored.author = record.book.author
        stored.isbn = record.book.isbn
        stored.publisher = record.book.publisher
        stored.coverKey = record.book.coverKey
        stored.detailURL = record.book.detailURL
        stored.tags = record.book.tags
        stored.addedAt = record.book.addedAt
        stored.updatedAt = record.book.updatedAt
        stored.deletedAt = record.deletedAt
        stored.syncStatusRawValue = SyncStatus.synced.rawValue
    }

    private func apply(_ record: WishlistSyncRecord, to stored: StoredWishlistItem) {
        stored.title = record.item.title
        stored.author = record.item.author
        stored.isbn = record.item.isbn
        stored.publisher = record.item.publisher
        stored.coverKey = record.item.coverKey
        stored.detailURL = record.item.detailURL
        stored.tags = record.item.tags
        stored.priorityRawValue = record.item.priority.rawValue
        stored.pendingBuy = record.item.pendingBuy
        stored.addedAt = record.item.addedAt
        stored.updatedAt = record.item.updatedAt
        stored.deletedAt = record.deletedAt
        stored.syncStatusRawValue = SyncStatus.synced.rawValue
    }

    private func libraryState() throws -> StoredLibraryState {
        var descriptor = FetchDescriptor<StoredLibraryState>(predicate: #Predicate { $0.id == "library" })
        descriptor.fetchLimit = 1
        if let state = try context.fetch(descriptor).first { return state }
        let state = StoredLibraryState()
        context.insert(state)
        return state
    }
}
