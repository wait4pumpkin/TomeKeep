import Foundation

public struct InviteCode: Decodable, Equatable, Identifiable, Sendable {
    public var id: String { code }
    public var code: String
    public var createdAt: String
    public var usedByUsername: String?
    public var usedAt: String?

    public init(code: String, createdAt: String, usedByUsername: String?, usedAt: String?) {
        self.code = code
        self.createdAt = createdAt
        self.usedByUsername = usedByUsername
        self.usedAt = usedAt
    }
}

public struct InvitePage: Decodable, Equatable, Sendable {
    public var items: [InviteCode]
    public var total: Int
    public var page: Int
    public var pageSize: Int
}

private struct CreatedInvite: Decodable { var code: String }
private struct EmptyBody: Encodable {}

public actor AdminService {
    private let client: APIClient
    private let tokenStore: KeychainTokenStore

    public init(baseURL: URL, tokenStore: KeychainTokenStore = .init()) {
        client = APIClient(baseURL: baseURL)
        self.tokenStore = tokenStore
    }

    public func invites(page: Int = 1) async throws -> InvitePage {
        try await client.request(
            InvitePage.self,
            path: "auth/invites?page=\(max(1, page))",
            bearerToken: try requiredToken()
        )
    }

    public func createInvite() async throws -> String {
        let result = try await client.request(
            CreatedInvite.self,
            method: "POST",
            path: "auth/invite",
            bearerToken: try requiredToken(),
            body: EmptyBody()
        )
        return result.code
    }

    public func deleteInvite(code: String) async throws {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard let encoded = code.addingPercentEncoding(withAllowedCharacters: allowed), !encoded.isEmpty else {
            throw AdminServiceError.invalidCode
        }
        _ = try await client.data(
            for: "auth/invites/\(encoded)",
            method: "DELETE",
            bearerToken: try requiredToken()
        )
    }

    private func requiredToken() throws -> String {
        guard let token = try tokenStore.load() else { throw AdminServiceError.notAuthenticated }
        return token
    }
}

public enum AdminServiceError: LocalizedError, Equatable, Sendable {
    case notAuthenticated
    case invalidCode

    public var errorDescription: String? {
        switch self {
        case .notAuthenticated: "请先登录管理员账户。"
        case .invalidCode: "邀请码格式无效。"
        }
    }
}
