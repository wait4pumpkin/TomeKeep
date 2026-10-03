import CryptoKit
import Foundation
import TomeKeepDomain

public enum LegacyImportError: Error, Equatable, LocalizedError {
    case databaseNotFound
    case invalidRoot
    case invalidJSON(String)
    case duplicateIdentifier(kind: String, id: String)
    case missingReference(kind: String, id: String)
    case unsupportedValue(field: String, value: String)

    public var errorDescription: String? {
        switch self {
        case .databaseNotFound:
            "所选目录中没有找到 db.json。"
        case .invalidRoot:
            "旧数据必须是一个 TomeKeep 数据目录或 db.json 文件。"
        case let .invalidJSON(message):
            "旧数据库格式无效：\(message)"
        case let .duplicateIdentifier(kind, id):
            "\(kind) 中存在重复 ID：\(id)"
        case let .missingReference(kind, id):
            "\(kind) 引用了不存在的记录：\(id)"
        case let .unsupportedValue(field, value):
            "字段 \(field) 包含不支持的值：\(value)"
        }
    }
}

public struct LegacyArchiveCounts: Codable, Equatable, Sendable {
    public var books: Int
    public var wishlist: Int
    public var profiles: Int
    public var readingStates: Int
    public var priceCacheEntries: Int
    public var covers: Int

    public init(
        books: Int,
        wishlist: Int,
        profiles: Int,
        readingStates: Int,
        priceCacheEntries: Int,
        covers: Int
    ) {
        self.books = books
        self.wishlist = wishlist
        self.profiles = profiles
        self.readingStates = readingStates
        self.priceCacheEntries = priceCacheEntries
        self.covers = covers
    }
}

public struct LegacyRecordDigest: Codable, Equatable, Sendable {
    public var kind: String
    public var id: String
    public var sha256: String
}

public struct LegacyCoverDigest: Codable, Equatable, Sendable {
    public var recordID: String
    public var sourceFileName: String
    public var destinationFileName: String
    public var byteCount: Int64
    public var sha256: String
}

public struct LegacyImportPreparation: Sendable {
    public var archive: LibraryArchive
    public var sourceDatabaseURL: URL
    public var sourceDatabaseSHA256: String
    public var sourceDatabaseByteCount: Int64
    public var sourceCounts: LegacyArchiveCounts
    public var normalizedCounts: LegacyArchiveCounts
    public var recordDigests: [LegacyRecordDigest]
    public var coverDigests: [LegacyCoverDigest]
    public var warnings: [String]
    public var startedAt: Date
}

public struct LegacyImportReport: Codable, Equatable, Sendable {
    public var formatVersion: Int
    public var sourceDatabasePath: String
    public var sourceDatabaseSHA256: String
    public var sourceDatabaseByteCount: Int64
    public var sourceCounts: LegacyArchiveCounts
    public var normalizedCounts: LegacyArchiveCounts
    public var destinationCounts: LegacyArchiveCounts
    public var recordDigests: [LegacyRecordDigest]
    public var coverDigests: [LegacyCoverDigest]
    public var warnings: [String]
    public var startedAt: Date
    public var completedAt: Date
}

public actor LegacyImportService {
    public init() {}

    public func prepare(sourceURL: URL, destinationCoversURL: URL) throws -> LegacyImportPreparation {
        let startedAt = Date.now
        let databaseURL = try databaseURL(from: sourceURL)
        let rootURL = databaseURL.deletingLastPathComponent()
        let data = try Data(contentsOf: databaseURL, options: .mappedIfSafe)
        let databaseHash = SHA256.hash(data: data).hexString
        let byteCount = Int64(data.count)

        let rootObject: Any
        do {
            rootObject = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw LegacyImportError.invalidJSON(error.localizedDescription)
        }
        guard let rootDictionary = rootObject as? [String: Any] else {
            throw LegacyImportError.invalidJSON("顶层值不是对象")
        }

        let decoder = JSONDecoder()
        let legacy: LegacyDatabase
        do {
            legacy = try decoder.decode(LegacyDatabase.self, from: data)
        } catch {
            throw LegacyImportError.invalidJSON(error.localizedDescription)
        }

        var warnings = unknownFieldWarnings(root: rootDictionary)
        let archive = try makeArchive(from: legacy, warnings: &warnings)
        try validate(archive, warnings: &warnings)

        let coverResult = try copyCovers(
            recordIDs: Set(archive.books.map(\.id) + archive.wishlist.map(\.id)),
            sourceDirectory: rootURL.appending(path: "covers", directoryHint: .isDirectory),
            destinationDirectory: destinationCoversURL
        )
        warnings.append(contentsOf: coverResult.warnings)

        let archiveWithCovers = applyingCoverFiles(coverResult.fileNamesByRecordID, to: archive)
        let recordDigests = try makeRecordDigests(archiveWithCovers)
        let normalizedCounts = LegacyArchiveCounts(
            books: archiveWithCovers.books.count,
            wishlist: archiveWithCovers.wishlist.count,
            profiles: archiveWithCovers.profiles.count,
            readingStates: archiveWithCovers.readingStates.count,
            priceCacheEntries: archiveWithCovers.priceCache.count,
            covers: coverResult.digests.count
        )
        let sourceCounts = LegacyArchiveCounts(
            books: legacy.books.count,
            wishlist: legacy.wishlist.count,
            profiles: legacy.users.count,
            readingStates: legacy.readingStates.count,
            priceCacheEntries: legacy.priceCache.count,
            covers: coverResult.sourceFileCount
        )

        return LegacyImportPreparation(
            archive: archiveWithCovers,
            sourceDatabaseURL: databaseURL,
            sourceDatabaseSHA256: databaseHash,
            sourceDatabaseByteCount: byteCount,
            sourceCounts: sourceCounts,
            normalizedCounts: normalizedCounts,
            recordDigests: recordDigests,
            coverDigests: coverResult.digests,
            warnings: warnings,
            startedAt: startedAt
        )
    }

    public func writeReport(
        preparation: LegacyImportPreparation,
        destinationCounts: LegacyArchiveCounts,
        reportsDirectory: URL
    ) throws -> URL {
        try FileManager.default.createDirectory(
            at: reportsDirectory,
            withIntermediateDirectories: true
        )
        let report = LegacyImportReport(
            formatVersion: 1,
            sourceDatabasePath: preparation.sourceDatabaseURL.path,
            sourceDatabaseSHA256: preparation.sourceDatabaseSHA256,
            sourceDatabaseByteCount: preparation.sourceDatabaseByteCount,
            sourceCounts: preparation.sourceCounts,
            normalizedCounts: preparation.normalizedCounts,
            destinationCounts: destinationCounts,
            recordDigests: preparation.recordDigests,
            coverDigests: preparation.coverDigests,
            warnings: preparation.warnings,
            startedAt: preparation.startedAt,
            completedAt: .now
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        let timestampFormatter = DateFormatter()
        timestampFormatter.locale = Locale(identifier: "en_US_POSIX")
        timestampFormatter.dateFormat = "yyyyMMdd-HHmmss"
        let reportURL = reportsDirectory.appending(
            path: "legacy-import-\(timestampFormatter.string(from: report.completedAt)).json"
        )
        try encoder.encode(report).write(to: reportURL, options: .atomic)
        return reportURL
    }

    private func databaseURL(from sourceURL: URL) throws -> URL {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: sourceURL.path, isDirectory: &isDirectory) else {
            throw LegacyImportError.invalidRoot
        }
        let candidate = isDirectory.boolValue
            ? sourceURL.appending(path: "db.json")
            : sourceURL
        guard candidate.lastPathComponent == "db.json" else {
            throw LegacyImportError.invalidRoot
        }
        guard FileManager.default.fileExists(atPath: candidate.path) else {
            throw LegacyImportError.databaseNotFound
        }
        return candidate
    }

    private func makeArchive(from legacy: LegacyDatabase, warnings: inout [String]) throws -> LibraryArchive {
        let lastSyncAt = Self.parseDate(legacy.lastSyncAt)
        let books = try legacy.books.map { record in
            let addedAt = try Self.requiredDate(record.addedAt, field: "books.addedAt")
            let updatedAt = Self.parseDate(record.updatedAt) ?? addedAt
            return Book(
                id: record.id,
                title: record.title,
                author: record.author,
                isbn: record.isbn ?? record.isbn13,
                publisher: record.publisher,
                coverURL: record.coverUrl.flatMap(URL.init(string:)),
                coverKey: record.coverKey,
                detailURL: (record.detailUrl ?? record.doubanUrl).flatMap(URL.init(string:)),
                rating: record.rating,
                tags: record.tags ?? [],
                addedAt: addedAt,
                updatedAt: updatedAt,
                syncStatus: Self.syncStatus(record.syncStatus)
            )
        }

        let wishlist = try legacy.wishlist.map { record in
            let addedAt = try Self.requiredDate(record.addedAt, field: "wishlist.addedAt")
            let updatedAt = Self.parseDate(record.updatedAt) ?? addedAt
            guard let priority = WishlistPriority(rawValue: record.priority ?? "medium") else {
                throw LegacyImportError.unsupportedValue(field: "wishlist.priority", value: record.priority ?? "")
            }
            return WishlistItem(
                id: record.id,
                title: record.title,
                author: record.author,
                isbn: record.isbn,
                publisher: record.publisher,
                coverURL: record.coverUrl.flatMap(URL.init(string:)),
                coverKey: record.coverKey,
                detailURL: record.detailUrl.flatMap(URL.init(string:)),
                tags: record.tags ?? [],
                priority: priority,
                pendingBuy: record.pendingBuy ?? false,
                addedAt: addedAt,
                updatedAt: updatedAt,
                syncStatus: Self.syncStatus(record.syncStatus)
            )
        }

        let profiles = try legacy.users.map { record in
            UserProfile(
                id: record.id,
                name: record.name,
                createdAt: try Self.requiredDate(record.createdAt, field: "users.createdAt"),
                language: record.language,
                uiPreferences: record.uiPrefs?.domainValue ?? .init()
            )
        }

        let decodedReadingStates = try legacy.readingStates.map { record in
            guard let status = ReadingStatus(rawValue: record.status) else {
                throw LegacyImportError.unsupportedValue(field: "readingStates.status", value: record.status)
            }
            let completedAt = Self.parseDate(record.completedAt)
            let updatedAt = Self.parseDate(record.updatedAt) ?? completedAt ?? lastSyncAt ?? .distantPast
            if record.updatedAt == nil {
                warnings.append("readingStates 中 \(record.userId)/\(record.bookId) 缺少 updatedAt，已使用可用的最近时间。")
            }
            return ReadingState(
                profileID: record.userId,
                bookID: record.bookId,
                status: status,
                completedAt: completedAt,
                updatedAt: updatedAt,
                syncStatus: Self.syncStatus(record.syncStatus)
            )
        }
        var readingStatesByID: [String: ReadingState] = [:]
        for state in decodedReadingStates {
            let id = "\(state.profileID)\u{1F}\(state.bookID)"
            if let existing = readingStatesByID[id] {
                if existing == state {
                    warnings.append("移除一条完全重复的阅读状态 \(state.profileID)/\(state.bookID)。")
                } else {
                    warnings.append("阅读状态 \(state.profileID)/\(state.bookID) 存在冲突，已保留更新时间较新的记录。")
                    if state.updatedAt >= existing.updatedAt {
                        readingStatesByID[id] = state
                    }
                }
            } else {
                readingStatesByID[id] = state
            }
        }
        let readingStates = readingStatesByID.values.sorted {
            ($0.profileID, $0.bookID) < ($1.profileID, $1.bookID)
        }

        let prices = try legacy.priceCache.sorted { $0.key < $1.key }.map { mapKey, record in
            let resolvedISBN = record.query?.isbn ?? record.isbn
            let fallbackBook = books.first { $0.isbn == resolvedISBN }
            let fallbackWishlist = wishlist.first { $0.isbn == resolvedISBN }
            if record.query == nil {
                warnings.append("价格缓存 \(mapKey) 使用旧格式，查询标题已从对应书籍记录恢复。")
            }
            return PriceCacheEntry(
                key: record.key ?? mapKey,
                title: record.query?.title ?? fallbackBook?.title ?? fallbackWishlist?.title ?? "",
                author: record.query?.author ?? fallbackBook?.author ?? fallbackWishlist?.author,
                isbn: resolvedISBN,
                quotes: try record.quotes.map { quote in
                    guard let channel = PriceChannel(rawValue: quote.channel) else {
                        throw LegacyImportError.unsupportedValue(field: "priceCache.quotes.channel", value: quote.channel)
                    }
                    guard let status = PriceQuoteStatus(rawValue: quote.status) else {
                        throw LegacyImportError.unsupportedValue(field: "priceCache.quotes.status", value: quote.status)
                    }
                    guard let url = URL(string: quote.url) else {
                        throw LegacyImportError.unsupportedValue(field: "priceCache.quotes.url", value: quote.url)
                    }
                    return PriceQuote(
                        channel: channel,
                        currency: quote.currency,
                        url: url,
                        fetchedAt: try Self.requiredDate(quote.fetchedAt, field: "priceCache.quotes.fetchedAt"),
                        status: status,
                        priceCNY: quote.priceCny,
                        productID: quote.productId,
                        source: quote.source.flatMap(PriceQuoteSource.init(rawValue:)),
                        message: quote.message
                    )
                },
                updatedAt: try Self.requiredDate(record.updatedAt, field: "priceCache.updatedAt"),
                expiresAt: try Self.requiredDate(record.expiresAt, field: "priceCache.expiresAt")
            )
        }

        return LibraryArchive(
            books: books,
            wishlist: wishlist,
            profiles: profiles,
            readingStates: readingStates,
            priceCache: prices,
            activeProfileID: legacy.activeUserId,
            syncCursors: legacy.syncCursors?.domainValue ?? .init(),
            lastSyncAt: lastSyncAt
        )
    }

    private func validate(_ archive: LibraryArchive, warnings: inout [String]) throws {
        try ensureUnique(archive.books.map(\.id), kind: "books")
        try ensureUnique(archive.wishlist.map(\.id), kind: "wishlist")
        try ensureUnique(archive.profiles.map(\.id), kind: "users")
        let bookIDs = Set(archive.books.map(\.id))
        let profileIDs = Set(archive.profiles.map(\.id))
        for state in archive.readingStates {
            if !bookIDs.contains(state.bookID) {
                warnings.append("阅读状态引用了不存在的书籍 \(state.bookID)；为避免数据丢失仍会保留该状态。")
            }
            if !profileIDs.contains(state.profileID) {
                warnings.append("阅读状态引用了不存在的档案 \(state.profileID)；为避免数据丢失仍会保留该状态。")
            }
        }
        if let active = archive.activeProfileID, !profileIDs.contains(active) {
            warnings.append("活动档案 \(active) 不存在；导入后需要重新选择档案。")
        }
    }

    private func ensureUnique(_ ids: [String], kind: String) throws {
        var seen = Set<String>()
        for id in ids where !seen.insert(id).inserted {
            throw LegacyImportError.duplicateIdentifier(kind: kind, id: id)
        }
    }

    private func applyingCoverFiles(_ names: [String: String], to archive: LibraryArchive) -> LibraryArchive {
        var result = archive
        for index in result.books.indices {
            result.books[index].coverFileName = names[result.books[index].id]
        }
        for index in result.wishlist.indices {
            result.wishlist[index].coverFileName = names[result.wishlist[index].id]
        }
        return result
    }

    private func copyCovers(
        recordIDs: Set<String>,
        sourceDirectory: URL,
        destinationDirectory: URL
    ) throws -> (fileNamesByRecordID: [String: String], digests: [LegacyCoverDigest], warnings: [String], sourceFileCount: Int) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: sourceDirectory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return ([:], [], ["旧数据目录没有 covers 文件夹；书籍记录仍会导入。"], 0)
        }
        try FileManager.default.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)

        let allowedExtensions = Set(["jpg", "jpeg", "png", "webp", "gif"])
        let sourceFiles = try FileManager.default.contentsOfDirectory(
            at: sourceDirectory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        )
        var filesByID: [String: URL] = [:]
        for file in sourceFiles {
            let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            let ext = file.pathExtension.lowercased()
            guard allowedExtensions.contains(ext) else { continue }
            filesByID[file.deletingPathExtension().lastPathComponent] = file
        }

        var names: [String: String] = [:]
        var digests: [LegacyCoverDigest] = []
        var warnings: [String] = []
        for id in recordIDs.sorted() {
            guard let source = filesByID[id] else {
                warnings.append("记录 \(id) 没有可迁移的本地封面。")
                continue
            }
            let destinationName = "legacy-\(Self.hashString(id).prefix(24)).\(source.pathExtension.lowercased())"
            let destination = destinationDirectory.appending(path: destinationName)
            let sourceHash = try Self.hashFile(source)
            if FileManager.default.fileExists(atPath: destination.path) {
                let destinationHash = try Self.hashFile(destination)
                if destinationHash != sourceHash {
                    try FileManager.default.removeItem(at: destination)
                    try FileManager.default.copyItem(at: source, to: destination)
                }
            } else {
                try FileManager.default.copyItem(at: source, to: destination)
            }
            let finalHash = try Self.hashFile(destination)
            guard finalHash == sourceHash else {
                throw LegacyImportError.invalidJSON("封面复制校验失败：\(source.lastPathComponent)")
            }
            let byteCount = Int64(try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
            names[id] = destinationName
            digests.append(
                LegacyCoverDigest(
                    recordID: id,
                    sourceFileName: source.lastPathComponent,
                    destinationFileName: destinationName,
                    byteCount: byteCount,
                    sha256: finalHash
                )
            )
        }
        let orphanCount = Set(filesByID.keys).subtracting(recordIDs).count
        if orphanCount > 0 {
            warnings.append("发现 \(orphanCount) 个没有对应记录的旧封面，未导入。")
        }
        return (names, digests, warnings, filesByID.count)
    }

    private func makeRecordDigests(_ archive: LibraryArchive) throws -> [LegacyRecordDigest] {
        var result: [LegacyRecordDigest] = []
        result += try digests(kind: "book", values: archive.books.map { ($0.id, $0) })
        result += try digests(kind: "wishlist", values: archive.wishlist.map { ($0.id, $0) })
        result += try digests(kind: "profile", values: archive.profiles.map { ($0.id, $0) })
        result += try digests(
            kind: "readingState",
            values: archive.readingStates.map { ("\($0.profileID)\u{1F}\($0.bookID)", $0) }
        )
        result += try digests(kind: "priceCache", values: archive.priceCache.map { ($0.key, $0) })
        return result
    }

    private func digests<Value: Encodable>(kind: String, values: [(String, Value)]) throws -> [LegacyRecordDigest] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        return try values.map { id, value in
            LegacyRecordDigest(kind: kind, id: id, sha256: SHA256.hash(data: try encoder.encode(value)).hexString)
        }
    }

    private func unknownFieldWarnings(root: [String: Any]) -> [String] {
        let known = Set(["books", "wishlist", "priceCache", "users", "readingStates", "activeUserId", "syncCursors", "lastSyncAt"])
        return Set(root.keys).subtracting(known).sorted().map { "忽略未知顶层字段：\($0)" }
    }

    private static func requiredDate(_ string: String, field: String) throws -> Date {
        guard let date = parseDate(string) else {
            throw LegacyImportError.unsupportedValue(field: field, value: string)
        }
        return date
    }

    private static func parseDate(_ string: String?) -> Date? {
        guard let string else { return nil }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractionalFormatter.date(from: string) { return date }
        return ISO8601DateFormatter().date(from: string)
    }

    private static func syncStatus(_ rawValue: String?) -> SyncStatus {
        SyncStatus(rawValue: rawValue ?? "pending") ?? .pending
    }

    private static func hashString(_ string: String) -> String {
        SHA256.hash(data: Data(string.utf8)).hexString
    }

    private static func hashFile(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            hasher.update(data: data)
        }
        return hasher.finalize().hexString
    }

}

private extension Digest {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}

private struct LegacyDatabase: Decodable {
    var books: [LegacyBook] = []
    var wishlist: [LegacyWishlistItem] = []
    var priceCache: [String: LegacyPriceCacheEntry] = [:]
    var users: [LegacyUserProfile] = []
    var readingStates: [LegacyReadingState] = []
    var activeUserId: String?
    var syncCursors: LegacySyncCursors?
    var lastSyncAt: String?
}

private struct LegacyBook: Decodable {
    var id: String
    var title: String
    var author: String
    var isbn: String?
    var isbn13: String?
    var publisher: String?
    var status: String?
    var rating: Double?
    var coverUrl: String?
    var coverKey: String?
    var tags: [String]?
    var detailUrl: String?
    var doubanUrl: String?
    var addedAt: String
    var updatedAt: String?
    var syncStatus: String?
}

private struct LegacyWishlistItem: Decodable {
    var id: String
    var title: String
    var author: String
    var isbn: String?
    var publisher: String?
    var coverUrl: String?
    var coverKey: String?
    var detailUrl: String?
    var tags: [String]?
    var priority: String?
    var pendingBuy: Bool?
    var addedAt: String
    var updatedAt: String?
    var syncStatus: String?
}

private struct LegacyUserProfile: Decodable {
    var id: String
    var name: String
    var createdAt: String
    var language: String?
    var uiPrefs: LegacyUIPreferences?
}

private struct LegacyUIPreferences: Decodable {
    var activePage: String?
    var inventorySortKey: String?
    var inventorySortDir: String?
    var inventoryViewMode: String?
    var inventoryCompactCols: Int?
    var wishlistSortKey: String?
    var wishlistSortDir: String?
    var wishlistViewMode: String?
    var wishlistCompactCols: Int?

    var domainValue: UIPreferences {
        UIPreferences(
            activePage: activePage,
            inventorySortKey: inventorySortKey,
            inventorySortDirection: inventorySortDir,
            inventoryViewMode: inventoryViewMode,
            inventoryCompactColumns: inventoryCompactCols,
            wishlistSortKey: wishlistSortKey,
            wishlistSortDirection: wishlistSortDir,
            wishlistViewMode: wishlistViewMode,
            wishlistCompactColumns: wishlistCompactCols
        )
    }
}

private struct LegacyReadingState: Decodable {
    var userId: String
    var bookId: String
    var status: String
    var completedAt: String?
    var updatedAt: String?
    var syncStatus: String?
}

private struct LegacySyncCursors: Decodable {
    var books: String
    var wishlist: String
    var readingStates: String

    var domainValue: SyncCursors {
        SyncCursors(books: books, wishlist: wishlist, readingStates: readingStates)
    }
}

private struct LegacyPriceCacheEntry: Decodable {
    var key: String?
    var isbn: String?
    var query: LegacyPriceQuery?
    var quotes: [LegacyPriceQuote]
    var updatedAt: String
    var expiresAt: String
}

private struct LegacyPriceQuery: Decodable {
    var title: String
    var author: String?
    var isbn: String?
}

private struct LegacyPriceQuote: Decodable {
    var channel: String
    var currency: String
    var url: String
    var fetchedAt: String
    var status: String
    var priceCny: Double?
    var productId: String?
    var source: String?
    var message: String?
}
