import Foundation
import Testing
@testable import TomeKeepNetworking
@testable import TomeKeepSync

@Suite(.serialized)
struct CoverSyncServiceTests {
    @Test
    func uploadsMultipartCoverAndReturnsKey() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data([0xFF, 0xD8, 0xFF, 0xD9]).write(to: directory.appending(path: "cover.jpg"))

        let session = makeSession { request in
            #expect(request.url?.path == "/api/covers/upload")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
            #expect(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
            return Self.response(request, body: #"{"cover_key":"covers/u1/abc.jpg"}"#)
        }
        let client = APIClient(baseURL: URL(string: "https://example.test/api/")!, session: session)
        let service = CoverSyncService(client: client, coversDirectory: directory)

        let key = try await service.upload(fileName: "cover.jpg", bearerToken: "secret")
        #expect(key == "covers/u1/abc.jpg")
    }

    @Test
    func downloadsAndCachesValidatedCover() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xD9])
        let session = makeSession { request in
            #expect(request.url?.path == "/api/covers/covers/u1/abc.jpg")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/jpeg"])!,
                jpeg
            )
        }
        let client = APIClient(baseURL: URL(string: "https://example.test/api/")!, session: session)
        let service = CoverSyncService(client: client, coversDirectory: directory)

        let fileName = try await service.download(coverKey: "covers/u1/abc.jpg", bearerToken: "secret")
        #expect(fileName.hasSuffix(".jpg"))
        #expect(try Data(contentsOf: directory.appending(path: fileName)) == jpeg)
    }

    private func makeSession(
        handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> URLSession {
        CoverURLProtocolStub.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CoverURLProtocolStub.self]
        return URLSession(configuration: configuration)
    }

    private static func response(_ request: URLRequest, body: String) -> (HTTPURLResponse, Data) {
        (
            HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
            Data(body.utf8)
        )
    }
}

private final class CoverURLProtocolStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let (response, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
