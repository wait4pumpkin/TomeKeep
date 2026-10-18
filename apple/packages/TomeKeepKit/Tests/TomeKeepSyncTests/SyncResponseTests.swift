import Foundation
import Testing
import TomeKeepNetworking
@testable import TomeKeepSync

@Test(arguments: ["", "  ", "https://[broken", "not a web link", "javascript:alert(1)", "file:///private/data"])
func invalidOptionalLinkDoesNotBlockBookOrWishlistDownload(_ link: String) throws {
    let body: [String: Any] = [
        "id": "legacy-book", "title": "Preserved title", "author": "Author",
        "isbn": "9780306406157", "detail_url": link, "tags": ["Keep"],
        "added_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-18T00:00:00Z",
        "priority": "high", "pending_buy": true
    ]
    let data = try JSONSerialization.data(withJSONObject: body)
    let book = try #require(JSONDecoder.tomeKeep.decode(APIBook.self, from: data).syncRecord)
    #expect(book.book.title == "Preserved title")
    #expect(book.book.tags == ["Keep"])
    #expect(book.book.detailURL == nil)
    let wish = try #require(JSONDecoder.tomeKeep.decode(APIWishlistItem.self, from: data).syncRecord)
    #expect(wish.item.title == "Preserved title")
    #expect(wish.item.priority.rawValue == "high")
    #expect(wish.item.pendingBuy)
    #expect(wish.item.detailURL == nil)
}

@Test func validOptionalWebLinksArePreserved() {
    let link = "https://book.douban.com/subject/1234567/"
    #expect(remoteDetailURL(link)?.absoluteString == link)
    #expect(remoteDetailURL(nil) == nil)
}

@Test(arguments: ["2026-10-18 14:00:00", "2026-10-18T14:00:00Z", "2026-10-18T14:00:00.000Z", "2026-10-18 14:00:00.000"])
func sqliteAndISODateFormatsRepresentTheSameUTCInstant(_ value: String) throws {
    #expect(APIBook.date(value) == APIBook.date("2026-10-18T14:00:00Z"))
    #expect(APIBook.date("invalid") == nil)
    let body: [String: Any] = [
        "id": "legacy", "title": "Keep", "author": "A", "tags": [],
        "detail_url": "", "added_at": value, "updated_at": value,
        "priority": "medium", "pending_buy": false
    ]
    let data = try JSONSerialization.data(withJSONObject: body)
    #expect(try JSONDecoder.tomeKeep.decode(APIBook.self, from: data).syncRecord != nil)
    #expect(try JSONDecoder.tomeKeep.decode(APIWishlistItem.self, from: data).syncRecord != nil)
}
