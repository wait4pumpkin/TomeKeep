import Foundation
import SwiftData
import TomeKeepDomain

public enum WishlistRepositoryError: Error, Equatable {
    case duplicateISBN
    case missingItem
}

@MainActor
public struct WishlistRepository {
    private let context: ModelContext

    public init(context: ModelContext) {
        self.context = context
    }

    public func items() throws -> [WishlistItem] {
        let descriptor = FetchDescriptor<StoredWishlistItem>(
            predicate: #Predicate { $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.addedAt, order: .reverse)]
        )
        return try context.fetch(descriptor).map { $0.snapshot() }
    }

    public func add(_ item: WishlistItem) throws {
        try ensureISBNIsAvailable(item.isbn, excluding: nil)
        context.insert(StoredWishlistItem(item: item))
        try context.save()
    }

    public func update(_ item: WishlistItem) throws {
        try ensureISBNIsAvailable(item.isbn, excluding: item.id)
        guard let stored = try storedItem(id: item.id) else {
            throw WishlistRepositoryError.missingItem
        }
        apply(item, to: stored)
        try context.save()
    }

    public func softDelete(id: String, at instant: Date = .now) throws {
        guard let stored = try storedItem(id: id) else {
            throw WishlistRepositoryError.missingItem
        }
        stored.deletedAt = instant
        stored.updatedAt = instant
        stored.syncStatusRawValue = SyncStatus.pending.rawValue
        try context.save()
    }

    public func restore(id: String, at instant: Date = .now) throws {
        guard let stored = try storedItem(id: id) else {
            throw WishlistRepositoryError.missingItem
        }
        try ensureISBNIsAvailable(stored.isbn, excluding: id)
        stored.deletedAt = nil
        stored.updatedAt = instant
        stored.syncStatusRawValue = SyncStatus.pending.rawValue
        try context.save()
    }

    @discardableResult
    public func moveToLibrary(id: String, at instant: Date = .now) throws -> Book {
        guard let stored = try storedItem(id: id) else {
            throw WishlistRepositoryError.missingItem
        }
        if let isbn = stored.isbn {
            let descriptor = FetchDescriptor<StoredBook>(
                predicate: #Predicate { $0.isbn == isbn && $0.deletedAt == nil }
            )
            if try !context.fetch(descriptor).isEmpty {
                throw WishlistRepositoryError.duplicateISBN
            }
        }
        let book = Book(
            id: UUID().uuidString.lowercased(),
            title: stored.title,
            author: stored.author,
            isbn: stored.isbn,
            publisher: stored.publisher,
            coverURL: stored.coverURL,
            coverKey: stored.coverKey,
            coverFileName: stored.coverFileName,
            detailURL: stored.detailURL,
            tags: stored.tags,
            addedAt: instant,
            updatedAt: instant
        )
        context.insert(StoredBook(book: book))
        stored.deletedAt = instant
        stored.updatedAt = instant
        stored.syncStatusRawValue = SyncStatus.pending.rawValue
        try context.save()
        return book
    }

    private func storedItem(id: String) throws -> StoredWishlistItem? {
        var descriptor = FetchDescriptor<StoredWishlistItem>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    private func ensureISBNIsAvailable(_ isbn: String?, excluding excludedID: String?) throws {
        guard let isbn, !isbn.isEmpty else { return }
        let descriptor = FetchDescriptor<StoredWishlistItem>(
            predicate: #Predicate { $0.isbn == isbn && $0.deletedAt == nil }
        )
        if try context.fetch(descriptor).contains(where: { $0.id != excludedID }) {
            throw WishlistRepositoryError.duplicateISBN
        }
    }

    private func apply(_ item: WishlistItem, to stored: StoredWishlistItem) {
        stored.title = item.title
        stored.author = item.author
        stored.isbn = item.isbn
        stored.publisher = item.publisher
        stored.coverURL = item.coverURL
        stored.coverKey = item.coverKey
        stored.coverFileName = item.coverFileName
        stored.detailURL = item.detailURL
        stored.tags = item.tags
        stored.priorityRawValue = item.priority.rawValue
        stored.pendingBuy = item.pendingBuy
        stored.updatedAt = item.updatedAt
        stored.syncStatusRawValue = SyncStatus.pending.rawValue
    }
}

public enum ProfileRepositoryError: Error, Equatable {
    case missingProfile
    case lastProfile
    case emptyName
}

@MainActor
public struct ProfileRepository {
    private let context: ModelContext
    private let mutationStore: ProfileMutationStore?

    public init(context: ModelContext, mutationStore: ProfileMutationStore? = try? ProfileMutationStore()) {
        self.context = context
        self.mutationStore = mutationStore
    }

    public func profiles() throws -> [UserProfile] {
        try context.fetch(
            FetchDescriptor<StoredUserProfile>(sortBy: [SortDescriptor(\.createdAt)])
        ).map { $0.snapshot() }
    }

    public func activeProfileID() throws -> String? {
        var descriptor = FetchDescriptor<StoredLibraryState>(predicate: #Predicate { $0.id == "library" })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first?.activeProfileID
    }

    public func setActiveProfile(id: String) throws {
        guard try profile(id: id) != nil else { throw ProfileRepositoryError.missingProfile }
        let state = try libraryState()
        state.activeProfileID = id
        try context.save()
    }

    public func add(name: String, at instant: Date = .now) throws -> UserProfile {
        let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty else { throw ProfileRepositoryError.emptyName }
        let profile = UserProfile(
            id: UUID().uuidString.lowercased(),
            name: normalizedName,
            createdAt: instant
        )
        context.insert(try StoredUserProfile(profile: profile))
        let state = try libraryState()
        if state.activeProfileID == nil { state.activeProfileID = profile.id }
        try context.save()
        try mutationStore?.record(profileID: profile.id, kind: .upsert, name: profile.name, at: instant)
        return profile
    }

    public func rename(id: String, name: String) throws {
        let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty else { throw ProfileRepositoryError.emptyName }
        guard let stored = try profile(id: id) else { throw ProfileRepositoryError.missingProfile }
        stored.name = normalizedName
        try context.save()
        try mutationStore?.record(profileID: id, kind: .upsert, name: normalizedName)
    }

    public func delete(id: String) throws {
        let allProfiles = try context.fetch(FetchDescriptor<StoredUserProfile>())
        guard allProfiles.count > 1 else { throw ProfileRepositoryError.lastProfile }
        guard let stored = allProfiles.first(where: { $0.id == id }) else {
            throw ProfileRepositoryError.missingProfile
        }
        context.delete(stored)
        let states = try context.fetch(FetchDescriptor<StoredReadingState>())
        for state in states where state.profileID == id { context.delete(state) }
        let library = try libraryState()
        if library.activeProfileID == id {
            library.activeProfileID = allProfiles.first(where: { $0.id != id })?.id
        }
        try context.save()
        try mutationStore?.record(profileID: id, kind: .delete, name: nil)
    }

    public func readingStates(profileID: String) throws -> [String: ReadingState] {
        let descriptor = FetchDescriptor<StoredReadingState>(
            predicate: #Predicate { $0.profileID == profileID }
        )
        return Dictionary(uniqueKeysWithValues: try context.fetch(descriptor).map { ($0.bookID, $0.snapshot()) })
    }

    public func setReadingStatus(
        _ status: ReadingStatus,
        bookID: String,
        profileID: String,
        at instant: Date = .now
    ) throws -> ReadingState {
        let id = StoredReadingState.identifier(profileID: profileID, bookID: bookID)
        var descriptor = FetchDescriptor<StoredReadingState>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        if let stored = try context.fetch(descriptor).first {
            let completedAt = status == .read ? (stored.completedAt ?? instant) : nil
            stored.statusRawValue = status.rawValue
            stored.completedAt = completedAt
            stored.updatedAt = instant
            stored.syncStatusRawValue = SyncStatus.pending.rawValue
            try context.save()
            return stored.snapshot()
        }
        let completedAt = status == .read ? instant : nil
        let state = ReadingState(
            profileID: profileID,
            bookID: bookID,
            status: status,
            completedAt: completedAt,
            updatedAt: instant
        )
        context.insert(StoredReadingState(state: state))
        try context.save()
        return state
    }

    private func profile(id: String) throws -> StoredUserProfile? {
        var descriptor = FetchDescriptor<StoredUserProfile>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
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

@MainActor
public struct PriceCacheRepository {
    private let context: ModelContext

    public init(context: ModelContext) {
        self.context = context
    }

    public func entries() throws -> [PriceCacheEntry] {
        try context.fetch(
            FetchDescriptor<StoredPriceCacheEntry>(sortBy: [SortDescriptor(\.updatedAt, order: .reverse)])
        ).map { try $0.snapshot() }
    }

    public func entry(key: String) throws -> PriceCacheEntry? {
        var descriptor = FetchDescriptor<StoredPriceCacheEntry>(predicate: #Predicate { $0.key == key })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first.map { try $0.snapshot() }
    }

    public func upsert(_ entry: PriceCacheEntry) throws {
        var descriptor = FetchDescriptor<StoredPriceCacheEntry>(predicate: #Predicate { $0.key == entry.key })
        descriptor.fetchLimit = 1
        if let stored = try context.fetch(descriptor).first {
            stored.title = entry.title
            stored.author = entry.author
            stored.isbn = entry.isbn
            stored.quotesData = try JSONEncoder().encode(entry.quotes)
            stored.updatedAt = entry.updatedAt
            stored.expiresAt = entry.expiresAt
        } else {
            context.insert(try StoredPriceCacheEntry(entry: entry))
        }
        try context.save()
    }
}
