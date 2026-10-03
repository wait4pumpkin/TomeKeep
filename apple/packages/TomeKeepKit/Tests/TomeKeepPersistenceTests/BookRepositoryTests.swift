import Foundation
import SwiftData
import Testing
import TomeKeepDomain
import TomeKeepPersistence

@MainActor
struct BookRepositoryTests {
    @Test
    func addUpdateAndSoftDeleteBook() throws {
        let repository = try makeRepository()
        let addedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let original = Book(
            id: "book-1",
            title: "初始书名",
            author: "初始作者",
            isbn: "9780306406157",
            addedAt: addedAt,
            updatedAt: addedAt
        )

        try repository.add(original)
        #expect(try repository.books() == [original])

        var updated = original
        updated.title = "更新后的书名"
        updated.publisher = "测试出版社"
        updated.updatedAt = addedAt.addingTimeInterval(60)
        try repository.update(updated)

        #expect(try repository.books() == [updated])

        try repository.softDelete(id: original.id, at: addedAt.addingTimeInterval(120))
        #expect(try repository.books().isEmpty)
    }

    @Test
    func duplicateActiveISBNIsRejected() throws {
        let repository = try makeRepository()
        let instant = Date(timeIntervalSince1970: 1_700_000_000)

        try repository.add(
            Book(
                id: "book-1",
                title: "第一本",
                author: "作者一",
                isbn: "9780306406157",
                addedAt: instant,
                updatedAt: instant
            )
        )

        #expect(throws: BookRepositoryError.duplicateISBN) {
            try repository.add(
                Book(
                    id: "book-2",
                    title: "第二本",
                    author: "作者二",
                    isbn: "9780306406157",
                    addedAt: instant,
                    updatedAt: instant
                )
            )
        }
    }

    private func makeRepository() throws -> BookRepository {
        let configuration = ModelConfiguration(
            schema: PersistenceConfiguration.schema,
            isStoredInMemoryOnly: true
        )
        let container = try ModelContainer(
            for: PersistenceConfiguration.schema,
            configurations: [configuration]
        )
        return BookRepository(context: ModelContext(container))
    }
}
