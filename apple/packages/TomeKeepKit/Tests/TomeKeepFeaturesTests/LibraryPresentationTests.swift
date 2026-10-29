import Foundation
import Testing
import TomeKeepDomain
@testable import TomeKeepFeatures

@Test func wishlistPendingFilterCombinesWithQueryAndTags() {
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let item = WishlistItem(id: "wish", title: "Dune", author: "Frank Herbert", isbn: "9780306406157", tags: ["科幻", "BGG"], priority: .medium, pendingBuy: true, addedAt: now, updatedAt: now)
    #expect(wishlistMatchesFilters(item, query: " dune ", tags: ["科幻"], pendingOnly: true))
    #expect(wishlistMatchesFilters(item, query: "herbert", tags: [], pendingOnly: true))
    #expect(wishlistMatchesFilters(item, query: "978030", tags: ["科幻", "BGG"], pendingOnly: true))
    #expect(!wishlistMatchesFilters(item, query: "other", tags: [], pendingOnly: true))
    #expect(!wishlistMatchesFilters(item, query: "", tags: ["缺失"], pendingOnly: true))
    var unmarked = item
    unmarked.pendingBuy = false
    #expect(!wishlistMatchesFilters(unmarked, query: "", tags: [], pendingOnly: true))
    #expect(wishlistMatchesFilters(unmarked, query: "", tags: [], pendingOnly: false))
}

@Test func introductionLinksOnlyOpenValidWebURLs() {
    let url = URL(string: "https://book.douban.com/subject/35379215/")!
    #expect(bookIntroductionURL(url) == url)
    #expect(bookIntroductionURL(URL(string: "https://openlibrary.org/books/OL1M")) != nil)
    #expect(bookIntroductionURL(nil) == nil)
    for raw in ["file:///private/library", "javascript:alert(1)", "https://user:pass@example.com/", "relative/path", "https:"] {
        #expect(bookIntroductionURL(URL(string: raw)) == nil)
    }
}

@Test func commonTagsCountDistinctRecordsExcludeSelectionAndRankStably() {
    let groups = [[" 常用 ", "常用", "Alpha", ""], ["常用", "Beta"], ["Alpha", "Beta"], ["常用"]]
    #expect(commonBookTags(in: groups, excluding: []) == ["常用", "Alpha", "Beta"])
    #expect(commonBookTags(in: groups, excluding: [" 常用 "]) == ["Alpha", "Beta"])
    #expect(commonBookTags(in: [], excluding: []).isEmpty)
}

@Test func compactTagPickerOffersEveryExistingTagWithoutSearchOrPagination() {
    let tags = (1...20).map { "Tag \($0)" }
    let suggestions = commonBookTags(in: [tags], excluding: [tags[0]])
    #expect(suggestions.count == 19)
    #expect(Set(suggestions) == Set(tags.dropFirst()))
    #expect(commonBookTags(in: [tags], excluding: tags).isEmpty)
}

@Test func retiredWishlistPrioritySortRestoresRecentOrder() {
    #expect(wishlistSortWithoutPriority("priority") == "recentlyAdded")
    for value in ["recentlyAdded", "title", "author", "pendingBuy"] {
        #expect(wishlistSortWithoutPriority(value) == value)
    }
}

@Test func readingProgressBreathingHonorsMotionPreferenceAndForeground() {
    #expect(shouldBreatheReadingProgress(reduceMotion: false, isActive: true))
    #expect(!shouldBreatheReadingProgress(reduceMotion: true, isActive: true))
    #expect(!shouldBreatheReadingProgress(reduceMotion: false, isActive: false))
    #expect(!shouldBreatheReadingProgress(reduceMotion: true, isActive: false))
}

@Test func compactControlsUseSeparateCollapseAndRestoreThresholds() {
    #expect(!compactTopControls(scrollOffset: 0, wasCompact: false))
    #expect(!compactTopControls(scrollOffset: 80, wasCompact: false))
    #expect(compactTopControls(scrollOffset: 81, wasCompact: false))
    #expect(compactTopControls(scrollOffset: 64, wasCompact: true))
    #expect(compactTopControls(scrollOffset: 17, wasCompact: true))
    #expect(!compactTopControls(scrollOffset: 16, wasCompact: true))
    #expect(!compactTopControls(scrollOffset: -20, wasCompact: true))
}

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

@Test func inlineTagSubmissionPreservesSelectionsAndPendingManualInput() {
    let selected = normalizedBookTags(["文学", "小说", "文学"])
    #expect(committedEditorTagsText(existing: selected, pending: " 已签名，小说 ") == "文学，小说，已签名")
    #expect(commonBookTags(in: [["文学", "小说", "已签名"]], excluding: selected) == ["已签名"])
    #expect(committedEditorTagsText(existing: selected, pending: "") == "文学，小说")
}
