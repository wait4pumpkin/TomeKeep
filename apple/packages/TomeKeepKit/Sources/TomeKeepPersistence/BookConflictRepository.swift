import Foundation
import SwiftData
import TomeKeepDomain

public enum BookConflictError: Error, Equatable {
    case invalidIdentity
    case changedLocally
}

@MainActor
public extension LocalSyncRepository {
    func otherSyncedBookID(isbn: String?, excluding id: String) throws -> String? {
        guard let isbn, let normalized = ISBN(isbn)?.isbn13 else { return nil }
        return try context.fetch(FetchDescriptor<StoredBook>()).filter {
            $0.deletedAt == nil && $0.id != id && $0.syncStatusRawValue == "synced" &&
            $0.isbn.flatMap { ISBN($0)?.isbn13 } == normalized
        }.map(\.id).sorted().first
    }

    func book(id: String) throws -> Book? {
        try context.fetch(FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id && $0.deletedAt == nil })).first?.snapshot()
    }

    func conflictReading(bookID: String) throws -> [ReadingState] {
        try context.fetch(FetchDescriptor<StoredReadingState>(predicate: #Predicate { $0.bookID == bookID }))
            .map { $0.snapshot() }.sorted { $0.profileID < $1.profileID }
    }

    func prepareConflict(localID: String, canonical: Book, revision: Int, store: BookConflictStore) throws -> BookIdentityConflict {
        if let existing = try store.entries().first(where: { $0.id == localID }) { return existing }
        guard let local = try book(id: localID), local.id != canonical.id,
              let isbn = local.isbn.flatMap({ ISBN($0)?.isbn13 }),
              canonical.isbn.flatMap({ ISBN($0)?.isbn13 }) == isbn else { throw BookConflictError.invalidIdentity }
        let states = try context.fetch(FetchDescriptor<StoredReadingState>()).map { $0.snapshot() }
        let entry = BookIdentityConflict(local: local, canonical: canonical,
            localReading: states.filter { $0.bookID == local.id },
            canonicalReading: states.filter { $0.bookID == canonical.id }, revision: revision)
        try store.save(entry) // Must succeed before any database changes.
        return entry
    }

    /// Hide an unsynced alias without a server DELETE; its snapshot is in the journal.
    func retireConflictAlias(_ entry: BookIdentityConflict) throws {
        guard entry.aliasVerifiedAbsent else { throw BookConflictError.invalidIdentity }
        let id = entry.local.id
        guard let alias = try context.fetch(FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id })).first,
              alias.deletedAt == nil else { return }
        guard alias.snapshot() == entry.local else { throw BookConflictError.changedLocally }
        try context.transaction {
            let targetID = entry.canonical.id
            if try context.fetch(FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == targetID })).isEmpty {
                context.insert(StoredBook(book: entry.canonical))
            }
            try migrateConflictReading(entry, onlyAbsent: true)
            alias.deletedAt = .now
            alias.syncStatusRawValue = SyncStatus.synced.rawValue
            try context.save()
        }
    }

    func finishConflict(_ entry: BookIdentityConflict, confirmed: Book, selected: Book, expectedLocalUpdate: Date) throws {
        let id = confirmed.id
        guard let target = try context.fetch(FetchDescriptor<StoredBook>(predicate: #Predicate { $0.id == id })).first,
              target.deletedAt == nil, target.updatedAt == expectedLocalUpdate else { throw BookConflictError.changedLocally }
        // No network suspension occurs within this transaction.
        try context.transaction {
            target.title = confirmed.title; target.author = confirmed.author; target.isbn = confirmed.isbn
            target.publisher = confirmed.publisher; target.tags = confirmed.tags
            target.detailURL = confirmed.detailURL; target.addedAt = confirmed.addedAt; target.updatedAt = confirmed.updatedAt
            if target.coverKey != confirmed.coverKey { target.coverFileName = nil }
            target.coverKey = confirmed.coverKey
            if selected.coverKey == confirmed.coverKey {
                target.coverURL = selected.coverURL ?? target.coverURL
                target.coverFileName = selected.coverFileName ?? target.coverFileName
            }
            target.rating = selected.rating ?? target.rating
            target.syncStatusRawValue = SyncStatus.synced.rawValue
            try migrateConflictReading(entry, onlyAbsent: false)
            try context.save()
        }
    }

    private func migrateConflictReading(_ entry: BookIdentityConflict, onlyAbsent: Bool) throws {
        let all = try context.fetch(FetchDescriptor<StoredReadingState>())
        for state in entry.mergedReading() {
            let existing = all.first { $0.bookID == state.bookID && $0.profileID == state.profileID }
            if let existing {
                if onlyAbsent { continue }
                // Preserve edits made after the journal snapshot, requiring another review.
                let baseline = entry.canonicalReading.first { $0.profileID == state.profileID } ?? entry.localReading.first { $0.profileID == state.profileID }
                if let baseline, existing.updatedAt > baseline.updatedAt,
                   existing.statusRawValue != state.status.rawValue || existing.completedAt != state.completedAt {
                    throw BookConflictError.changedLocally
                }
                existing.statusRawValue = state.status.rawValue; existing.completedAt = state.completedAt
                existing.updatedAt = state.updatedAt; existing.syncStatusRawValue = "pending"
            } else { context.insert(StoredReadingState(state: state)) }
        }
        for state in all where state.bookID == entry.local.id { context.delete(state) }
    }
}
