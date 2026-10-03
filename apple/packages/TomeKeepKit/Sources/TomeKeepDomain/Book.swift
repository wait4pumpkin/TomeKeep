import Foundation

public enum SyncStatus: String, Codable, Sendable, CaseIterable {
    case pending
    case synced
}

public struct Book: Identifiable, Codable, Hashable, Sendable {
    /// Opaque identifier preserved byte-for-byte across legacy import and sync.
    public let id: String
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
        rating: Double? = nil,
        tags: [String] = [],
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
        self.rating = rating
        self.tags = tags
        self.addedAt = addedAt
        self.updatedAt = updatedAt
        self.syncStatus = syncStatus
    }
}
