import Foundation
import TomeKeepPersistence

public enum CoverCollection: String, Sendable, Hashable {
    case library
    case wishlist
}

public struct CoverDownloadJob: Equatable, Sendable {
    public let collection: CoverCollection
    public let reference: LocalCoverReference

    public init(collection: CoverCollection, reference: LocalCoverReference) {
        self.collection = collection
        self.reference = reference
    }
}

/// Presentation hints only: never holds credentials, database objects or file contents.
@MainActor
public final class CoverDownloadPriority {
    private var active: CoverCollection?
    private var orders: [CoverCollection: [String]] = [:]
    private var visible: [CoverCollection: Set<String>] = [:]
    public private(set) var sessionRevision = 0

    public init() {}

    public func activate(_ collection: CoverCollection?) { active = collection }

    public func cancelSession() {
        sessionRevision += 1
        visible = [:]
    }

    public func setOrder(_ ids: [String], for collection: CoverCollection) {
        orders[collection] = ids
    }

    public func setVisible(_ isVisible: Bool, id: String, in collection: CoverCollection) {
        if isVisible { visible[collection, default: []].insert(id) }
        else { visible[collection, default: []].remove(id) }
    }

    public func nextIndex(in jobs: [CoverDownloadJob]) -> Int? {
        guard let active else { return jobs.indices.first }
        let ranks = Dictionary(orders[active, default: []].enumerated().map { ($1, $0) }, uniquingKeysWith: min)
        func rank(_ job: CoverDownloadJob) -> (Int, Int) {
            guard job.collection == active, let position = ranks[job.reference.recordID] else { return (2, 0) }
            return (visible[active, default: []].contains(job.reference.recordID) ? 0 : 1, position)
        }
        return jobs.indices.min { rank(jobs[$0]) < rank(jobs[$1]) }
    }
}
