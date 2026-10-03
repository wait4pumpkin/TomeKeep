import Foundation
import Security

public struct AuthUser: Codable, Equatable, Sendable {
    public var id: String
    public var username: String
    public var name: String
    public var language: String
    public var isAdmin: Bool

    public init(id: String, username: String, name: String, language: String, isAdmin: Bool) {
        self.id = id
        self.username = username
        self.name = name
        self.language = language
        self.isAdmin = isAdmin
    }
}

private struct LoginRequest: Codable { var username: String; var password: String }
private struct RegisterRequest: Codable {
    var username: String
    var password: String
    var name: String
    var inviteCode: String
}
private struct LoginResponse: Codable { var token: String }

public actor AuthenticationService {
    private let client: APIClient
    private let tokenStore: KeychainTokenStore

    public init(baseURL: URL, tokenStore: KeychainTokenStore = .init()) {
        client = APIClient(baseURL: baseURL)
        self.tokenStore = tokenStore
    }

    public func login(username: String, password: String) async throws -> AuthUser {
        let response = try await client.request(
            LoginResponse.self,
            method: "POST",
            path: "auth/login",
            bearerToken: nil,
            body: LoginRequest(username: username, password: password)
        )
        try tokenStore.save(response.token)
        return try await currentUser(token: response.token)
    }

    public func register(
        username: String,
        password: String,
        name: String,
        inviteCode: String
    ) async throws -> AuthUser {
        let response = try await client.request(
            LoginResponse.self,
            method: "POST",
            path: "auth/register",
            bearerToken: nil,
            body: RegisterRequest(
                username: username,
                password: password,
                name: name,
                inviteCode: inviteCode
            )
        )
        try tokenStore.save(response.token)
        return try await currentUser(token: response.token)
    }

    public func restoredUser() async throws -> AuthUser? {
        guard let token = try tokenStore.load() else { return nil }
        do { return try await currentUser(token: token) }
        catch APIClientError.rejected(statusCode: 401, message: _) {
            try? tokenStore.delete()
            return nil
        }
    }

    public func token() throws -> String? { try tokenStore.load() }

    public func logout() throws { try tokenStore.delete() }

    private func currentUser(token: String) async throws -> AuthUser {
        try await client.request(AuthUser.self, path: "auth/me", bearerToken: token)
    }
}

public struct KeychainTokenStore: Sendable {
    private let service: String
    private let account: String

    public init(service: String = "com.tomekeep.native", account: String = "sync-token") {
        self.service = service
        self.account = account
    }

    public func save(_ token: String) throws {
        try? delete()
        let status = SecItemAdd([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData: Data(token.utf8),
        ] as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func load() throws -> String? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ] as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8)
        else { throw KeychainError(status: status) }
        return token
    }

    public func delete() throws {
        let status = SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

public struct KeychainError: LocalizedError, Sendable {
    public let status: OSStatus
    public var errorDescription: String? { "无法访问钥匙串（\(status)）。" }
}
