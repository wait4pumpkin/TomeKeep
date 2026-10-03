import CryptoKit
import Foundation

public enum CoverCacheError: Error, Equatable, Sendable {
    case invalidResponse
    case unsupportedImage
    case imageTooLarge
}

public actor CoverCacheService {
    private let session: URLSession
    private let maximumBytes = 10 * 1_024 * 1_024

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func cache(remoteURL: URL, recordID: String) async throws -> String {
        guard remoteURL.scheme == "https" else { throw CoverCacheError.invalidResponse }
        var request = URLRequest(url: remoteURL)
        request.timeoutInterval = 20
        request.setValue("Mozilla/5.0 AppleWebKit/605.1.15", forHTTPHeaderField: "User-Agent")
        if remoteURL.host?.hasSuffix("doubanio.com") == true {
            request.setValue("https://book.douban.com/", forHTTPHeaderField: "Referer")
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode)
        else { throw CoverCacheError.invalidResponse }
        guard data.count <= maximumBytes else { throw CoverCacheError.imageTooLarge }
        guard let fileExtension = Self.detectedExtension(data) else { throw CoverCacheError.unsupportedImage }

        let digest = SHA256.hash(data: Data("\(recordID)|\(remoteURL.absoluteString)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        let fileName = "\(digest).\(fileExtension)"
        let destination = try NativeStorageLocations.covers().appending(path: fileName)
        if !FileManager.default.fileExists(atPath: destination.path) {
            try data.write(to: destination, options: [.atomic])
        }
        return fileName
    }

    private static func detectedExtension(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "jpg" }
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "png" }
        if bytes.starts(with: [0x47, 0x49, 0x46, 0x38]) { return "gif" }
        if bytes.count >= 12,
           String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF",
           String(bytes: bytes[8..<12], encoding: .ascii) == "WEBP" { return "webp" }
        return nil
    }
}
