import Foundation
import SwiftData
import TomeKeepDomain
import TomeKeepNetworking
import TomeKeepPersistence

public struct SyncResult: Equatable, Sendable {
    public var pulled: Int
    public var pushed: Int

    public init(pulled: Int, pushed: Int) {
        self.pulled = pulled
        self.pushed = pushed
    }
}

@MainActor
public final class NativeSyncEngine {
    private let client: APIClient
    private let coverSync: CoverSyncService
    private let tokenStore: KeychainTokenStore
    private let uploadsPriceCache: Bool

    public init(
        baseURL: URL,
        tokenStore: KeychainTokenStore = .init(),
        uploadsPriceCache: Bool = true
    ) {
        let client = APIClient(baseURL: baseURL)
        self.client = client
        coverSync = CoverSyncService(client: client)
        self.tokenStore = tokenStore
        self.uploadsPriceCache = uploadsPriceCache
    }

    public func synchronize(context: ModelContext) async throws -> SyncResult {
        guard let token = try tokenStore.load() else {
            throw NativeSyncError.notAuthenticated
        }
        let repository = LocalSyncRepository(context: context)
        let user = try await client.request(AuthUser.self, path: "auth/me", bearerToken: token)
        ProfileAccountContext.currentID = user.id
        let mutationStore = try ProfileMutationStore()
        var profilePushes = try await pushProfileMutations(
            store: mutationStore,
            accountID: user.id,
            token: token
        )
        var remoteProfiles = try await client.request(
            [APIProfile].self,
            path: "profiles?include_deleted=1",
            bearerToken: token
        )
        let remoteIDs = Set(remoteProfiles.map(\.id))
        let bootstrapProfiles = try repository.profiles().filter { !remoteIDs.contains($0.id) }
        if !bootstrapProfiles.isEmpty {
            profilePushes += try await pushProfiles(bootstrapProfiles, token: token)
            remoteProfiles = try await client.request(
                [APIProfile].self,
                path: "profiles?include_deleted=1",
                bearerToken: token
            )
        }
        try repository.mergeProfiles(remoteProfiles.map(\.syncRecord))
        let priceSync: SyncResult
        do {
            priceSync = try await synchronizePriceCache(repository: repository, token: token)
        } catch APIClientError.rejected(statusCode: 404, message: _) {
            // Rolling deployment compatibility: older servers do not expose
            // native price-cache sync yet. Core data sync must still proceed.
            priceSync = SyncResult(pulled: 0, pushed: 0)
        }
        let pulled = try await pull(repository: repository, token: token)
        let pushed = try await push(repository: repository, token: token)
        return SyncResult(
            pulled: pulled + remoteProfiles.count + priceSync.pulled,
            pushed: pushed + profilePushes + priceSync.pushed
        )
    }

    private func pull(repository: LocalSyncRepository, token: String) async throws -> Int {
        let cursors = try repository.cursors()
        let status = try await client.request(SyncStatusResponse.self, path: "sync/status", bearerToken: token)
        var count = 0

        // Pull the inclusive cursor boundary on every explicit sync. D1's
        // timestamps have second precision, so relying only on max > cursor
        // can miss a different row written in the same second. LWW merge makes
        // replaying that small boundary set safe and idempotent.
        count += try await pullBooks(
            repository: repository,
            token: token,
            since: cursors.books,
            finalCursor: status.books
        )
        count += try await pullWishlist(
            repository: repository,
            token: token,
            since: cursors.wishlist,
            finalCursor: status.wishlist
        )
        count += try await pullReadingStates(
            repository: repository,
            token: token,
            since: cursors.readingStates,
            finalCursor: status.readingStates
        )
        await downloadMissingBookCovers(repository: repository, token: token)
        await downloadMissingWishlistCovers(repository: repository, token: token)
        return count
    }

    private func push(repository: LocalSyncRepository, token: String) async throws -> Int {
        var count = 0
        for var record in try repository.pendingBooks() {
            if record.deletedAt != nil {
                do {
                    _ = try await client.data(for: "books/\(record.book.id)", method: "DELETE", bearerToken: token)
                } catch APIClientError.rejected(statusCode: 404, message: _) {
                    // The desired end state is already present remotely.
                }
            } else {
                if record.book.coverKey == nil,
                   let fileName = record.book.coverFileName,
                   localCoverExists(fileName) {
                    let key = try await coverSync.upload(fileName: fileName, bearerToken: token)
                    try repository.setBookCoverKey(id: record.book.id, coverKey: key)
                    record.book.coverKey = key
                }
                let payload = BookPayload(record.book)
                do {
                    _ = try await client.data(
                        for: "books/\(record.book.id)", method: "PUT", bearerToken: token,
                        body: try JSONEncoder.tomeKeep.encode(payload)
                    )
                } catch APIClientError.rejected(statusCode: 404, message: _) {
                    _ = try await client.data(
                        for: "books", method: "POST", bearerToken: token,
                        body: try JSONEncoder.tomeKeep.encode(payload)
                    )
                }
            }
            try repository.markBookSynced(id: record.book.id)
            count += 1
        }

        for var record in try repository.pendingWishlist() {
            if record.deletedAt != nil {
                do {
                    _ = try await client.data(for: "wishlist/\(record.item.id)", method: "DELETE", bearerToken: token)
                } catch APIClientError.rejected(statusCode: 404, message: _) {
                    // The desired end state is already present remotely.
                }
            } else {
                if record.item.coverKey == nil,
                   let fileName = record.item.coverFileName,
                   localCoverExists(fileName) {
                    let key = try await coverSync.upload(fileName: fileName, bearerToken: token)
                    try repository.setWishlistCoverKey(id: record.item.id, coverKey: key)
                    record.item.coverKey = key
                }
                let payload = WishlistPayload(record.item)
                do {
                    _ = try await client.data(
                        for: "wishlist/\(record.item.id)", method: "PUT", bearerToken: token,
                        body: try JSONEncoder.tomeKeep.encode(payload)
                    )
                } catch APIClientError.rejected(statusCode: 404, message: _) {
                    _ = try await client.data(
                        for: "wishlist", method: "POST", bearerToken: token,
                        body: try JSONEncoder.tomeKeep.encode(payload)
                    )
                }
            }
            try repository.markWishlistSynced(id: record.item.id)
            count += 1
        }

        for state in try repository.pendingReadingStates() {
            _ = try await client.data(
                for: "reading-states", method: "PUT", bearerToken: token,
                body: try JSONEncoder.tomeKeep.encode(ReadingStatePayload(state))
            )
            try repository.markReadingStateSynced(profileID: state.profileID, bookID: state.bookID)
            count += 1
        }
        return count
    }

    private func downloadMissingBookCovers(repository: LocalSyncRepository, token: String) async {
        guard let references = try? repository.missingBookCovers() else { return }
        for reference in references {
            guard let fileName = try? await coverSync.download(
                coverKey: reference.coverKey,
                bearerToken: token
            ) else { continue }
            try? repository.setBookCoverFileName(id: reference.recordID, fileName: fileName)
        }
    }

    private func downloadMissingWishlistCovers(repository: LocalSyncRepository, token: String) async {
        guard let references = try? repository.missingWishlistCovers() else { return }
        for reference in references {
            guard let fileName = try? await coverSync.download(
                coverKey: reference.coverKey,
                bearerToken: token
            ) else { continue }
            try? repository.setWishlistCoverFileName(id: reference.recordID, fileName: fileName)
        }
    }

    private func localCoverExists(_ fileName: String) -> Bool {
        guard let directory = try? NativeStorageLocations.covers() else { return false }
        return FileManager.default.fileExists(atPath: directory.appending(path: fileName).path)
    }

    private func pushProfiles(_ profiles: [UserProfile], token: String) async throws -> Int {
        for profile in profiles {
            _ = try await client.data(
                for: "profiles", method: "POST", bearerToken: token,
                body: try JSONEncoder.tomeKeep.encode(ProfilePayload(id: profile.id, name: profile.name))
            )
        }
        return profiles.count
    }

    private func pushProfileMutations(
        store: ProfileMutationStore,
        accountID: String,
        token: String
    ) async throws -> Int {
        var count = 0
        for mutation in try store.pending(accountID: accountID) {
            switch mutation.kind {
            case .upsert:
                guard let name = mutation.name else { continue }
                _ = try await client.data(
                    for: "profiles",
                    method: "POST",
                    bearerToken: token,
                    body: try JSONEncoder.tomeKeep.encode(ProfilePayload(id: mutation.profileID, name: name))
                )
            case .delete:
                do {
                    _ = try await client.data(
                        for: "profiles/\(mutation.profileID)",
                        method: "DELETE",
                        bearerToken: token
                    )
                } catch APIClientError.rejected(statusCode: 404, message: _) {
                    // The desired end state is already present remotely.
                }
            }
            try store.remove(profileID: mutation.profileID, accountID: accountID)
            count += 1
        }
        return count
    }

    private func pullBooks(
        repository: LocalSyncRepository,
        token: String,
        since: String,
        finalCursor: String?
    ) async throws -> Int {
        var pageCursor: APIPagedCursor?
        var total = 0
        repeat {
            let page = try await client.request(
                APIPagedResponse<APIBook>.self,
                path: pagedPath("books", since: since, pageCursor: pageCursor),
                bearerToken: token
            )
            let records = page.items.compactMap(\.syncRecord)
            try repository.mergeBooks(records, cursor: nil)
            total += records.count
            pageCursor = page.nextCursor
        } while pageCursor != nil
        try repository.mergeBooks([], cursor: finalCursor)
        return total
    }

    private func synchronizePriceCache(
        repository: LocalSyncRepository,
        token: String
    ) async throws -> SyncResult {
        var cursor: APIPagedCursor?
        var rows: [APIPriceCacheRow] = []
        repeat {
            let page = try await client.request(
                APIPagedResponse<APIPriceCacheRow>.self,
                path: pagedPath("price-cache", since: "", pageCursor: cursor),
                bearerToken: token
            )
            rows.append(contentsOf: page.items)
            cursor = page.nextCursor
        } while cursor != nil

        var pushed = 0
        if uploadsPriceCache {
            let remote = Dictionary(uniqueKeysWithValues: rows.map {
                ("\($0.cacheKey)\u{1F}\($0.channel)", $0.updatedDate)
            })
            for entry in try repository.priceCacheEntries() {
                for quote in entry.quotes {
                    let key = "\(entry.key)\u{1F}\(quote.channel.rawValue)"
                    guard remote[key].map({ entry.updatedAt > $0 }) ?? true else { continue }
                    _ = try await client.data(
                        for: "price-cache",
                        method: "PUT",
                        bearerToken: token,
                        body: try JSONEncoder.tomeKeep.encode(PriceCachePayload(entry: entry, quote: quote))
                    )
                    pushed += 1
                }
            }
        }

        let entries = Dictionary(grouping: rows, by: \.cacheKey).compactMap { key, grouped -> PriceCacheEntry? in
            let quotes = grouped.compactMap(\.quote)
            guard let newest = grouped.max(by: { $0.updatedDate < $1.updatedDate }), !quotes.isEmpty else {
                return nil
            }
            return PriceCacheEntry(
                key: key,
                title: newest.title,
                author: newest.author,
                isbn: newest.bookIsbn.nilIfEmpty,
                quotes: quotes,
                updatedAt: newest.updatedDate,
                expiresAt: newest.expiresDate
            )
        }
        try repository.mergePriceCache(entries)
        return SyncResult(pulled: rows.count, pushed: pushed)
    }

    private func pullWishlist(
        repository: LocalSyncRepository,
        token: String,
        since: String,
        finalCursor: String?
    ) async throws -> Int {
        var pageCursor: APIPagedCursor?
        var total = 0
        repeat {
            let page = try await client.request(
                APIPagedResponse<APIWishlistItem>.self,
                path: pagedPath("wishlist", since: since, pageCursor: pageCursor),
                bearerToken: token
            )
            let records = page.items.compactMap(\.syncRecord)
            try repository.mergeWishlist(records, cursor: nil)
            total += records.count
            pageCursor = page.nextCursor
        } while pageCursor != nil
        try repository.mergeWishlist([], cursor: finalCursor)
        return total
    }

    private func pullReadingStates(
        repository: LocalSyncRepository,
        token: String,
        since: String,
        finalCursor: String?
    ) async throws -> Int {
        let profileIDs = Set(try repository.profiles().map(\.id))
        var pageCursor: APIPagedCursor?
        var total = 0
        repeat {
            let page = try await client.request(
                APIPagedResponse<APIReadingState>.self,
                path: pagedPath("reading-states", since: since, pageCursor: pageCursor),
                bearerToken: token
            )
            let states = page.items.compactMap(\.readingState).filter { profileIDs.contains($0.profileID) }
            try repository.mergeReadingStates(states, cursor: nil)
            total += states.count
            pageCursor = page.nextCursor
        } while pageCursor != nil
        try repository.mergeReadingStates([], cursor: finalCursor)
        return total
    }

    private func pagedPath(_ path: String, since: String, pageCursor: APIPagedCursor?) -> String {
        var values = ["page_size=250"]
        if !since.isEmpty { values.append("since=\(queryValue(since))") }
        if let pageCursor {
            values.append("page_updated_at=\(queryValue(pageCursor.updatedAt))")
            values.append("page_after=\(queryValue(pageCursor.after))")
        }
        return "\(path)?\(values.joined(separator: "&"))"
    }

    private func queryValue(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

public enum NativeSyncError: LocalizedError, Equatable, Sendable {
    case notAuthenticated
    public var errorDescription: String? { "请先登录同步账户。" }
}

private struct SyncStatusResponse: Decodable, Sendable {
    var books: String?
    var wishlist: String?
    var readingStates: String?
}

private struct APIPagedResponse<Item: Decodable & Sendable>: Decodable, Sendable {
    var items: [Item]
    var nextCursor: APIPagedCursor?

    private enum CodingKeys: String, CodingKey { case items, nextCursor }

    init(from decoder: Decoder) throws {
        if let legacy = try? decoder.singleValueContainer().decode([Item].self) {
            items = legacy
            nextCursor = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decode([Item].self, forKey: .items)
        nextCursor = try container.decodeIfPresent(APIPagedCursor.self, forKey: .nextCursor)
    }
}

private struct APIPagedCursor: Decodable, Sendable {
    var updatedAt: String
    var after: String
}

private struct APIBook: Decodable, Sendable {
    var id: String
    var title: String
    var author: String
    var isbn: String?
    var publisher: String?
    var coverKey: String?
    var detailUrl: URL?
    var tags: [String]
    var addedAt: String
    var updatedAt: String
    var deletedAt: String?

    var syncRecord: BookSyncRecord? {
        guard let addedAt = Self.date(addedAt), let updatedAt = Self.date(updatedAt) else { return nil }
        return BookSyncRecord(
            book: Book(
                id: id, title: title, author: author, isbn: isbn, publisher: publisher,
                coverKey: coverKey, detailURL: detailUrl, tags: tags,
                addedAt: addedAt, updatedAt: updatedAt, syncStatus: .synced
            ),
            deletedAt: deletedAt.flatMap(Self.date)
        )
    }

    static func date(_ value: String) -> Date? {
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value) { return date }
        return try? Date.ISO8601FormatStyle().parse(value)
    }
}

private struct APIWishlistItem: Decodable, Sendable {
    var id: String
    var title: String
    var author: String
    var isbn: String?
    var publisher: String?
    var coverKey: String?
    var detailUrl: URL?
    var tags: [String]
    var priority: String
    var pendingBuy: Bool
    var addedAt: String
    var updatedAt: String
    var deletedAt: String?

    var syncRecord: WishlistSyncRecord? {
        guard let addedAt = APIBook.date(addedAt), let updatedAt = APIBook.date(updatedAt) else { return nil }
        return WishlistSyncRecord(
            item: WishlistItem(
                id: id, title: title, author: author, isbn: isbn, publisher: publisher,
                coverKey: coverKey, detailURL: detailUrl, tags: tags,
                priority: WishlistPriority(rawValue: priority) ?? .medium,
                pendingBuy: pendingBuy, addedAt: addedAt, updatedAt: updatedAt, syncStatus: .synced
            ),
            deletedAt: deletedAt.flatMap(APIBook.date)
        )
    }
}

private struct APIReadingState: Decodable, Sendable {
    var bookId: String
    var profileId: String?
    var status: String
    var completedAt: String?
    var updatedAt: String

    var readingState: ReadingState? {
        guard let profileId, let updatedAt = APIBook.date(updatedAt) else { return nil }
        return ReadingState(
            profileID: profileId, bookID: bookId,
            status: ReadingStatus(rawValue: status) ?? .unread,
            completedAt: completedAt.flatMap(APIBook.date), updatedAt: updatedAt, syncStatus: .synced
        )
    }
}

private struct APIProfile: Decodable, Sendable {
    var id: String
    var name: String
    var createdAt: String
    var deletedAt: String?

    var profile: UserProfile {
        UserProfile(
            id: id,
            name: name,
            createdAt: APIBook.date(createdAt) ?? .distantPast
        )
    }

    var syncRecord: ProfileSyncRecord {
        ProfileSyncRecord(profile: profile, deletedAt: deletedAt.flatMap(APIBook.date))
    }
}

private struct APIPriceCacheRow: Decodable, Sendable {
    var cacheKey: String
    var title: String
    var author: String?
    var bookIsbn: String
    var channel: String
    var status: String
    var priceCny: Double?
    var url: URL
    var productId: String?
    var source: String?
    var message: String?
    var fetchedAt: String
    var expiresAt: String
    var updatedAt: String

    var updatedDate: Date { APIBook.date(updatedAt) ?? .distantPast }
    var expiresDate: Date { APIBook.date(expiresAt) ?? updatedDate }

    var quote: PriceQuote? {
        guard let fetched = APIBook.date(fetchedAt),
              let channel = PriceChannel(rawValue: channel),
              let status = PriceQuoteStatus(rawValue: status)
        else { return nil }
        return PriceQuote(
            channel: channel,
            currency: "CNY",
            url: url,
            fetchedAt: fetched,
            status: status,
            priceCNY: priceCny,
            productID: productId,
            source: source.flatMap(PriceQuoteSource.init(rawValue:)),
            message: message
        )
    }
}

private struct BookPayload: Encodable {
    var id: String
    var title: String
    var author: String
    var isbn: String?
    var publisher: String?
    var coverKey: String?
    var detailUrl: URL?
    var tags: [String]
    var addedAt: String

    init(_ book: Book) {
        id = book.id; title = book.title; author = book.author; isbn = book.isbn
        publisher = book.publisher; coverKey = book.coverKey; detailUrl = book.detailURL
        tags = book.tags; addedAt = book.addedAt.ISO8601Format()
    }
}

private struct WishlistPayload: Encodable {
    var id: String
    var title: String
    var author: String
    var isbn: String?
    var publisher: String?
    var coverKey: String?
    var detailUrl: URL?
    var tags: [String]
    var priority: String
    var pendingBuy: Bool
    var addedAt: String

    init(_ item: WishlistItem) {
        id = item.id; title = item.title; author = item.author; isbn = item.isbn
        publisher = item.publisher; coverKey = item.coverKey; detailUrl = item.detailURL
        tags = item.tags; priority = item.priority.rawValue; pendingBuy = item.pendingBuy
        addedAt = item.addedAt.ISO8601Format()
    }
}

private struct ReadingStatePayload: Encodable {
    var bookId: String
    var profileId: String
    var status: String
    var completedAt: String?

    init(_ state: ReadingState) {
        bookId = state.bookID; profileId = state.profileID; status = state.status.rawValue
        completedAt = state.completedAt?.ISO8601Format()
    }
}

private struct ProfilePayload: Encodable { var id: String; var name: String }

private struct PriceCachePayload: Encodable {
    var cacheKey: String
    var title: String
    var author: String?
    var bookIsbn: String?
    var channel: String
    var status: String
    var priceCny: Double?
    var url: URL
    var productId: String?
    var source: String?
    var message: String?
    var fetchedAt: String
    var expiresAt: String
    var updatedAt: String

    init(entry: PriceCacheEntry, quote: PriceQuote) {
        cacheKey = entry.key
        title = entry.title
        author = entry.author
        bookIsbn = entry.isbn
        channel = quote.channel.rawValue
        status = quote.status.rawValue
        priceCny = quote.priceCNY
        url = quote.url
        productId = quote.productID
        source = quote.source?.rawValue
        message = quote.message
        fetchedAt = quote.fetchedAt.ISO8601Format()
        expiresAt = entry.expiresAt.ISO8601Format()
        updatedAt = entry.updatedAt.ISO8601Format()
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
