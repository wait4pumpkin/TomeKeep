import Foundation
import Observation
import SwiftData
import TomeKeepNetworking
import TomeKeepSync

enum NativeSyncTrigger: String, Sendable {
    case launch
    case foreground
    case login
    case localChange
    case manual
}

enum NativeAccountState: Equatable, Sendable {
    case unknown
    case signedOut
    case signedIn
}

@MainActor
@Observable
final class NativeSyncCoordinator {
    private(set) var accountState: NativeAccountState = .unknown
    private(set) var isSyncing = false
    private(set) var lastResult: SyncResult?
    private(set) var lastSuccessAt: Date?
    private(set) var lastError: String?
    private(set) var activeTrigger: NativeSyncTrigger?

    private var pendingOperation: (@MainActor () async throws -> SyncResult)?
    private var pendingTrigger: NativeSyncTrigger?

    @discardableResult
    func synchronize(
        context: ModelContext,
        baseURL: URL,
        uploadsPriceCache: Bool,
        trigger: NativeSyncTrigger
    ) async -> SyncResult? {
        await perform(trigger: trigger) {
            try await NativeSyncEngine(
                baseURL: baseURL,
                uploadsPriceCache: uploadsPriceCache
            ).synchronize(context: context)
        }
    }

    /// Runs one sync at a time. Requests that arrive while a sync is in flight
    /// are collapsed into one follow-up pass so edits made during a pull/push
    /// cycle are not left waiting for the next app launch.
    @discardableResult
    func perform(
        trigger: NativeSyncTrigger,
        operation: @escaping @MainActor () async throws -> SyncResult
    ) async -> SyncResult? {
        if isSyncing {
            pendingOperation = operation
            pendingTrigger = trigger
            return nil
        }

        isSyncing = true
        lastError = nil
        var nextOperation: (@MainActor () async throws -> SyncResult)? = operation
        var nextTrigger: NativeSyncTrigger? = trigger
        var newestResult: SyncResult?

        while let currentOperation = nextOperation {
            activeTrigger = nextTrigger
            pendingOperation = nil
            pendingTrigger = nil
            do {
                let result = try await currentOperation()
                newestResult = result
                lastResult = result
                lastSuccessAt = .now
                lastError = nil
                NotificationCenter.default.post(
                    name: TomeKeepAppNotification.syncCompleted,
                    object: nil
                )
            } catch {
                if case APIClientError.rejected(statusCode: 401, message: _) = error {
                    try? KeychainTokenStore().delete()
                    accountState = .signedOut
                }
                lastError = tkErrorDescription(error, fallback: "同步失败；本机数据没有丢失。")
            }
            nextOperation = pendingOperation
            nextTrigger = pendingTrigger
        }

        activeTrigger = nil
        isSyncing = false
        return newestResult
    }

    func refreshAccountState(tokenStore: KeychainTokenStore = .init()) {
        do {
            accountState = try tokenStore.load() == nil ? .signedOut : .signedIn
        } catch {
            accountState = .unknown
            lastError = tkErrorDescription(error, fallback: "无法读取登录状态；本机数据仍可正常使用。")
        }
    }

    func markSignedIn() {
        accountState = .signedIn
    }

    func markSignedOut() {
        accountState = .signedOut
    }

    func clearSessionStatus() {
        lastResult = nil
        lastSuccessAt = nil
        lastError = nil
        pendingOperation = nil
        pendingTrigger = nil
    }
}
