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
            let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
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
        return try JSONDecoder.tomeKeep.decode(Response.self, from: data)
    }

    public func request<Response: Decodable>(
        _ response: Response.Type,
        path: String,
        bearerToken: String?
    ) async throws -> Response {
        let responseData = try await data(for: path, bearerToken: bearerToken)
        return try JSONDecoder.tomeKeep.decode(Response.self, from: responseData)
    }
}

private struct APIErrorBody: Decodable { var error: String? }

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
