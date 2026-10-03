import Foundation

public struct BookMetadata: Equatable, Sendable {
    public var isbn13: String?
    public var title: String?
    public var author: String?
    public var publisher: String?
    public var coverURL: URL?
    public var detailURL: URL?

    public init(
        isbn13: String? = nil,
        title: String? = nil,
        author: String? = nil,
        publisher: String? = nil,
        coverURL: URL? = nil,
        detailURL: URL? = nil
    ) {
        self.isbn13 = isbn13
        self.title = title
        self.author = author
        self.publisher = publisher
        self.coverURL = coverURL
        self.detailURL = detailURL
    }
}

public enum MetadataSource: String, Sendable {
    case douban
    case openLibrary
    case isbnSearch
}

public struct MetadataLookup: Equatable, Sendable {
    public var metadata: BookMetadata
    public var source: MetadataSource

    public init(metadata: BookMetadata, source: MetadataSource) {
        self.metadata = metadata
        self.source = source
    }
}

public enum ClipboardBookSeed: Equatable, Sendable {
    case doubanURL(URL)
    case isbn13(String)
    case title(String)
}

public func parseClipboardBookSeed(_ input: String) -> ClipboardBookSeed? {
    let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }

    if let components = URLComponents(string: value),
       components.host?.lowercased() == "book.douban.com" {
        let parts = components.path.split(separator: "/")
        if parts.count >= 2,
           parts[0].lowercased() == "subject",
           !parts[1].isEmpty,
           parts[1].allSatisfy(\.isNumber),
           let url = URL(string: "https://book.douban.com/subject/\(parts[1])/") {
            return .doubanURL(url)
        }
    }

    if let isbn = ISBN(value) {
        return .isbn13(isbn.isbn13)
    }
    return .title(value)
}

public enum MetadataLookupError: LocalizedError, Equatable, Sendable {
    case invalidISBN
    case notFound
    case verificationRequired(URL)
    case unavailable

    public var errorDescription: String? {
        switch self {
        case .invalidISBN: "ISBN 格式或校验位不正确。"
        case .notFound: "未在元数据来源中找到这本书。"
        case .verificationRequired: "isbnsearch 需要在可见网页中完成验证。"
        case .unavailable: "元数据服务暂时不可用，请稍后再试或手工录入。"
        }
    }
}

/// Performs the same client-side lookup waterfall as the legacy desktop app.
/// No TomeKeep server endpoint is involved.
public actor MetadataLookupService {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func lookupISBN(_ input: String) async throws -> MetadataLookup {
        guard let isbn = ISBN(input) else { throw MetadataLookupError.invalidISBN }
        let isbn13 = isbn.isbn13
        if let result = try? await lookupDouban(isbn13: isbn13) { return result }
        if let result = try? await lookupOpenLibrary(isbn13: isbn13) { return result }
        do { return try await lookupISBNSearch(isbn13: isbn13) }
        catch let error as MetadataLookupError { throw error }
        catch { throw MetadataLookupError.unavailable }
    }

    public func lookupDoubanURL(_ url: URL) async throws -> MetadataLookup {
        guard case .doubanURL(let canonicalURL) = parseClipboardBookSeed(url.absoluteString) else {
            throw MetadataLookupError.notFound
        }
        let detailHTML = try await html(from: canonicalURL, referer: "https://book.douban.com/")
        var metadata = try HTMLParser.parseDouban(detailHTML)
        metadata.detailURL = canonicalURL
        return MetadataLookup(metadata: metadata, source: .douban)
    }

    public func searchDouban(title: String, author: String? = nil) async throws -> [BookMetadata] {
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedTitle.isEmpty else { return [] }
        var components = URLComponents(string: "https://www.douban.com/search")!
        components.queryItems = [
            URLQueryItem(name: "cat", value: "1001"),
            URLQueryItem(name: "q", value: [normalizedTitle, author?.trimmingCharacters(in: .whitespacesAndNewlines)]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")),
        ]
        let searchHTML = try await html(from: components.url!, referer: "https://book.douban.com/")
        let subjectIDs = HTMLParser.captures(
            in: searchHTML,
            pattern: #"(?:(?:book\.douban\.com)(?:/|%2F)subject(?:/|%2F)|\bsid['\"]?\s*[:=]\s*['\"]?)(\d+)"#,
            limit: 6
        )
        var results: [BookMetadata] = []
        for subjectID in subjectIDs {
            let detailURL = URL(string: "https://book.douban.com/subject/\(subjectID)/")!
            guard let detailHTML = try? await html(from: detailURL, referer: "https://book.douban.com/"),
                  var metadata = try? HTMLParser.parseDouban(detailHTML)
            else { continue }
            metadata.detailURL = detailURL
            results.append(metadata)
        }
        if results.isEmpty { throw MetadataLookupError.notFound }
        return results
    }

    private func lookupDouban(isbn13: String) async throws -> MetadataLookup {
        var components = URLComponents(string: "https://www.douban.com/search")!
        components.queryItems = [
            URLQueryItem(name: "cat", value: "1001"),
            URLQueryItem(name: "q", value: isbn13),
        ]
        let searchHTML = try await html(from: components.url!, referer: "https://book.douban.com/")
        guard let subjectID = HTMLParser.firstCapture(
            in: searchHTML,
            patterns: [#"\bsid[：:\s]+(\d+)"#, #"book\.douban\.com/subject/(\d+)"#]
        ) else { throw MetadataLookupError.notFound }
        let detailURL = URL(string: "https://book.douban.com/subject/\(subjectID)/")!
        let detailHTML = try await html(from: detailURL, referer: "https://book.douban.com/")
        var metadata = try HTMLParser.parseDouban(detailHTML)
        metadata.isbn13 = metadata.isbn13 ?? isbn13
        metadata.detailURL = detailURL
        return MetadataLookup(metadata: metadata, source: .douban)
    }

    private func lookupOpenLibrary(isbn13: String) async throws -> MetadataLookup {
        var components = URLComponents(string: "https://openlibrary.org/search.json")!
        components.queryItems = [
            URLQueryItem(name: "isbn", value: isbn13),
            URLQueryItem(name: "fields", value: "title,author_name,publisher,cover_i,key"),
            URLQueryItem(name: "limit", value: "1"),
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 15
        request.setValue("TomeKeep/0.1", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response)
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let record = (root["docs"] as? [[String: Any]])?.first
        else { throw MetadataLookupError.notFound }
        let joined: (Any?) -> String? = { value in
            (value as? [String])?.joined(separator: ", ").nilIfEmpty
        }
        let coverURL = (record["cover_i"] as? NSNumber).flatMap {
            URL(string: "https://covers.openlibrary.org/b/id/\($0.intValue)-L.jpg")
        }
        let detailURL = (record["key"] as? String).flatMap {
            URL(string: "https://openlibrary.org\($0)")
        }
        let metadata = BookMetadata(
            isbn13: isbn13,
            title: record["title"] as? String,
            author: joined(record["author_name"]),
            publisher: joined(record["publisher"]),
            coverURL: coverURL,
            detailURL: detailURL
        )
        return MetadataLookup(metadata: metadata, source: .openLibrary)
    }

    private func lookupISBNSearch(isbn13: String) async throws -> MetadataLookup {
        let url = URL(string: "https://isbnsearch.org/isbn/\(isbn13)")!
        let page = try await html(from: url, referer: "https://isbnsearch.org/")
        let lowered = page.lowercased()
        if lowered.contains("captcha") || lowered.contains("cf-chl-") || lowered.contains("challenge-platform") {
            throw MetadataLookupError.verificationRequired(url)
        }
        var metadata = try HTMLParser.parseISBNSearch(page, isbn13: isbn13)
        metadata.detailURL = url
        return MetadataLookup(metadata: metadata, source: .isbnSearch)
    }

    private func html(from url: URL, referer: String) async throws -> String {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
        request.setValue(referer, forHTTPHeaderField: "Referer")
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response)
        guard let value = String(data: data, encoding: .utf8) else { throw MetadataLookupError.unavailable }
        return value
    }

    private static func validate(response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw MetadataLookupError.unavailable
        }
    }
}

enum HTMLParser {
    static func parseDouban(_ html: String) throws -> BookMetadata {
        let title = firstCapture(in: html, patterns: [
            #"<span[^>]*\bproperty=[\"']v:itemreviewed[\"'][^>]*>([^<]+)</span>"#,
            #"<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']"#,
            #"<title[^>]*>([^<]+)</title>"#,
        ])?.replacingOccurrences(of: " (豆瓣)", with: "")
        let cover = firstCapture(in: html, patterns: [
            #"<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)[\"']"#,
            #"<div[^>]*\bid=[\"']mainpic[\"'][^>]*>[\s\S]*?<img[^>]*\bsrc=[\"']([^\"']+)[\"']"#,
        ])
        let author = infoValue(html, label: "作者")
        let publisher = infoValue(html, label: "出版社")
        let isbn = infoValue(html, label: "ISBN").flatMap(ISBN.init)?.isbn13
        guard title != nil || isbn != nil else { throw MetadataLookupError.notFound }
        return BookMetadata(
            isbn13: isbn,
            title: title.map(decodeEntities),
            author: author,
            publisher: publisher,
            coverURL: cover.flatMap(URL.init(string:))
        )
    }

    static func parseISBNSearch(_ html: String, isbn13: String) throws -> BookMetadata {
        guard let rawTitle = firstCapture(in: html, patterns: [#"<div[^>]+class=[\"']bookinfo[\"'][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)</h1>"#]) else {
            throw MetadataLookupError.notFound
        }
        let author = firstCapture(in: html, patterns: [#"Author:\s*</(?:b|strong)>\s*([\s\S]*?)</p>"#, #"Author:\s*([\s\S]*?)</p>"#]).map(cleanText)
        let publisher = firstCapture(in: html, patterns: [#"Publisher:\s*</(?:b|strong)>\s*([\s\S]*?)</p>"#, #"Publisher:\s*([\s\S]*?)</p>"#])
            .map(cleanText)?.replacingOccurrences(of: #",\s*\d{4}.*$"#, with: "", options: .regularExpression)
        let cover = firstCapture(in: html, patterns: [#"<div[^>]+class=[\"']image[\"'][^>]*>[\s\S]*?<img[^>]+src=[\"']([^\"']+)[\"']"#])
        let validCover = cover.flatMap { isPlaceholder($0) ? nil : URL(string: $0) }
        return BookMetadata(isbn13: isbn13, title: cleanText(rawTitle), author: author, publisher: publisher, coverURL: validCover)
    }

    static func firstCapture(in value: String, patterns: [String]) -> String? {
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let range = NSRange(value.startIndex..<value.endIndex, in: value)
            guard let match = regex.firstMatch(in: value, range: range), match.numberOfRanges > 1,
                  let capture = Range(match.range(at: 1), in: value) else { continue }
            let result = String(value[capture]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !result.isEmpty { return decodeEntities(result) }
        }
        return nil
    }

    static func captures(in value: String, pattern: String, limit: Int) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let matches = regex.matches(in: value, range: NSRange(value.startIndex..<value.endIndex, in: value))
        var seen = Set<String>()
        var values: [String] = []
        for match in matches where match.numberOfRanges > 1 {
            guard let range = Range(match.range(at: 1), in: value) else { continue }
            let capture = String(value[range])
            if seen.insert(capture).inserted { values.append(capture) }
            if values.count == limit { break }
        }
        return values
    }

    private static func infoValue(_ html: String, label: String) -> String? {
        firstCapture(in: html, patterns: [#"<span[^>]*class=[\"']pl[\"'][^>]*>\s*\#(label)\s*:?\s*</span>\s*:?\s*([\s\S]*?)(?:<br\s*/?>|$)"#])
            .map(cleanText)
    }

    private static func cleanText(_ value: String) -> String {
        decodeEntities(value.replacingOccurrences(of: #"<[^>]+>"#, with: " ", options: .regularExpression))
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func decodeEntities(_ value: String) -> String {
        value.replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
    }

    private static func isPlaceholder(_ value: String) -> Bool {
        value.range(of: #"images\.isbndb\.com/covers/[^/]{1,4}/[^/]{1,4}/|doubanio\.com/.*book-default-[ls]pic"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
