import Foundation
import Testing
import TomeKeepSync
@testable import TomeKeepFeatures

@Suite("NativeSyncCoordinator")
@MainActor
struct NativeSyncCoordinatorTests {
    @Test("requests during sync collapse into one follow-up pass")
    func coalescesOverlappingRequests() async {
        let coordinator = NativeSyncCoordinator()
        let (stream, continuation) = AsyncStream<Void>.makeStream()
        var runCount = 0

        let first = Task { @MainActor in
            await coordinator.perform(trigger: .launch) {
                runCount += 1
                if runCount == 1 {
                    for await _ in stream.prefix(1) {}
                }
                return SyncResult(pulled: runCount, pushed: 0)
            }
        }

        while runCount == 0 { await Task.yield() }
        let queued = await coordinator.perform(trigger: .localChange) {
            runCount += 1
            return SyncResult(pulled: 0, pushed: runCount)
        }
        #expect(queued == nil)

        continuation.yield()
        continuation.finish()
        let result = await first.value

        #expect(runCount == 2)
        #expect(result == SyncResult(pulled: 0, pushed: 2))
        #expect(coordinator.lastResult == result)
        #expect(coordinator.lastSuccessAt != nil)
        #expect(coordinator.lastError == nil)
        #expect(!coordinator.isSyncing)
    }

    @Test("sync failures stay visible without escaping into the UI task")
    func exposesFailureState() async {
        let coordinator = NativeSyncCoordinator()

        let result = await coordinator.perform(trigger: .manual) {
            throw TestSyncError.offline
        }

        #expect(result == nil)
        #expect(coordinator.lastError != nil)
        #expect(coordinator.lastSuccessAt == nil)
        #expect(!coordinator.isSyncing)
    }

    @Test("account state can explicitly reflect sign-in and sign-out")
    func tracksAccountState() {
        let coordinator = NativeSyncCoordinator()
        #expect(coordinator.accountState == .unknown)

        coordinator.markSignedIn()
        #expect(coordinator.accountState == .signedIn)

        coordinator.markSignedOut()
        #expect(coordinator.accountState == .signedOut)
    }
}

private enum TestSyncError: Error {
    case offline
}
