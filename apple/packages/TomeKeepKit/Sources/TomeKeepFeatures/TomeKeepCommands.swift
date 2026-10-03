import Foundation
import SwiftUI

public enum TomeKeepCommandNotification {
    public static let newBook = Notification.Name("TomeKeep.command.newBook")
    static let openBookEditor = Notification.Name("TomeKeep.command.openBookEditor")
    public static let showLibrary = Notification.Name("TomeKeep.command.showLibrary")
    public static let showWishlist = Notification.Name("TomeKeep.command.showWishlist")
    public static let showPrices = Notification.Name("TomeKeep.command.showPrices")
    public static let showSettings = Notification.Name("TomeKeep.command.showSettings")
}

#if os(macOS)
public struct TomeKeepCommands: Commands {
    public init() {}

    public var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("新增藏书") {
                NotificationCenter.default.post(name: TomeKeepCommandNotification.newBook, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)
        }
        CommandMenu("前往") {
            Button("书库") { post(TomeKeepCommandNotification.showLibrary) }
                .keyboardShortcut("1", modifiers: .command)
            Button("愿望单") { post(TomeKeepCommandNotification.showWishlist) }
                .keyboardShortcut("2", modifiers: .command)
            Button("价格记录") { post(TomeKeepCommandNotification.showPrices) }
                .keyboardShortcut("3", modifiers: .command)
            Divider()
            Button("设置") { post(TomeKeepCommandNotification.showSettings) }
                .keyboardShortcut(",", modifiers: .command)
        }
    }

    private func post(_ name: Notification.Name) {
        NotificationCenter.default.post(name: name, object: nil)
    }
}
#endif
