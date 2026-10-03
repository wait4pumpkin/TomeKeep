import XCTest
import TomeKeepDomain
import TomeKeepMetadata

final class ISBNContractTests: XCTestCase {
    func testISBN10ConvertsToISBN13() throws {
        let isbn = try XCTUnwrap(ISBN("0-306-40615-2"))
        XCTAssertEqual(isbn.isbn13, "9780306406157")
    }

    func testInvalidISBNIsRejected() {
        XCTAssertNil(ISBN("9783161484101"))
    }

    func testLegacyIdentifierRemainsOpaque() {
        let instant = Date(timeIntervalSince1970: 1_700_000_000)
        let book = Book(
            id: "legacy-non-uuid-id",
            title: "测试书籍",
            author: "作者",
            addedAt: instant,
            updatedAt: instant
        )

        XCTAssertEqual(book.id, "legacy-non-uuid-id")
    }
}
