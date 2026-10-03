import Foundation
import Testing
@testable import TomeKeepNetworking

@Suite(.serialized)
struct APIClientTests {
    @Test
    func sendsBearerAndDecodesSnakeCase() async throws {
        let session = makeSession { request in
            #expect(request.url?.absoluteString == "https://example.test/api/auth/me")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
            let body = #"{"id":"u1","username":"alice","name":"Alice","language":"zh","is_admin":true}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body)
        }
        let client = APIClient(baseURL: URL(string: "https://example.test/api/")!, session: session)
        let user = try await client.request(AuthUser.self, path: "auth/me", bearerToken: "secret")
        #expect(user.isAdmin)
        #expect(user.username == "alice")
    }

    @Test
    func preservesServerErrorMessage() async throws {
        let session = makeSession { request in
            let body = #"{"error":"invalid_credentials"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, body)
        }
        let client = APIClient(baseURL: URL(string: "https://example.test/api/")!, session: session)
        await #expect(throws: APIClientError.rejected(statusCode: 401, message: "invalid_credentials")) {
            _ = try await client.data(for: "auth/me", bearerToken: "bad")
        }
    }

    @Test
    func preservesIncrementalSyncQuery() async throws {
        let session = makeSession { request in
            #expect(request.url?.path == "/api/books")
            #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems == [
                URLQueryItem(name: "since", value: "2026-09-24T08:00:00Z")
            ])
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("[]".utf8))
        }
        let client = APIClient(baseURL: URL(string: "https://example.test/api/")!, session: session)
        let rows = try await client.request([AuthUser].self, path: "books?since=2026-09-24T08%3A00%3A00Z", bearerToken: "secret")
        #expect(rows.isEmpty)
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["TOMEKEEP_LOCAL_API_BASE_URL"] != nil))
    func localAPIAuthenticatesAdminAndUserAndRestoresSessions() async throws {
        let rawBaseURL = try #require(ProcessInfo.processInfo.environment["TOMEKEEP_LOCAL_API_BASE_URL"])
        let baseURL = try #require(URL(string: rawBaseURL))

        let adminStore = KeychainTokenStore(
            service: "com.tomekeep.tests.\(UUID().uuidString)",
            account: "admin"
        )
        defer { try? adminStore.delete() }
        let adminAuth = AuthenticationService(baseURL: baseURL, tokenStore: adminStore)
        let admin = try await adminAuth.login(username: "admin", password: "admin")
        #expect(admin.username == "admin")
        #expect(admin.isAdmin)
        #expect(try await adminAuth.restoredUser() == admin)
        let invites = try await AdminService(baseURL: baseURL, tokenStore: adminStore).invites()
        #expect(invites.page == 1)
        #expect(invites.total >= invites.items.count)

        let userStore = KeychainTokenStore(
            service: "com.tomekeep.tests.\(UUID().uuidString)",
            account: "user"
        )
        defer { try? userStore.delete() }
        let userAuth = AuthenticationService(baseURL: baseURL, tokenStore: userStore)
        let user = try await userAuth.login(username: "mushroom", password: "mushroom")
        #expect(user.username == "mushroom")
        #expect(!user.isAdmin)
        #expect(try await userAuth.restoredUser() == user)
    }

    private func makeSession(
        handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> URLSession {
        URLProtocolStub.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return URLSession(configuration: configuration)
    }
}

private final class URLProtocolStub: URLProtocol, @unchecked Sendable {
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
