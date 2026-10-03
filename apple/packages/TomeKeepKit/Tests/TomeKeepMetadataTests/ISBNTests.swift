import Testing
@testable import TomeKeepMetadata

@Test(arguments: [
    ("978-3-16-148410-0", "9783161484100"),
    ("316-148410-X", "9783161484100"),
    ("0-306-40615-2", "9780306406157"),
])
func `valid ISBN values normalize to ISBN-13`(input: String, expected: String) throws {
    let isbn = try #require(ISBN(input))
    #expect(isbn.isbn13 == expected)
}

@Test(arguments: [
    "9783161484101",
    "3161484100",
    "not-an-isbn",
    "",
])
func `invalid ISBN values are rejected`(input: String) {
    #expect(ISBN(input) == nil)
}
