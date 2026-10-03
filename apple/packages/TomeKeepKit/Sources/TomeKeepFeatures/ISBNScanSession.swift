import TomeKeepMetadata

enum ISBNScanAcceptance: Equatable {
    case accepted(String)
    case duplicate(String)
    case invalid
}

struct ISBNScanSession {
    private(set) var acceptedISBNs: Set<String> = []

    mutating func accept(_ rawValue: String) -> ISBNScanAcceptance {
        guard let normalized = ISBN(rawValue)?.isbn13 else { return .invalid }
        guard acceptedISBNs.insert(normalized).inserted else { return .duplicate(normalized) }
        return .accepted(normalized)
    }
}
