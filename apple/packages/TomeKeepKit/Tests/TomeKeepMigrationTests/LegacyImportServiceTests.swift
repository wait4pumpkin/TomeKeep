import Foundation
import Testing
import TomeKeepMigration

struct LegacyImportServiceTests {
    @Test
    func preparesIdempotentArchiveAndVerifiableReport() async throws {
        let temporaryRoot = FileManager.default.temporaryDirectory
            .appending(path: "TomeKeepMigrationTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        let source = temporaryRoot.appending(path: "legacy", directoryHint: .isDirectory)
        let covers = source.appending(path: "covers", directoryHint: .isDirectory)
        let destination = temporaryRoot.appending(path: "native-covers", directoryHint: .isDirectory)
        let reports = temporaryRoot.appending(path: "reports", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: covers, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryRoot) }

        let database = """
        {
          "books": [{
            "id": "legacy-book",
            "title": "迁移测试",
            "author": "作者",
            "isbn": "9780306406157",
            "coverUrl": "app://covers/legacy-book.jpg",
            "coverKey": "covers/legacy-book.jpg",
            "tags": ["测试"],
            "addedAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-02T00:00:00.000Z",
            "syncStatus": "synced"
          }],
          "wishlist": [],
          "priceCache": {},
          "users": [{
            "id": "profile-1",
            "name": "用户",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "language": "zh",
            "uiPrefs": {"activePage": "library"}
          }],
          "readingStates": [{
            "userId": "profile-1",
            "bookId": "legacy-book",
            "status": "read",
            "completedAt": "2026-01-03T00:00:00.000Z",
            "syncStatus": "synced"
          }],
          "activeUserId": "profile-1",
          "syncCursors": {"books": "b", "wishlist": "w", "readingStates": "r"},
          "lastSyncAt": "2026-01-04T00:00:00.000Z",
          "futureField": true
        }
        """
        let databaseURL = source.appending(path: "db.json")
        try Data(database.utf8).write(to: databaseURL)
        try Data([0xFF, 0xD8, 0xFF, 0xD9]).write(to: covers.appending(path: "legacy-book.jpg"))
        let originalDatabase = try Data(contentsOf: databaseURL)

        let service = LegacyImportService()
        let first = try await service.prepare(sourceURL: source, destinationCoversURL: destination)
        let second = try await service.prepare(sourceURL: source, destinationCoversURL: destination)

        #expect(first.archive.books.count == 1)
        #expect(first.archive.books[0].coverFileName == second.archive.books[0].coverFileName)
        #expect(first.archive.readingStates[0].updatedAt == first.archive.readingStates[0].completedAt)
        #expect(first.coverDigests == second.coverDigests)
        #expect(first.recordDigests == second.recordDigests)
        #expect(first.warnings.contains { $0.contains("futureField") })
        #expect(try Data(contentsOf: databaseURL) == originalDatabase)

        let reportURL = try await service.writeReport(
            preparation: first,
            destinationCounts: first.sourceCounts,
            reportsDirectory: reports
        )
        let reportData = try Data(contentsOf: reportURL)
        let report = try JSONDecoder.iso8601.decode(LegacyImportReport.self, from: reportData)
        #expect(report.sourceCounts == report.destinationCounts)
        #expect(report.coverDigests.count == 1)
    }
}

private extension JSONDecoder {
    static var iso8601: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
