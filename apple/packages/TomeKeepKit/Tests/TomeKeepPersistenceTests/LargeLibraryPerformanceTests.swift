import Foundation
import SwiftData
import Testing
import TomeKeepDomain
@testable import TomeKeepPersistence

@MainActor
struct LargeLibraryPerformanceTests {
    @Test(.timeLimit(.minutes(1)))
    func tenThousandBookLibraryRemainsSearchable() throws {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        let container = try ModelContainer(
            for: PersistenceConfiguration.schema,
            configurations: configuration
        )
        let context = ModelContext(container)
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        for index in 0..<10_000 {
            context.insert(StoredBook(book: Book(
                id: "book-\(index)",
                title: index == 9_999 ? "唯一检索目标" : "Book \(index)",
                author: "Author \(index % 100)",
                isbn: String(format: "978000%07d", index),
                addedAt: base.addingTimeInterval(Double(index)),
                updatedAt: base.addingTimeInterval(Double(index))
            )))
        }
        try context.save()

        let start = ContinuousClock.now
        let books = try BookRepository(context: context).books()
        let matches = books.filter {
            $0.title.localizedCaseInsensitiveContains("唯一检索目标") ||
            $0.author.localizedCaseInsensitiveContains("唯一检索目标") ||
            ($0.isbn?.contains("唯一检索目标") ?? false)
        }
        let elapsed = start.duration(to: .now)

        #expect(books.count == 10_000)
        #expect(matches.map(\.id) == ["book-9999"])
        #expect(elapsed < .seconds(5))
    }
}
