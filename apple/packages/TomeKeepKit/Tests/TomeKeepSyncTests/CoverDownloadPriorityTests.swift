import Foundation
import Testing
import TomeKeepPersistence
@testable import TomeKeepSync

@MainActor
struct CoverDownloadPriorityTests {
    private func job(_ id: String, _ collection: CoverCollection = .library) -> CoverDownloadJob {
        CoverDownloadJob(collection: collection, reference: .init(recordID: id, coverKey: "covers/\(id)"))
    }

    @Test func visibleItemsFollowPresentationOrderNotArrivalOrder() {
        let priority = CoverDownloadPriority()
        priority.activate(.library)
        priority.setOrder(["a", "b", "c", "d"], for: .library)
        priority.setVisible(true, id: "c", in: .library)
        priority.setVisible(true, id: "b", in: .library)
        var jobs = [job("d"), job("c"), job("a"), job("b")]
        var result: [String] = []
        while let index = priority.nextIndex(in: jobs) { result.append(jobs.remove(at: index).reference.recordID) }
        #expect(result == ["b", "c", "a", "d"])
    }

    @Test func pageAndSortChangesReprioritizeNextItemWithoutRestartingCurrent() throws {
        let priority = CoverDownloadPriority()
        priority.activate(.library)
        priority.setOrder(["a", "b"], for: .library)
        var jobs = [job("a"), job("b"), job("y", .wishlist), job("z", .wishlist)]
        let current = jobs.remove(at: try #require(priority.nextIndex(in: jobs)))
        priority.activate(.wishlist)
        priority.setOrder(["z", "y"], for: .wishlist)
        #expect(current.reference.recordID == "a")
        #expect(jobs[try #require(priority.nextIndex(in: jobs))].reference.recordID == "z")
        priority.setVisible(true, id: "y", in: .wishlist)
        #expect(jobs[try #require(priority.nextIndex(in: jobs))].reference.recordID == "y")
        priority.setVisible(false, id: "y", in: .wishlist)
        priority.setOrder(["y"], for: .wishlist)
        #expect(jobs[try #require(priority.nextIndex(in: jobs))].reference.recordID == "y")
    }

    @Test func settingsAndNoVisibleItemsKeepStableFallbackOrder() {
        let priority = CoverDownloadPriority()
        let jobs = [job("a"), job("b"), job("w", .wishlist)]
        priority.activate(nil)
        #expect(priority.nextIndex(in: jobs) == 0)
        priority.activate(.wishlist)
        priority.setOrder(["w", "w"], for: .wishlist)
        #expect(priority.nextIndex(in: jobs) == 2)
        #expect(priority.nextIndex(in: []) == nil)
        let session = priority.sessionRevision
        priority.cancelSession()
        #expect(priority.sessionRevision != session)
    }
}
