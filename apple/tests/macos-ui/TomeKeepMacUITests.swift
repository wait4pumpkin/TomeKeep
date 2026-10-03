import XCTest

final class TomeKeepMacUITests: XCTestCase {
    @MainActor
    func testPrimaryNavigationAndMigratedLibraryAreVisible() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(zh-Hans)"]
        app.launch()

        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 8))
        XCTAssertTrue(app.windows["书库"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["书库"].firstMatch.waitForExistence(timeout: 4))
        XCTAssertTrue(app.descendants(matching: .any)["library.summary"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.buttons["Hide Sidebar"].exists)
        XCTAssertFalse(app.buttons["隐藏边栏"].exists)
        XCTAssertFalse(app.buttons["隐藏侧边栏"].exists)

        let firstTag = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "tag.filter.")).firstMatch
        XCTAssertTrue(firstTag.waitForExistence(timeout: 3))
        if !firstTag.isSelected { firstTag.click() }
        XCTAssertTrue(firstTag.isSelected)
        XCTAssertFalse(firstTag.label.localizedCaseInsensitiveContains("checkmark"))
        XCTAssertFalse(firstTag.label.contains("勾"))

        let firstBook = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "library.book.card."))
            .firstMatch
        XCTAssertTrue(firstBook.waitForExistence(timeout: 3))
        firstBook.click()
        let titleField = app.textFields["book.title"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 3))
        XCTAssertFalse((titleField.value as? String ?? "").isEmpty)
        app.buttons["取消"].firstMatch.click()

        app.buttons["愿望单"].firstMatch.click()
        XCTAssertTrue(app.windows["愿望单"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.descendants(matching: .any)["wishlist.summary"].waitForExistence(timeout: 3))

        let coverGrid = app.radioButtons["square.grid.3x3"]
        XCTAssertTrue(coverGrid.waitForExistence(timeout: 3))
        coverGrid.click()
        XCTAssertTrue(app.sliders["每行封面数量"].waitForExistence(timeout: 3))

        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(app.windows["书库"].waitForExistence(timeout: 3))
    }
}
