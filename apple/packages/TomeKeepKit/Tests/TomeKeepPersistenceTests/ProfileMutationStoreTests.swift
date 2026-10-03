import Foundation
import Testing
@testable import TomeKeepPersistence

struct ProfileMutationStoreTests {
    @Test
    func latestMutationWinsAndUnscopedWorkIsClaimedByAccount() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let url = directory.appending(path: "mutations.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try ProfileMutationStore(fileURL: url)

        try store.record(profileID: "p1", kind: .upsert, name: "旧名", accountID: nil)
        try store.record(profileID: "p1", kind: .upsert, name: "新名", accountID: nil)
        let claimed = try store.pending(accountID: "u1")

        #expect(claimed.count == 1)
        #expect(claimed.first?.name == "新名")
        #expect(claimed.first?.accountID == "u1")
        try store.remove(profileID: "p1", accountID: "u1")
        #expect(try store.pending(accountID: "u1").isEmpty)
    }

    @Test
    func mutationsRemainScopedWhenAccountsChange() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let url = directory.appending(path: "mutations.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try ProfileMutationStore(fileURL: url)

        try store.record(profileID: "p1", kind: .delete, name: nil, accountID: "u1")
        #expect(try store.pending(accountID: "u2").isEmpty)
        #expect(try store.pending(accountID: "u1").map(\.profileID) == ["p1"])
    }
}
