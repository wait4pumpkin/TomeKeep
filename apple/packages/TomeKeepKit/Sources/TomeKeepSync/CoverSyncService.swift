import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import TomeKeepNetworking
import TomeKeepPersistence

public enum CoverSyncError: LocalizedError, Equatable, Sendable {
    case unsupportedImage
    case imageTooLarge

    public var errorDescription: String? {
        switch self {
        case .unsupportedImage: "封面不是受支持的 JPEG、PNG、GIF 或 WebP 图片。"
        case .imageTooLarge: "封面压缩后仍超过 2 MB，无法同步。"
        }
    }
}

public actor CoverSyncService {
    private static let maximumUploadBytes = 2 * 1_024 * 1_024
    private static let maximumDownloadBytes = 4 * 1_024 * 1_024

    private let client: APIClient
    private let fileManager: FileManager
    private let coversDirectory: URL?

    public init(
        client: APIClient,
        fileManager: FileManager = .default,
        coversDirectory: URL? = nil
    ) {
        self.client = client
        self.fileManager = fileManager
        self.coversDirectory = coversDirectory
    }

    public func upload(fileName: String, bearerToken: String) async throws -> String {
        let source = try directory().appending(path: fileName)
        let original = try Data(contentsOf: source, options: [.mappedIfSafe])
        let prepared = try Self.preparedUpload(original)
        let boundary = "TomeKeep-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"cover.\(prepared.extension)\"\r\n".utf8))
        body.append(Data("Content-Type: \(prepared.mimeType)\r\n\r\n".utf8))
        body.append(prepared.data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        let response = try await client.data(
            for: "covers/upload",
            method: "POST",
            bearerToken: bearerToken,
            body: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        )
        return try JSONDecoder.tomeKeep.decode(CoverUploadResponse.self, from: response).coverKey
    }

    public func download(coverKey: String, bearerToken: String) async throws -> String {
        let encodedKey = coverKey
            .split(separator: "/")
            .map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
            .joined(separator: "/")
        let data = try await client.data(for: "covers/\(encodedKey)", bearerToken: bearerToken)
        guard data.count <= Self.maximumDownloadBytes else { throw CoverSyncError.imageTooLarge }
        guard let kind = Self.imageKind(data) else { throw CoverSyncError.unsupportedImage }

        let digest = SHA256.hash(data: Data(coverKey.utf8)).map { String(format: "%02x", $0) }.joined()
        let fileName = "sync-\(digest).\(kind.extension)"
        let destination = try directory().appending(path: fileName)
        if !fileManager.fileExists(atPath: destination.path) {
            try data.write(to: destination, options: [.atomic])
        }
        return fileName
    }

    private func directory() throws -> URL {
        if let coversDirectory {
            try fileManager.createDirectory(at: coversDirectory, withIntermediateDirectories: true)
            return coversDirectory
        }
        return try NativeStorageLocations.covers(fileManager: fileManager)
    }

    private static func preparedUpload(_ data: Data) throws -> (data: Data, mimeType: String, extension: String) {
        guard let kind = imageKind(data) else { throw CoverSyncError.unsupportedImage }
        if data.count <= maximumUploadBytes {
            return (data, kind.mimeType, kind.extension)
        }

        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            throw CoverSyncError.unsupportedImage
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 1_200,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw CoverSyncError.unsupportedImage
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else { throw CoverSyncError.unsupportedImage }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw CoverSyncError.unsupportedImage }
        let compressed = output as Data
        guard compressed.count <= maximumUploadBytes else { throw CoverSyncError.imageTooLarge }
        return (compressed, "image/jpeg", "jpg")
    }

    private static func imageKind(_ data: Data) -> (mimeType: String, extension: String)? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return ("image/jpeg", "jpg") }
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return ("image/png", "png") }
        if bytes.starts(with: [0x47, 0x49, 0x46, 0x38]) { return ("image/gif", "gif") }
        if bytes.count >= 12,
           String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF",
           String(bytes: bytes[8..<12], encoding: .ascii) == "WEBP" {
            return ("image/webp", "webp")
        }
        return nil
    }
}

private struct CoverUploadResponse: Decodable {
    var coverKey: String
}
