import Foundation
import Testing
import TomeKeepDomain
@testable import TomeKeepFeatures

@Test func dateSectionsSeparateMonthsAndRepeatYearsOnlyWhenNeeded() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try #require(TimeZone(secondsFromGMT: 0))

    func date(_ year: Int, _ month: Int, _ day: Int) throws -> Date {
        try #require(calendar.date(from: DateComponents(year: year, month: month, day: day)))
    }

    let books = [
        Book(id: "september-late", title: "A", author: "", addedAt: try date(2026, 9, 20), updatedAt: try date(2026, 9, 20)),
        Book(id: "september-early", title: "B", author: "", addedAt: try date(2026, 9, 1), updatedAt: try date(2026, 9, 1)),
        Book(id: "august", title: "C", author: "", addedAt: try date(2026, 8, 1), updatedAt: try date(2026, 8, 1)),
        Book(id: "previous-year", title: "D", author: "", addedAt: try date(2025, 12, 1), updatedAt: try date(2025, 12, 1)),
        Book(id: "unfinished", title: "E", author: "", addedAt: try date(2024, 1, 1), updatedAt: try date(2024, 1, 1)),
    ]

    let sections = makeBookDateSections(books: books, locale: Locale(identifier: "zh-Hans")) {
        $0.id == "unfinished" ? nil : $0.addedAt
    }

    #expect(sections.map(\.id) == ["2026-9", "2026-8", "2025-12", "unfinished"])
    #expect(sections.map(\.showsYear) == [true, false, true, true])
    #expect(sections[0].books.map(\.id) == ["september-late", "september-early"])
    #expect(sections.last?.isUnfinished == true)
}

@Test func visuallySimilarTagsDoNotCollideInTheEightColorPalette() {
    #expect(tagPaletteIndex(for: "BGG") != tagPaletteIndex(for: "大宝"))
    #expect(tagPaletteIndex(for: "BGG") == tagPaletteIndex(for: "BGG"))
}

@Test func readingStatusCyclesInTheLegacyOrder() {
    #expect(nextReadingStatus(after: .unread) == .reading)
    #expect(nextReadingStatus(after: .reading) == .read)
    #expect(nextReadingStatus(after: .read) == .unread)
}

@Test func bookTagsTrimWhitespaceAndKeepTheFirstUniqueValue() {
    #expect(normalizedBookTags([" CBB ", "", "CBB", "大宝", "  BGG"]) == ["CBB", "大宝", "BGG"])
}

@Test func savingEditorIncludesPendingTagsWithoutDuplicates() {
    #expect(committedEditorTagsText(existing: ["文学"], pending: " 文学，已签名、小说 ") == "文学，已签名，小说")
    #expect(committedEditorTagsText(existing: ["文学"], pending: "  ") == "文学")
    #expect(committedEditorTagsText(existing: [], pending: "文学,小说") == "文学，小说")
}
