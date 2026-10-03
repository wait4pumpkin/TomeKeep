import Foundation
import TomeKeepDomain
import TomeKeepNetworking
import TomeKeepPersistence

public enum SyncState: Sendable, Equatable {
    case idle
    case syncing
    case failed(message: String)
}
public actor SyncCoordinator {
    public private(set) var state: SyncState = .idle

    public init() {}

    public func markSyncing() {
        state = .syncing
    }

    public func markIdle() {
        state = .idle
    }

    public func markFailed(message: String) {
        state = .failed(message: message)
    }
}
