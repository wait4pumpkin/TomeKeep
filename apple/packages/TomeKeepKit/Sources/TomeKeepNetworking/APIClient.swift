import Foundation
import TomeKeepDomain

public enum APIClientError: LocalizedError, Sendable, Equatable {
    case invalidResponse
    case rejected(statusCode: Int, message: String?)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse: "服务器返回了无法识别的响应。"
        case let .rejected(statusCode, message): message ?? "请求失败（HTTP \(statusCode)）。"
        }
    }
}

public struct APIBookConflictError: LocalizedError, Sendable, Equatable {
    public let id: String
    public let reason: String
    public var errorDescription: String? { "书籍存在同步冲突。" }
}

public actor APIClient {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func data(
        for path: String,
        method: String = "GET",
        bearerToken: String?,
        body: Data? = nil,
        contentType: String? = nil
    ) async throws -> Data {
        let url = try requestURL(for: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        } else if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            let error = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            let message = error?.error
            if response.statusCode == 409, path.split(separator: "/").first == "books",
               let id = error?.id, !id.isEmpty, let message,
               message == "duplicate_isbn" || message == "stale_book" {
                throw APIBookConflictError(id: id, reason: message)
            }
            throw APIClientError.rejected(statusCode: response.statusCode, message: message)
        }
        return data
    }

    private func requestURL(for path: String) throws -> URL {
        let components = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let pathURL = baseURL.appending(path: String(components[0]))
        guard components.count == 2 else { return pathURL }

        var urlComponents = URLComponents(url: pathURL, resolvingAgainstBaseURL: false)
        urlComponents?.percentEncodedQuery = String(components[1])
        guard let url = urlComponents?.url else { throw APIClientError.invalidResponse }
        return url
    }

    public func request<Response: Decodable, Body: Encodable>(
        _ response: Response.Type,
        method: String,
        path: String,
        bearerToken: String?,
        body: Body
    ) async throws -> Response {
        let data = try await data(
            for: path,
            method: method,
            bearerToken: bearerToken,
            body: try JSONEncoder.tomeKeep.encode(body)
        )
        return try decode(Response.self, from: data, path: path)
    }

    public func request<Response: Decodable>(
        _ response: Response.Type,
        path: String,
        bearerToken: String?
    ) async throws -> Response {
        let responseData = try await data(for: path, bearerToken: bearerToken)
        return try decode(Response.self, from: responseData, path: path)
    }

    private func decode<Response: Decodable>(_ type: Response.Type, from data: Data, path: String) throws -> Response {
        do {
            return try JSONDecoder.tomeKeep.decode(type, from: data)
        } catch let error as DecodingError {
            throw APIResponseDecodingError(path: path, error: error)
        }
    }
}

/// Safe response diagnostics: endpoint and schema field only, never response values or tokens.
public struct APIResponseDecodingError: Error, Sendable, Equatable {
    public let endpoint: String
    public let field: String

    public init(path: String, error: DecodingError) {
        endpoint = path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        let keys: [any CodingKey]
        switch error {
        case let .keyNotFound(key, context): keys = context.codingPath + [key]
        case let .typeMismatch(_, context), let .valueNotFound(_, context), let .dataCorrupted(context):
            keys = context.codingPath
        @unknown default: keys = []
        }
        field = keys.map(\.stringValue).joined(separator: ".")
    }
}

private struct APIErrorBody: Decodable { var error: String?; var id: String? }

public extension JSONDecoder {
    static var tomeKeep: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

public extension JSONEncoder {
    static var tomeKeep: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
