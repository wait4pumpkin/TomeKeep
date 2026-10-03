import Foundation
import Testing
@testable import TomeKeepDomain

@Test func `new book defaults to pending sync`() {
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let book = Book(
        id: "legacy-id-must-remain-opaque",
        title: "测试书籍",
        author: "作者",
        addedAt: now,
        updatedAt: now
    )

    #expect(book.syncStatus == .pending)
    #expect(book.tags.isEmpty)
    #expect(book.id == "legacy-id-must-remain-opaque")
}
