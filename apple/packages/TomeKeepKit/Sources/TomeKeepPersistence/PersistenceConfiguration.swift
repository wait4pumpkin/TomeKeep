import Foundation
import SwiftData
import TomeKeepDomain

@Model
public final class StoredBook {
    @Attribute(.unique) public var id: String
    public var title: String
    public var author: String
    public var isbn: String?
    public var publisher: String?
    public var coverURL: URL?
    public var coverKey: String?
    public var coverFileName: String?
    public var detailURL: URL?
    public var rating: Double?
    public var tags: [String]
    public var addedAt: Date
    public var updatedAt: Date
    public var syncStatusRawValue: String
    public var deletedAt: Date?

    public init(book: Book) {
        id = book.id
        title = book.title
        author = book.author
        isbn = book.isbn
        publisher = book.publisher
        coverURL = book.coverURL
        coverKey = book.coverKey
        coverFileName = book.coverFileName
        detailURL = book.detailURL
        rating = book.rating
        tags = book.tags
        addedAt = book.addedAt
        updatedAt = book.updatedAt
        syncStatusRawValue = book.syncStatus.rawValue
        deletedAt = nil
    }

    public func snapshot() -> Book {
        Book(
            id: id,
            title: title,
            author: author,
            isbn: isbn,
            publisher: publisher,
            coverURL: coverURL,
            coverKey: coverKey,
            coverFileName: coverFileName,
            detailURL: detailURL,
            rating: rating,
            tags: tags,
            addedAt: addedAt,
            updatedAt: updatedAt,
            syncStatus: SyncStatus(rawValue: syncStatusRawValue) ?? .pending
        )
    }
}

@Model
public final class StoredWishlistItem {
    @Attribute(.unique) public var id: String
    public var title: String
    public var author: String
    public var isbn: String?
    public var publisher: String?
    public var coverURL: URL?
    public var coverKey: String?
    public var coverFileName: String?
    public var detailURL: URL?
    public var tags: [String]
    public var priorityRawValue: String
    public var pendingBuy: Bool
    public var addedAt: Date
    public var updatedAt: Date
    public var syncStatusRawValue: String
    public var deletedAt: Date?

    public init(item: WishlistItem) {
        id = item.id
        title = item.title
        author = item.author
        isbn = item.isbn
        publisher = item.publisher
        coverURL = item.coverURL
        coverKey = item.coverKey
        coverFileName = item.coverFileName
        detailURL = item.detailURL
        tags = item.tags
        priorityRawValue = item.priority.rawValue
        pendingBuy = item.pendingBuy
        addedAt = item.addedAt
        updatedAt = item.updatedAt
        syncStatusRawValue = item.syncStatus.rawValue
        deletedAt = nil
    }

    public func snapshot() -> WishlistItem {
        WishlistItem(
            id: id,
            title: title,
            author: author,
            isbn: isbn,
            publisher: publisher,
            coverURL: coverURL,
            coverKey: coverKey,
            coverFileName: coverFileName,
            detailURL: detailURL,
            tags: tags,
            priority: WishlistPriority(rawValue: priorityRawValue) ?? .medium,
            pendingBuy: pendingBuy,
            addedAt: addedAt,
            updatedAt: updatedAt,
            syncStatus: SyncStatus(rawValue: syncStatusRawValue) ?? .pending
        )
    }
}

@Model
public final class StoredUserProfile {
    @Attribute(.unique) public var id: String
    public var name: String
    public var createdAt: Date
    public var language: String?
    public var uiPreferencesData: Data?

    public init(profile: UserProfile) throws {
        id = profile.id
        name = profile.name
        createdAt = profile.createdAt
        language = profile.language
        uiPreferencesData = try JSONEncoder().encode(profile.uiPreferences)
    }

    public func snapshot() -> UserProfile {
        let preferences = uiPreferencesData
            .flatMap { try? JSONDecoder().decode(UIPreferences.self, from: $0) }
            ?? UIPreferences()
        return UserProfile(
            id: id,
            name: name,
            createdAt: createdAt,
            language: language,
            uiPreferences: preferences
        )
    }
}

@Model
public final class StoredReadingState {
    @Attribute(.unique) public var id: String
    public var profileID: String
    public var bookID: String
    public var statusRawValue: String
    public var completedAt: Date?
    public var updatedAt: Date
    public var syncStatusRawValue: String

    public init(state: ReadingState) {
        id = Self.identifier(profileID: state.profileID, bookID: state.bookID)
        profileID = state.profileID
        bookID = state.bookID
        statusRawValue = state.status.rawValue
        completedAt = state.completedAt
        updatedAt = state.updatedAt
        syncStatusRawValue = state.syncStatus.rawValue
    }

    public static func identifier(profileID: String, bookID: String) -> String {
        "\(profileID)\u{1F}\(bookID)"
    }

    public func snapshot() -> ReadingState {
        ReadingState(
            profileID: profileID,
            bookID: bookID,
            status: ReadingStatus(rawValue: statusRawValue) ?? .unread,
            completedAt: completedAt,
            updatedAt: updatedAt,
            syncStatus: SyncStatus(rawValue: syncStatusRawValue) ?? .pending
        )
    }
}

@Model
public final class StoredPriceCacheEntry {
    @Attribute(.unique) public var key: String
    public var title: String
    public var author: String?
    public var isbn: String?
    public var quotesData: Data
    public var updatedAt: Date
    public var expiresAt: Date

    public init(entry: PriceCacheEntry) throws {
        key = entry.key
        title = entry.title
        author = entry.author
        isbn = entry.isbn
        quotesData = try JSONEncoder().encode(entry.quotes)
        updatedAt = entry.updatedAt
        expiresAt = entry.expiresAt
    }

    public func snapshot() throws -> PriceCacheEntry {
        PriceCacheEntry(
            key: key,
            title: title,
            author: author,
            isbn: isbn,
            quotes: try JSONDecoder().decode([PriceQuote].self, from: quotesData),
            updatedAt: updatedAt,
            expiresAt: expiresAt
        )
    }
}

@Model
public final class StoredLibraryState {
    @Attribute(.unique) public var id: String
    public var activeProfileID: String?
    public var bookCursor: String
    public var wishlistCursor: String
    public var readingStateCursor: String
    public var lastSyncAt: Date?
    public var legacySourceHash: String?
    public var lastImportReportURL: URL?

    public init(id: String = "library") {
        self.id = id
        bookCursor = ""
        wishlistCursor = ""
        readingStateCursor = ""
    }
}

public enum PersistenceConfiguration {
    public static let modelTypes: [any PersistentModel.Type] = [
        StoredBook.self,
        StoredWishlistItem.self,
        StoredUserProfile.self,
        StoredReadingState.self,
        StoredPriceCacheEntry.self,
        StoredLibraryState.self,
    ]
    public static let schema = Schema(modelTypes)

    public static func makeContainer(url: URL) throws -> ModelContainer {
        let configuration = ModelConfiguration(
            schema: Schema(versionedSchema: TomeKeepSchemaV1.self),
            url: url
        )
        return try ModelContainer(
            for: Schema(versionedSchema: TomeKeepSchemaV1.self),
            migrationPlan: TomeKeepSchemaMigrationPlan.self,
            configurations: [configuration]
        )
    }
}

public enum TomeKeepSchemaV1: VersionedSchema {
    public static let versionIdentifier = Schema.Version(1, 0, 0)
    public static var models: [any PersistentModel.Type] { PersistenceConfiguration.modelTypes }
}

public enum TomeKeepSchemaMigrationPlan: SchemaMigrationPlan {
    public static var schemas: [any VersionedSchema.Type] { [TomeKeepSchemaV1.self] }
    public static var stages: [MigrationStage] { [] }
}

public enum NativeStorageLocations {
    public static func root(fileManager: FileManager = .default) throws -> URL {
        let applicationSupport = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let root = applicationSupport.appending(path: "TomeKeepNative", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    public static func covers(fileManager: FileManager = .default) throws -> URL {
        let directory = try root(fileManager: fileManager)
            .appending(path: "Covers", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    public static func migrationReports(fileManager: FileManager = .default) throws -> URL {
        let directory = try root(fileManager: fileManager)
            .appending(path: "MigrationReports", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// A platform-neutral inbox used by Finder/Xcode/device tooling to stage a
    /// read-only legacy migration package before TomeKeep starts.
    public static func stagedLegacyImport(fileManager: FileManager = .default) throws -> URL {
        try root(fileManager: fileManager)
            .appending(path: "LegacyImport", directoryHint: .isDirectory)
    }
}

public struct LibraryRecordCounts: Codable, Equatable, Sendable {
    public var books: Int
    public var wishlist: Int
    public var profiles: Int
    public var readingStates: Int
    public var priceCacheEntries: Int

    public init(books: Int, wishlist: Int, profiles: Int, readingStates: Int, priceCacheEntries: Int) {
        self.books = books
        self.wishlist = wishlist
        self.profiles = profiles
        self.readingStates = readingStates
        self.priceCacheEntries = priceCacheEntries
    }
}

@MainActor
public struct LibraryArchiveRepository {
    private let context: ModelContext

    public init(context: ModelContext) {
        self.context = context
    }

    public func importArchive(
        _ archive: LibraryArchive,
        sourceHash: String,
        reportURL: URL?
    ) throws -> LibraryRecordCounts {
        let existingBooks = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredBook>()).map { ($0.id, $0) })
        for book in archive.books {
            if let stored = existingBooks[book.id] {
                guard book.updatedAt >= stored.updatedAt else { continue }
                update(stored, from: book)
            } else {
                context.insert(StoredBook(book: book))
            }
        }

        let existingWishlist = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredWishlistItem>()).map { ($0.id, $0) })
        for item in archive.wishlist {
            if let stored = existingWishlist[item.id] {
                guard item.updatedAt >= stored.updatedAt else { continue }
                try update(stored, from: item)
            } else {
                context.insert(StoredWishlistItem(item: item))
            }
        }

        let existingProfiles = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredUserProfile>()).map { ($0.id, $0) })
        for profile in archive.profiles {
            if let stored = existingProfiles[profile.id] {
                stored.name = profile.name
                stored.createdAt = profile.createdAt
                stored.language = profile.language
                stored.uiPreferencesData = try JSONEncoder().encode(profile.uiPreferences)
            } else {
                context.insert(try StoredUserProfile(profile: profile))
            }
        }

        let existingStates = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredReadingState>()).map { ($0.id, $0) })
        for state in archive.readingStates {
            let id = StoredReadingState.identifier(profileID: state.profileID, bookID: state.bookID)
            if let stored = existingStates[id] {
                guard state.updatedAt >= stored.updatedAt else { continue }
                stored.statusRawValue = state.status.rawValue
                stored.completedAt = state.completedAt
                stored.updatedAt = state.updatedAt
                stored.syncStatusRawValue = state.syncStatus.rawValue
            } else {
                context.insert(StoredReadingState(state: state))
            }
        }

        let existingPrices = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredPriceCacheEntry>()).map { ($0.key, $0) })
        for entry in archive.priceCache {
            if let stored = existingPrices[entry.key] {
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

        let state = try libraryState()
        state.activeProfileID = archive.activeProfileID
        state.bookCursor = archive.syncCursors.books
        state.wishlistCursor = archive.syncCursors.wishlist
        state.readingStateCursor = archive.syncCursors.readingStates
        state.lastSyncAt = archive.lastSyncAt
        state.legacySourceHash = sourceHash
        state.lastImportReportURL = reportURL

        try context.save()
        return try counts()
    }

    public func counts() throws -> LibraryRecordCounts {
        LibraryRecordCounts(
            books: try context.fetchCount(FetchDescriptor<StoredBook>(predicate: #Predicate { $0.deletedAt == nil })),
            wishlist: try context.fetchCount(FetchDescriptor<StoredWishlistItem>(predicate: #Predicate { $0.deletedAt == nil })),
            profiles: try context.fetchCount(FetchDescriptor<StoredUserProfile>()),
            readingStates: try context.fetchCount(FetchDescriptor<StoredReadingState>()),
            priceCacheEntries: try context.fetchCount(FetchDescriptor<StoredPriceCacheEntry>())
        )
    }

    public func recordImportReportURL(_ url: URL) throws {
        let state = try libraryState()
        state.lastImportReportURL = url
        try context.save()
    }

    public func lastImportReportURL() throws -> URL? {
        var descriptor = FetchDescriptor<StoredLibraryState>(predicate: #Predicate { $0.id == "library" })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first?.lastImportReportURL
    }

    private func libraryState() throws -> StoredLibraryState {
        var descriptor = FetchDescriptor<StoredLibraryState>(predicate: #Predicate { $0.id == "library" })
        descriptor.fetchLimit = 1
        if let state = try context.fetch(descriptor).first { return state }
        let state = StoredLibraryState()
        context.insert(state)
        return state
    }

    private func update(_ stored: StoredBook, from book: Book) {
        stored.title = book.title
        stored.author = book.author
        stored.isbn = book.isbn
        stored.publisher = book.publisher
        stored.coverURL = book.coverURL
        stored.coverKey = book.coverKey
        stored.coverFileName = book.coverFileName
        stored.detailURL = book.detailURL
        stored.rating = book.rating
        stored.tags = book.tags
        stored.updatedAt = book.updatedAt
        stored.syncStatusRawValue = book.syncStatus.rawValue
        stored.deletedAt = nil
    }

    private func update(_ stored: StoredWishlistItem, from item: WishlistItem) throws {
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
        stored.syncStatusRawValue = item.syncStatus.rawValue
        stored.deletedAt = nil
    }
}

public enum BookRepositoryError: Error, Equatable {
    case duplicateISBN
    case missingBook
}

@MainActor
public struct BookRepository {
    private let context: ModelContext

    public init(context: ModelContext) {
        self.context = context
    }

    public func books() throws -> [Book] {
        let descriptor = FetchDescriptor<StoredBook>(
            predicate: #Predicate { $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.addedAt, order: .reverse)]
        )
        return try context.fetch(descriptor).map { $0.snapshot() }
    }

    public func add(_ book: Book) throws {
        try ensureISBNIsAvailable(book.isbn, excluding: nil)
        context.insert(StoredBook(book: book))
        try context.save()
    }

    public func update(_ book: Book) throws {
        try ensureISBNIsAvailable(book.isbn, excluding: book.id)
        let id = book.id
        var descriptor = FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        guard let stored = try context.fetch(descriptor).first else {
            throw BookRepositoryError.missingBook
        }

        stored.title = book.title
        stored.author = book.author
        stored.isbn = book.isbn
        stored.publisher = book.publisher
        stored.coverURL = book.coverURL
        stored.coverKey = book.coverKey
        stored.coverFileName = book.coverFileName
        stored.detailURL = book.detailURL
        stored.rating = book.rating
        stored.tags = book.tags
        stored.updatedAt = book.updatedAt
        stored.syncStatusRawValue = SyncStatus.pending.rawValue
        try context.save()
    }

    public func softDelete(id: String, at instant: Date = .now) throws {
        var descriptor = FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        guard let stored = try context.fetch(descriptor).first else {
            throw BookRepositoryError.missingBook
        }
        stored.deletedAt = instant
        stored.updatedAt = instant
        stored.syncStatusRawValue = SyncStatus.pending.rawValue
        try context.save()
    }

    private func ensureISBNIsAvailable(_ isbn: String?, excluding excludedID: String?) throws {
        guard let isbn, !isbn.isEmpty else { return }
        let descriptor = FetchDescriptor<StoredBook>(
            predicate: #Predicate {
                $0.isbn == isbn && $0.deletedAt == nil
            }
        )
        if try context.fetch(descriptor).contains(where: { $0.id != excludedID }) {
            throw BookRepositoryError.duplicateISBN
        }
    }
}
