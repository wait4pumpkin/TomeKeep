import Foundation
import SwiftData
import Testing
import TomeKeepDomain
import TomeKeepPersistence
@testable import TomeKeepSync

@MainActor
@Suite(.serialized)
struct BookConflictSynchronizationTests {
    @Test func duplicateAliasIsJournaledMergedAndDoesNotBlockOtherBooks() async throws {
        let instant = Date(timeIntervalSince1970: 1_700_000_000)
        let config = ModelConfiguration(schema: PersistenceConfiguration.schema, isStoredInMemoryOnly: true)
        let context = try ModelContext(ModelContainer(for: PersistenceConfiguration.schema, configurations: [config]))
        let canonical = Book(id: "canonical", title: "Dune", author: "Author", isbn: "9780306406157", tags: ["Cloud"], addedAt: instant, updatedAt: instant, syncStatus: .synced)
        let alias = Book(id: "alias", title: "Dune", author: "Author", isbn: "0306406152", tags: ["Phone"], addedAt: instant, updatedAt: instant)
        let other = Book(id: "other", title: "Other", author: "Author", isbn: "9781841591049", addedAt: instant, updatedAt: instant)
        for book in [canonical, alias, other] { context.insert(StoredBook(book: book)) }
        try context.save()
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let paths = LockedPaths()
        let session = makeSession { request in
            let path = request.url?.path ?? ""
            let method = request.httpMethod ?? "GET"
            paths.append("\(method) \(path)")
            if method == "GET", path == "/api/books/canonical" {
                return Self.response(request, 200, #"{"id":"canonical","title":"Dune","author":"Author","isbn":"9780306406157","tags":["Cloud"],"added_at":"2023-11-14T22:13:20Z","updated_at":"2023-11-14T22:13:20Z","revision":1}"#)
            }
            if method == "GET", path == "/api/books/alias" { return Self.response(request, 404, #"{"error":"not_found"}"#) }
            if method == "GET", path == "/api/books" {
                return Self.response(request, 200, #"[{"id":"canonical","title":"Dune","author":"Author","isbn":"9780306406157","tags":["Cloud"],"added_at":"2023-11-14T22:13:20Z","updated_at":"2023-11-14T22:13:20Z","revision":1}]"#)
            }
            if method == "PUT", path == "/api/books/canonical" {
                let payload = (try? JSONSerialization.jsonObject(with: Self.body(request))) as? [String: Any]
                #expect(payload?["expected_revision"] as? Int == 1)
                #expect(payload?["tags"] as? [String] == ["Cloud", "Phone"])
                return Self.response(request, 200, #"{"id":"canonical","title":"Dune","author":"Author","isbn":"9780306406157","tags":["Cloud","Phone"],"added_at":"2023-11-14T22:13:20Z","updated_at":"2023-11-14T22:13:21Z","revision":2}"#)
            }
            if method == "PUT", path == "/api/books/other" { return Self.response(request, 404, #"{"error":"not_found"}"#) }
            if method == "POST", path == "/api/books" {
                return Self.response(request, 201, #"{"id":"other","title":"Other","author":"Author","isbn":"9781841591049","tags":[],"added_at":"2023-11-14T22:13:20Z","updated_at":"2023-11-14T22:13:20Z","revision":1}"#)
            }
            Issue.record("Unexpected request \(method) \(path)")
            return Self.response(request, 500, #"{"error":"unexpected"}"#)
        }
        let engine = NativeSyncEngine(baseURL: URL(string: "https://example.test/api/")!, session: session, conflictStoreDirectory: directory)
        _ = try await engine.push(repository: LocalSyncRepository(context: context), token: "token", accountID: "u1")
        let active = try BookRepository(context: context).books()
        #expect(Set(active.map(\.id)) == ["canonical", "other"])
        #expect(active.first { $0.id == "canonical" }?.tags == ["Cloud", "Phone"])
        #expect(try LocalSyncRepository(context: context).pendingBooks().isEmpty)
        let journal = try BookConflictStore(accountID: "u1", directory: directory).entries()
        #expect(journal.count == 1 && journal[0].completed)
        #expect(!paths.value.contains { $0 == "DELETE /api/books/alias" })
        #expect(paths.value.contains("POST /api/books"))
    }

    private func makeSession(handler: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data)) -> URLSession {
        ConflictURLProtocol.handler = handler
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ConflictURLProtocol.self]
        return URLSession(configuration: config)
    }

    nonisolated private static func response(_ request: URLRequest, _ status: Int, _ json: String) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(json.utf8))
    }

    nonisolated private static func body(_ request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            result.append(buffer, count: count)
        }
        return result
    }
}

private final class LockedPaths: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []
    func append(_ value: String) { lock.lock(); defer { lock.unlock() }; storage.append(value) }
    var value: [String] { lock.lock(); defer { lock.unlock() }; return storage }
}

private final class ConflictURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (response, data) = Self.handler!(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
