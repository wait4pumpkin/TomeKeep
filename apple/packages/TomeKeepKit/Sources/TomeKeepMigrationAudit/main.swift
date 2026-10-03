import Foundation
import Darwin
import SwiftData
import TomeKeepMigration
import TomeKeepPersistence

@main
struct TomeKeepMigrationAuditCommand {
    static func main() async {
        do {
            let arguments = CommandLine.arguments
            guard arguments.count == 3 || arguments.count == 4 else {
                throw AuditCommandError.usage
            }
            let sourceURL = URL(filePath: arguments[1], directoryHint: .checkFileSystem)
            let outputURL = URL(filePath: arguments[2], directoryHint: .isDirectory)
            let coversURL = outputURL.appending(path: "Covers", directoryHint: .isDirectory)
            let reportsURL = outputURL.appending(path: "MigrationReports", directoryHint: .isDirectory)
            let service = LegacyImportService()
            let preparation = try await service.prepare(
                sourceURL: sourceURL,
                destinationCoversURL: coversURL
            )
            let destinationCounts: LegacyArchiveCounts
            if arguments.count == 4 {
                let storeURL = URL(filePath: arguments[3], directoryHint: .notDirectory)
                let counts = try await MainActor.run {
                    let configuration = ModelConfiguration(
                        schema: PersistenceConfiguration.schema,
                        url: storeURL
                    )
                    let container = try ModelContainer(
                        for: PersistenceConfiguration.schema,
                        configurations: [configuration]
                    )
                    return try LibraryArchiveRepository(context: ModelContext(container)).importArchive(
                        preparation.archive,
                        sourceHash: preparation.sourceDatabaseSHA256,
                        reportURL: nil
                    )
                }
                destinationCounts = LegacyArchiveCounts(
                    books: counts.books,
                    wishlist: counts.wishlist,
                    profiles: counts.profiles,
                    readingStates: counts.readingStates,
                    priceCacheEntries: counts.priceCacheEntries,
                    covers: preparation.coverDigests.count
                )
            } else {
                destinationCounts = preparation.normalizedCounts
            }
            let reportURL = try await service.writeReport(
                preparation: preparation,
                destinationCounts: destinationCounts,
                reportsDirectory: reportsURL
            )
            if arguments.count == 4 {
                let storeURL = URL(filePath: arguments[3], directoryHint: .notDirectory)
                try await MainActor.run {
                    let configuration = ModelConfiguration(
                        schema: PersistenceConfiguration.schema,
                        url: storeURL
                    )
                    let container = try ModelContainer(
                        for: PersistenceConfiguration.schema,
                        configurations: [configuration]
                    )
                    try LibraryArchiveRepository(context: ModelContext(container)).recordImportReportURL(reportURL)
                }
            }
            let counts = preparation.normalizedCounts
            print("Migration audit passed")
            print("books=\(counts.books) wishlist=\(counts.wishlist) profiles=\(counts.profiles) readingStates=\(counts.readingStates) priceCache=\(counts.priceCacheEntries) covers=\(counts.covers)")
            print("warnings=\(preparation.warnings.count)")
            print("report=\(reportURL.path)")
        } catch {
            FileHandle.standardError.write(Data("Migration audit failed: \(error.localizedDescription)\n".utf8))
            exit(EXIT_FAILURE)
        }
    }
}

private enum AuditCommandError: Error, LocalizedError {
    case usage

    var errorDescription: String? {
        "Usage: tomekeep-migration-audit <legacy directory or db.json> <output directory> [SwiftData store path]"
    }
}
