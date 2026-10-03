import Foundation
import TomeKeepDomain

public struct PriceOffer: Equatable, Sendable {
    public var url: URL
    public var priceCNY: Double
    public var title: String?
    public var author: String?

    public init(url: URL, priceCNY: Double, title: String? = nil, author: String? = nil) {
        self.url = url
        self.priceCNY = priceCNY
        self.title = title
        self.author = author
    }
}

public enum RetailerPricingError: LocalizedError, Equatable, Sendable {
    case verificationRequired(URL)
    case notFound
    case unavailable

    public var errorDescription: String? {
        description()
    }

    public func description(locale: Locale? = nil) -> String {
        let key = switch self {
        case .verificationRequired: "书店要求登录或验证码，请完成后重试。"
        case .notFound: "未找到可信的同书商品。"
        case .unavailable: "书店页面暂时不可用。"
        }
        if let locale {
            var identifiers = [locale.identifier]
            if let language = locale.language.languageCode?.identifier, !identifiers.contains(language) {
                identifiers.append(language)
            }
            for identifier in identifiers {
                guard let url = Bundle.module.url(forResource: identifier, withExtension: "lproj"),
                      let bundle = Bundle(url: url)
                else { continue }
                return bundle.localizedString(forKey: key, value: key, table: nil)
            }
            return key
        }
        return String(localized: String.LocalizationValue(key), bundle: .module)
    }
}

/// Direct client-side retailer lookup. This never uses a TomeKeep server proxy.
public actor RetailerPricingService {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func capture(
        channel: PriceChannel,
        title: String,
        author: String?,
        existingQuote: PriceQuote? = nil
    ) async throws -> PriceQuote {
        if let existingQuote, existingQuote.productID != nil {
            do {
                let html = try await fetch(existingQuote.url, channel: channel)
                if let price = PricingHTMLParser.productPrice(channel: channel, html: html) {
                    return quote(channel: channel, url: existingQuote.url, price: price, source: existingQuote.source ?? .auto)
                }
            } catch RetailerPricingError.verificationRequired { throw RetailerPricingError.verificationRequired(existingQuote.url) }
            catch { /* Fall through to a fresh search. */ }
        }

        let searchURL = Self.searchURL(channel: channel, title: title)
        let html = try await fetch(searchURL, channel: channel)
        let offers = PricingHTMLParser.offers(channel: channel, html: html, limit: 8)
        let matches = await PriceOfferMatchingService().filter(offers, title: title, author: author)
        guard let best = matches.min(by: { $0.priceCNY < $1.priceCNY }) else {
            throw RetailerPricingError.notFound
        }
        return quote(channel: channel, url: best.url, price: best.priceCNY, source: .auto)
    }

    public static func searchURL(channel: PriceChannel, title: String) -> URL {
        var components: URLComponents
        switch channel {
        case .jd:
            components = URLComponents(string: "https://search.jd.com/Search")!
            components.queryItems = [
                URLQueryItem(name: "keyword", value: "书 \(title)"),
                URLQueryItem(name: "wtype", value: "1"),
                URLQueryItem(name: "enc", value: "utf-8"),
            ]
        case .dangdang:
            components = URLComponents(string: "https://search.dangdang.com/")!
            components.queryItems = [URLQueryItem(name: "key", value: title)]
        case .bookschina:
            components = URLComponents(string: "https://www.bookschina.com/book_find2/")!
            components.queryItems = [URLQueryItem(name: "stp", value: title), URLQueryItem(name: "sCate", value: "1")]
        }
        return components.url!
    }

    private func fetch(_ url: URL, channel: PriceChannel) async throws -> String {
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<400).contains(response.statusCode) else {
            throw RetailerPricingError.unavailable
        }
        let html = String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .init(rawValue: 0x80000632))
        guard let html else { throw RetailerPricingError.unavailable }
        if Self.requiresVerification(url: response.url ?? url, html: html, channel: channel) {
            throw RetailerPricingError.verificationRequired(response.url ?? url)
        }
        return html
    }

    private func quote(channel: PriceChannel, url: URL, price: Double, source: PriceQuoteSource) -> PriceQuote {
        PriceQuote(
            channel: channel,
            currency: "CNY",
            url: url,
            fetchedAt: .now,
            status: .ok,
            priceCNY: price,
            productID: PricingHTMLParser.productID(channel: channel, url: url),
            source: source
        )
    }

    static func requiresVerification(url: URL, html: String, channel: PriceChannel) -> Bool {
        let text = "\(url.absoluteString) \(html.prefix(80_000))".lowercased()
        if text.contains("captcha") || text.contains("verify") || text.contains("验证") { return true }
        let host = url.host?.lowercased() ?? ""
        switch channel {
        case .jd: return host == "passport.jd.com" || host.hasSuffix(".passport.jd.com") || text.contains("安全验证")
        case .dangdang: return host == "login.dangdang.com" || host.hasSuffix(".login.dangdang.com")
        case .bookschina: return host == "login.bookschina.com" || host.hasSuffix(".login.bookschina.com")
        }
    }
}

public enum PriceOfferMatcher {
    public static func filter(_ offers: [PriceOffer], title: String, author: String?) -> [PriceOffer] {
        offers.filter { offer in
            let titleScore = bigramSimilarity(offer.title ?? "", title)
            if titleScore >= 0.3 { return true }
            guard let author, !author.isEmpty else { return false }
            return bigramSimilarity(offer.author ?? "", author) >= 0.3
        }
    }

    public static func bigramSimilarity(_ lhs: String, _ rhs: String) -> Double {
        let left = bigrams(lhs)
        let right = bigrams(rhs)
        guard !left.isEmpty, !right.isEmpty else { return 0 }
        return Double(left.intersection(right).count * 2) / Double(left.count + right.count)
    }

    private static func bigrams(_ value: String) -> Set<String> {
        let normalized = value.lowercased().filter { !$0.isWhitespace }
        guard normalized.count > 1 else { return [] }
        let characters = Array(normalized)
        return Set((0..<(characters.count - 1)).map { String(characters[$0...($0 + 1)]) })
    }
}

/// Uses the local Ollama HTTP API when available and falls back to the
/// deterministic bigram matcher. No book data is sent to a cloud service.
public actor PriceOfferMatchingService {
    private let session: URLSession
    private let endpoint: URL

    public init(
        session: URLSession? = nil,
        endpoint: URL = URL(string: "http://127.0.0.1:11434/api/generate")!
    ) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.timeoutIntervalForResource = 15
            self.session = URLSession(configuration: configuration)
        }
        self.endpoint = endpoint
    }

    public func filter(_ offers: [PriceOffer], title: String, author: String?) async -> [PriceOffer] {
        guard !offers.isEmpty else { return [] }
        do {
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "model": "qwen2.5:3b",
                "prompt": Self.prompt(offers: offers, title: title, author: author),
                "stream": false,
            ])
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let output = body["response"] as? String,
                  let indices = Self.indices(from: output)
            else { throw RetailerPricingError.unavailable }
            return indices.compactMap { offers.indices.contains($0) ? offers[$0] : nil }
        } catch {
            return PriceOfferMatcher.filter(offers, title: title, author: author)
        }
    }

    private static func prompt(offers: [PriceOffer], title: String, author: String?) -> String {
        let candidates = offers.enumerated().map { index, offer in
            "\(index). 书名：\(offer.title ?? "(无标题)") 作者：\(offer.author ?? "(无作者)")"
        }.joined(separator: "\n")
        return """
        你是书店比价助手。用户查找的书名是：\(title)
        \(author.map { "作者：\($0)" } ?? "")
        候选列表：
        \(candidates)
        只选择与目标书名相同的候选；不同版本或出版社可以匹配，但主题相近、书名部分重叠或同一作者的其他书不能匹配。
        只返回一个 JSON 对象，matched 是匹配候选的整数索引数组。例如只有第 1 项匹配时返回 {"matched":[1]}；没有匹配时返回 {"matched":[]}。不要解释，也不要照抄示例。
        """
    }

    private static func indices(from output: String) -> [Int]? {
        guard let start = output.firstIndex(of: "{"), let end = output.lastIndex(of: "}") else { return nil }
        let fragment = String(output[start...end])
        guard let data = fragment.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = value["matched"] as? [Any]
        else { return nil }
        return raw.compactMap {
            if let number = $0 as? NSNumber { return number.intValue }
            if let string = $0 as? String { return Int(string) }
            return nil
        }
    }
}

public enum PricingHTMLParser {
    public static func offers(channel: PriceChannel, html: String, limit: Int) -> [PriceOffer] {
        switch channel {
        case .jd:
            return scan(
                html: html,
                linkPattern: #"href=[\"'](?:(https?:)?//)?(item\.jd\.com/\d+\.html)[\"']"#,
                base: "https://",
                limit: limit
            )
        case .dangdang:
            return scan(
                html: html,
                linkPattern: #"href=[\"'](?:(https?:)?//)?(product\.dangdang\.com/\d+\.html)[\"']"#,
                base: "https://",
                limit: limit
            )
        case .bookschina:
            return scan(
                html: html,
                linkPattern: #"href=[\"'](?:https?://(?:www|m)\.bookschina\.com)?/?(\d+\.htm)[\"']"#,
                base: "https://www.bookschina.com/",
                limit: limit,
                usesLastCaptureOnly: true
            )
        }
    }

    public static func productPrice(channel: PriceChannel, html: String) -> Double? {
        let patterns: [String]
        switch channel {
        case .jd:
            patterns = [#"id=[\"']jd-price[\"'][^>]*>\s*¥?\s*([0-9]+(?:\.[0-9]{1,2})?)"#, #"(?:J-p-|p-price|price-now)[\s\S]{0,160}?([0-9]+\.[0-9]{1,2})"#]
        case .dangdang:
            patterns = [#"id=[\"']dd-price[\"'][^>]*>\s*¥?\s*([0-9]+(?:\.[0-9]{1,2})?)"#, #"search_now_price[^0-9]+([0-9]+(?:\.[0-9]{1,2})?)"#]
        case .bookschina:
            patterns = [#"(?:sellPrice|salePrice|nowPrice)[^0-9]{0,30}([0-9]+(?:\.[0-9]{1,2})?)"#, #"(?:￥|¥)\s*([0-9]+(?:\.[0-9]{1,2})?)"#]
        }
        return firstPrice(html, patterns: patterns)
    }

    public static func productID(channel: PriceChannel, url: URL) -> String? {
        let pattern: String
        switch channel {
        case .jd: pattern = #"item\.jd\.com/(\d+)\.html"#
        case .dangdang: pattern = #"product\.dangdang\.com/(\d+)\.html"#
        case .bookschina: pattern = #"bookschina\.com/(\d+)\.htm"#
        }
        return capture(url.absoluteString, pattern: pattern, group: 1)
    }

    private static func scan(
        html: String,
        linkPattern: String,
        base: String,
        limit: Int,
        usesLastCaptureOnly: Bool = false
    ) -> [PriceOffer] {
        guard let regex = try? NSRegularExpression(pattern: linkPattern, options: [.caseInsensitive]) else { return [] }
        let matches = regex.matches(in: html, range: NSRange(html.startIndex..<html.endIndex, in: html))
        var seen = Set<URL>()
        var result: [PriceOffer] = []
        for match in matches {
            if result.count >= limit { break }
            let group = usesLastCaptureOnly ? match.numberOfRanges - 1 : 2
            guard let captureRange = Range(match.range(at: group), in: html) else { continue }
            let path = String(html[captureRange])
            guard let url = URL(string: base + path), seen.insert(url).inserted else { continue }
            guard let matchRange = Range(match.range, in: html) else { continue }
            let start = matchRange.lowerBound
            let end = html.index(start, offsetBy: 2_000, limitedBy: html.endIndex) ?? html.endIndex
            let snippet = String(html[start..<end])
            guard let price = firstPrice(snippet, patterns: [#"(?:¥|￥|&yen;)\s*([0-9]+(?:\.[0-9]{1,2})?)"#, #"(?:price|J-p-)[\s\S]{0,160}?([0-9]+\.[0-9]{1,2})"#]) else { continue }
            let title = capture(snippet, pattern: #"(?:title|bookname|name)[^>]*>[\s\S]{0,80}?([^<]{2,120})<"#, group: 1)?.cleanHTML
            let author = capture(snippet, pattern: #"(?:作者|author)[：:\s<][^>]*>?\s*([^<]{2,80})<"#, group: 1)?.cleanHTML
            result.append(PriceOffer(url: url, priceCNY: price, title: title, author: author))
        }
        return result
    }

    private static func firstPrice(_ value: String, patterns: [String]) -> Double? {
        for pattern in patterns {
            guard let raw = capture(value, pattern: pattern, group: 1), let price = Double(raw), price > 0 else { continue }
            return price
        }
        return nil
    }

    private static func capture(_ value: String, pattern: String, group: Int) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..<value.endIndex, in: value)),
              match.numberOfRanges > group,
              let range = Range(match.range(at: group), in: value)
        else { return nil }
        return String(value[range])
    }
}

private extension String {
    var cleanHTML: String {
        replacingOccurrences(of: #"<[^>]+>"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
