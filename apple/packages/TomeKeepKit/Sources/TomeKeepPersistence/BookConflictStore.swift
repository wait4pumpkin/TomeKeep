import CryptoKit
import Foundation
import TomeKeepDomain

public struct BookIdentityConflict: Codable, Identifiable, Equatable, Sendable {
    public var id: String { local.id }
    public let local: Book
    public var canonical: Book
    public let localReading: [ReadingState]
    public var canonicalReading: [ReadingState]
    public var revision: Int
    public var localChoices: Set<String>?
    public var completed: Bool
    public var message: String?
    public var canonicalHistory: [Book] = []
    public var uploadedCoverKey: String?
    public var aliasVerifiedAbsent = false

    public init(local: Book, canonical: Book, localReading: [ReadingState], canonicalReading: [ReadingState], revision: Int) {
        self.local = local; self.canonical = canonical
        self.localReading = localReading; self.canonicalReading = canonicalReading
        self.revision = revision; completed = false
    }

    public var conflictingFields: [String] {
        var fields: [String] = []
        func compare(_ key: String, _ local: String?, _ remote: String?) {
            let left = local?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let right = remote?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !left.isEmpty && !right.isEmpty && left != right { fields.append(key) }
        }
        compare("title", local.title, canonical.title)
        compare("author", local.author, canonical.author)
        compare("publisher", local.publisher, canonical.publisher)
        compare("detailURL", local.detailURL?.absoluteString, canonical.detailURL?.absoluteString)
        let localCover = local.coverKey ?? local.coverURL?.absoluteString ?? local.coverFileName
        let cloudCover = canonical.coverKey ?? canonical.coverURL?.absoluteString ?? canonical.coverFileName
        if let localCover, let cloudCover, localCover != cloudCover { fields.append("cover") }
        if let left = local.rating, let right = canonical.rating, left != right { fields.append("rating") }
        for state in localReading {
            if let other = canonicalReading.first(where: { $0.profileID == state.profileID }),
               state.status != other.status || state.completedAt != other.completedAt {
                fields.append("reading:\(state.profileID)")
            }
        }
        return fields
    }

    public var needsChoice: Bool { !conflictingFields.isEmpty && localChoices == nil }

    public func mergedBook() -> Book {
        let choices = localChoices ?? []
        func value(_ key: String, _ local: String?, _ remote: String?) -> String? {
            if choices.contains(key) { return local }
            return (remote?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) ? local : remote
        }
        var tags: [String] = []
        for tag in canonical.tags + local.tags {
            let tag = tag.trimmingCharacters(in: .whitespacesAndNewlines)
            if !tag.isEmpty && !tags.contains(tag) { tags.append(tag) }
        }
        let localCover = choices.contains("cover") || (canonical.coverKey == nil && canonical.coverURL == nil)
        return Book(id: canonical.id,
            title: value("title", local.title, canonical.title) ?? canonical.title,
            author: value("author", local.author, canonical.author) ?? "",
            isbn: canonical.isbn,
            publisher: value("publisher", local.publisher, canonical.publisher),
            coverURL: localCover ? local.coverURL : canonical.coverURL,
            coverKey: localCover ? local.coverKey : canonical.coverKey,
            coverFileName: localCover ? local.coverFileName : canonical.coverFileName,
            detailURL: choices.contains("detailURL") ? local.detailURL : (canonical.detailURL ?? local.detailURL),
            rating: choices.contains("rating") ? local.rating : (canonical.rating ?? local.rating),
            tags: tags, addedAt: min(local.addedAt, canonical.addedAt), updatedAt: .now)
    }

    public func mergedReading() -> [ReadingState] {
        let profiles = Set((localReading + canonicalReading).map(\.profileID))
        return profiles.sorted().compactMap { profile in
            let local = localReading.first { $0.profileID == profile }
            let remote = canonicalReading.first { $0.profileID == profile }
            guard let chosen = localChoices?.contains("reading:\(profile)") == true ? local : (remote ?? local) else { return nil }
            return ReadingState(profileID: profile, bookID: canonical.id, status: chosen.status,
                completedAt: chosen.completedAt, updatedAt: .now, syncStatus: .pending)
        }
    }
}

/// Account-scoped write-ahead journal. Snapshots are retained after resolution.
/// Save an intent before the SwiftData transaction; replay is safe after a crash.
@MainActor
public struct BookConflictStore {
    private let url: URL

    public init(accountID: String, directory: URL? = nil) throws {
        let digest = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
        url = try (directory ?? NativeStorageLocations.root()).appending(path: "BookConflicts-\(digest).json")
    }

    public func entries() throws -> [BookIdentityConflict] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([BookIdentityConflict].self, from: Data(contentsOf: url))
    }

    public func save(_ entry: BookIdentityConflict) throws {
        var entries = try entries()
        if let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index] = entry }
        else { entries.append(entry) }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(entries).write(to: url, options: [.atomic])
    }

    public func choose(id: String, expected: BookIdentityConflict, localFields: Set<String>) throws {
        guard var entry = try entries().first(where: { $0.id == id && !$0.completed }),
              entry == expected else { throw BookConflictError.changedLocally }
        entry.localChoices = localFields.intersection(entry.conflictingFields)
        entry.message = nil
        try save(entry)
    }
}
