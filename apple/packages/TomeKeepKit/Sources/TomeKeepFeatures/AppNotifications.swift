import Foundation

enum TomeKeepAppNotification {
    static let syncCompleted = Notification.Name("TomeKeep.sync.completed")
    static let syncRequested = Notification.Name("TomeKeep.sync.requested")
    static let activeProfileChanged = Notification.Name("TomeKeep.activeProfileChanged")
    static let openPriceHistory = Notification.Name("TomeKeep.openPriceHistory")
}

@MainActor
func requestTomeKeepSync() {
    NotificationCenter.default.post(name: TomeKeepAppNotification.syncRequested, object: nil)
}
