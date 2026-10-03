import Testing
@testable import TomeKeepFeatures

@Test func scanSessionNormalizesISBN10AndRejectsTheSameBookTwice() {
    var session = ISBNScanSession()

    #expect(session.accept("0-306-40615-2") == .accepted("9780306406157"))
    #expect(session.accept("9780306406157") == .duplicate("9780306406157"))
    #expect(session.accept("not-an-isbn") == .invalid)
}
