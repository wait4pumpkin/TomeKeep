import Foundation
import TomeKeepDomain
import TomeKeepNetworking
import TomeKeepPersistence

@MainActor
extension NativeSyncEngine {
    func fetchConflictBook(id: String, token: String) async throws -> APIBook? {
        do {
            return try await client.request(APIBook.self, path: "books/\(id)", bearerToken: token)
        } catch APIClientError.rejected(statusCode: 404, message: _) {
            let books = try await client.request([APIBook].self, path: "books", bearerToken: token)
            return books.first { $0.id == id }
        }
    }

    func stageBookConflict(localID: String, canonicalID: String, repository: LocalSyncRepository, store: BookConflictStore, token: String) async throws {
        guard let remote = try await fetchConflictBook(id: canonicalID, token: token),
              remote.deletedAt == nil, let canonical = remote.syncRecord?.book else { return }
        var entry = try repository.prepareConflict(localID: localID, canonical: canonical, revision: remote.revision ?? 0, store: store)
        if let alias = try await fetchConflictBook(id: localID, token: token), alias.deletedAt == nil {
            entry.message = "两条记录均已存在于服务器，需要人工处理。"
            try store.save(entry)
            return
        }
        entry.aliasVerifiedAbsent = true
        try store.save(entry)
        try await resumeConflict(entry, repository: repository, store: store, token: token)
    }

    func resumeConflict(_ original: BookIdentityConflict, repository: LocalSyncRepository, store: BookConflictStore, token: String) async throws {
        var entry = original
        if entry.message == "两条记录均已存在于服务器，需要人工处理。" { return }
        if !entry.aliasVerifiedAbsent {
            if try await fetchConflictBook(id: entry.local.id, token: token) != nil {
                entry.message = "两条记录均已存在于服务器，需要人工处理。"
                try store.save(entry)
                return
            }
            entry.aliasVerifiedAbsent = true
            try store.save(entry)
        }
        if entry.revision == 0,
           let refreshed = try await fetchConflictBook(id: entry.canonical.id, token: token),
           let revision = refreshed.revision, let book = refreshed.syncRecord?.book, refreshed.deletedAt == nil {
            entry.canonicalHistory.append(entry.canonical)
            entry.canonical = book
            entry.revision = revision
            entry.localChoices = nil
            entry.message = nil
            try store.save(entry)
        }
        guard entry.revision > 0 else {
            entry.message = "服务端需要更新后才能安全合并书籍。"
            try store.save(entry)
            return
        }
        do { try repository.retireConflictAlias(entry) }
        catch BookConflictError.changedLocally {
            entry.message = "本机资料已改变，请保留候选并重新检查。"
            try store.save(entry)
            return
        }
        onLocalDataChanged()
        let states = try repository.conflictReading(bookID: entry.canonical.id)
        // Ignore timestamp-only sync acknowledgements, but re-review changed intent.
        let changedReading = states.contains { state in
            guard let baseline = entry.canonicalReading.first(where: { $0.profileID == state.profileID }) else {
                return !entry.localReading.contains { $0.profileID == state.profileID && $0.status == state.status && $0.completedAt == state.completedAt }
            }
            return baseline.status != state.status || baseline.completedAt != state.completedAt
        }
        if changedReading {
            entry.canonicalReading = states
            entry.localChoices = nil
            entry.message = "阅读状态已改变，请重新检查合并选项。"
            try store.save(entry)
        }
        if entry.needsChoice { return }
        guard let remote = try await fetchConflictBook(id: entry.canonical.id, token: token),
              let current = remote.syncRecord?.book, let revision = remote.revision else { return }
        guard remote.deletedAt == nil else {
            entry.message = "服务器记录已删除，未自动恢复。"
            try store.save(entry)
            return
        }
        guard let localTarget = try repository.book(id: current.id) else { return }
        if localTarget.syncStatus == .pending { return }
        var merged = entry.mergedBook()
        if let key = entry.uploadedCoverKey { merged.coverKey = key }
        if revision != entry.revision && !sameBookContent(merged, current) {
            entry.canonicalHistory.append(entry.canonical)
            entry.canonical = current
            entry.revision = revision
            entry.localChoices = nil
            entry.message = "服务器资料已改变，请重新检查合并选项。"
            try store.save(entry)
            if entry.needsChoice { return }
            merged = entry.mergedBook()
        }
        if merged.coverKey == nil, let fileName = merged.coverFileName, localCoverExists(fileName) {
            merged.coverKey = try await coverSync.upload(fileName: fileName, bearerToken: token)
            entry.uploadedCoverKey = merged.coverKey
            try store.save(entry)
        }
        guard try store.entries().first(where: { $0.id == entry.id })?.localChoices == entry.localChoices else { return }
        do {
            let confirmed: Book
            if sameBookContent(merged, current) { confirmed = current }
            else {
                var payload = BookPayload(merged)
                payload.expectedRevision = revision
                let response = try await client.request(APIBook.self, method: "PUT", path: "books/\(current.id)", bearerToken: token, body: payload)
                guard let book = response.syncRecord?.book else { throw NativeSyncError.invalidRecordDate }
                confirmed = book
            }
            try repository.finishConflict(entry, confirmed: confirmed, selected: merged, expectedLocalUpdate: localTarget.updatedAt)
            entry.canonicalHistory.append(entry.canonical)
            entry.canonical = confirmed
            entry.completed = true
            entry.message = nil
            try store.save(entry)
            onLocalDataChanged()
        } catch let error as APIBookConflictError where error.reason == "stale_book" {
            entry.message = "服务器资料已改变，请重新检查合并选项。"
            entry.localChoices = nil
            try store.save(entry)
        } catch BookConflictError.changedLocally {
            entry.message = "本机资料已改变，请保留候选并重新检查。"
            entry.localChoices = nil
            try store.save(entry)
        }
    }
}

private func sameBookContent(_ left: Book, _ right: Book) -> Bool {
    left.id == right.id && left.title == right.title && left.author == right.author &&
    left.isbn == right.isbn && left.publisher == right.publisher && left.coverKey == right.coverKey &&
    left.detailURL == right.detailURL && left.tags == right.tags && left.addedAt.ISO8601Format() == right.addedAt.ISO8601Format()
}
