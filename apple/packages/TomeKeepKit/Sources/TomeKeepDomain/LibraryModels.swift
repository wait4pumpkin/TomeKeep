import Foundation

public enum ReadingStatus: String, Codable, Sendable, CaseIterable {
    case unread
    case reading
    case read
}

public enum WishlistPriority: String, Codable, Sendable, CaseIterable {
    case high
    case medium
    case low
}

public struct UserProfile: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var name: String
    public let createdAt: Date
    public var language: String?
    public var uiPreferences: UIPreferences

    public init(
        id: String,
        name: String,
        createdAt: Date,
        language: String? = nil,
        uiPreferences: UIPreferences = .init()
    ) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.language = language
        self.uiPreferences = uiPreferences
    }
}

public struct UIPreferences: Codable, Hashable, Sendable {
    public var activePage: String?
    public var inventorySortKey: String?
    public var inventorySortDirection: String?
    public var inventoryViewMode: String?
    public var inventoryCompactColumns: Int?
    public var wishlistSortKey: String?
    public var wishlistSortDirection: String?
    public var wishlistViewMode: String?
    public var wishlistCompactColumns: Int?

    public init(
        activePage: String? = nil,
        inventorySortKey: String? = nil,
        inventorySortDirection: String? = nil,
        inventoryViewMode: String? = nil,
        inventoryCompactColumns: Int? = nil,
        wishlistSortKey: String? = nil,
        wishlistSortDirection: String? = nil,
        wishlistViewMode: String? = nil,
        wishlistCompactColumns: Int? = nil
    ) {
        self.activePage = activePage
        self.inventorySortKey = inventorySortKey
        self.inventorySortDirection = inventorySortDirection
        self.inventoryViewMode = inventoryViewMode
        self.inventoryCompactColumns = inventoryCompactColumns
        self.wishlistSortKey = wishlistSortKey
        self.wishlistSortDirection = wishlistSortDirection
        self.wishlistViewMode = wishlistViewMode
        self.wishlistCompactColumns = wishlistCompactColumns
    }
}

public struct ReadingState: Codable, Hashable, Sendable {
    public let profileID: String
    public let bookID: String
    public var status: ReadingStatus
    public var completedAt: Date?
    public var updatedAt: Date
    public var syncStatus: SyncStatus

    public init(
        profileID: String,
        bookID: String,
        status: ReadingStatus,
        completedAt: Date? = nil,
        updatedAt: Date,
        syncStatus: SyncStatus = .pending
    ) {
        self.profileID = profileID
        self.bookID = bookID
        self.status = status
        self.completedAt = completedAt
        self.updatedAt = updatedAt
        self.syncStatus = syncStatus
    }
}

public struct WishlistItem: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var title: String
    public var author: String
    public var isbn: String?
    public var publisher: String?
    public var coverURL: URL?
    public var coverKey: String?
    public var coverFileName: String?
    public var detailURL: URL?
    public var tags: [String]
    public var priority: WishlistPriority
    public var pendingBuy: Bool
    public let addedAt: Date
    public var updatedAt: Date
    public var syncStatus: SyncStatus

    public init(
        id: String,
        title: String,
        author: String,
        isbn: String? = nil,
        publisher: String? = nil,
        coverURL: URL? = nil,
        coverKey: String? = nil,
        coverFileName: String? = nil,
        detailURL: URL? = nil,
        tags: [String] = [],
        priority: WishlistPriority,
        pendingBuy: Bool = false,
        addedAt: Date,
        updatedAt: Date,
        syncStatus: SyncStatus = .pending
    ) {
        self.id = id
        self.title = title
        self.author = author
        self.isbn = isbn
        self.publisher = publisher
        self.coverURL = coverURL
        self.coverKey = coverKey
        self.coverFileName = coverFileName
        self.detailURL = detailURL
        self.tags = tags
        self.priority = priority
        self.pendingBuy = pendingBuy
        self.addedAt = addedAt
        self.updatedAt = updatedAt
        self.syncStatus = syncStatus
    }
}

public enum PriceChannel: String, Codable, Sendable, CaseIterable {
    case jd
    case bookschina
    case dangdang
}

public enum PriceQuoteStatus: String, Codable, Sendable, CaseIterable {
    case ok
    case needsLogin = "needs_login"
    case blocked
    case notFound = "not_found"
    case error
}

public enum PriceQuoteSource: String, Codable, Sendable {
    case manual
    case auto
}

public struct PriceQuote: Codable, Hashable, Sendable {
    public var channel: PriceChannel
    public var currency: String
    public var url: URL
    public var fetchedAt: Date
    public var status: PriceQuoteStatus
    public var priceCNY: Double?
    public var productID: String?
    public var source: PriceQuoteSource?
    public var message: String?

    public init(
        channel: PriceChannel,
        currency: String,
        url: URL,
        fetchedAt: Date,
        status: PriceQuoteStatus,
        priceCNY: Double? = nil,
        productID: String? = nil,
        source: PriceQuoteSource? = nil,
        message: String? = nil
    ) {
        self.channel = channel
        self.currency = currency
        self.url = url
        self.fetchedAt = fetchedAt
        self.status = status
        self.priceCNY = priceCNY
        self.productID = productID
        self.source = source
        self.message = message
    }
}

public struct PriceCacheEntry: Identifiable, Codable, Hashable, Sendable {
    public var id: String { key }
    public let key: String
    public var title: String
    public var author: String?
    public var isbn: String?
    public var quotes: [PriceQuote]
    public var updatedAt: Date
    public var expiresAt: Date

    public init(
        key: String,
        title: String,
        author: String? = nil,
        isbn: String? = nil,
        quotes: [PriceQuote],
        updatedAt: Date,
        expiresAt: Date
    ) {
        self.key = key
        self.title = title
        self.author = author
        self.isbn = isbn
        self.quotes = quotes
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
    }
}

public struct SyncCursors: Codable, Hashable, Sendable {
    public var books: String
    public var wishlist: String
    public var readingStates: String

    public init(books: String = "", wishlist: String = "", readingStates: String = "") {
        self.books = books
        self.wishlist = wishlist
        self.readingStates = readingStates
    }
}

public struct LibraryArchive: Codable, Hashable, Sendable {
    public var books: [Book]
    public var wishlist: [WishlistItem]
    public var profiles: [UserProfile]
    public var readingStates: [ReadingState]
    public var priceCache: [PriceCacheEntry]
    public var activeProfileID: String?
    public var syncCursors: SyncCursors
    public var lastSyncAt: Date?

    public init(
        books: [Book],
        wishlist: [WishlistItem],
        profiles: [UserProfile],
        readingStates: [ReadingState],
        priceCache: [PriceCacheEntry],
        activeProfileID: String?,
        syncCursors: SyncCursors = .init(),
        lastSyncAt: Date? = nil
    ) {
        self.books = books
        self.wishlist = wishlist
        self.profiles = profiles
        self.readingStates = readingStates
        self.priceCache = priceCache
        self.activeProfileID = activeProfileID
        self.syncCursors = syncCursors
        self.lastSyncAt = lastSyncAt
    }
}
