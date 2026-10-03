import Foundation
import Testing
@testable import TomeKeepMetadata

@Test func clipboardBookSeedRecognizesDoubanURLISBNAndTitle() throws {
    #expect(parseClipboardBookSeed(" https://book.douban.com/subject/1234567/?from=foo ") == .doubanURL(
        try #require(URL(string: "https://book.douban.com/subject/1234567/"))
    ))
    #expect(parseClipboardBookSeed("0-306-40615-2") == .isbn13("9780306406157"))
    #expect(parseClipboardBookSeed("  白痴  ") == .title("白痴"))
    #expect(parseClipboardBookSeed("   ") == nil)
}

struct MetadataParserTests {
    @Test
    func isbnSemanticsAndPublisherAreDerivedWithoutNetworkAccess() throws {
        let isbn = try #require(ISBN("9787115428028"))
        #expect(isbn.semantics == ISBNSemantics(region: "中国大陆", language: "中文"))
        #expect(isbn.inferredPublisher == "人民邮电出版社")
    }

    @Test
    func parsesDoubanSubjectWithoutRequiringISBN() throws {
        let html = """
        <html><head>
          <meta property="og:title" content="悉达多 (豆瓣)">
          <meta property="og:image" content="https://img2.doubanio.com/cover.jpg">
        </head><body>
          <div id="info">
            <span class="pl">作者:</span> [德] 赫尔曼·黑塞<br>
            <span class="pl">出版社:</span> 上海译文出版社<br>
          </div>
        </body></html>
        """
        let result = try HTMLParser.parseDouban(html)
        #expect(result.title == "悉达多")
        #expect(result.author == "[德] 赫尔曼·黑塞")
        #expect(result.publisher == "上海译文出版社")
        #expect(result.coverURL?.absoluteString == "https://img2.doubanio.com/cover.jpg")
    }

    @Test
    func parsesISBNSearchAndRejectsPlaceholderCover() throws {
        let html = """
        <div id="book">
          <div class="image"><img src="https://images.isbndb.com/covers/12/34/9780306406157.jpg"></div>
          <div class="bookinfo">
            <h1>A &amp; B</h1>
            <p><b>Author:</b> Someone</p>
            <p><strong>Publisher:</strong> Publisher, 2024</p>
          </div>
        </div>
        """
        let result = try HTMLParser.parseISBNSearch(html, isbn13: "9780306406157")
        #expect(result.title == "A & B")
        #expect(result.author == "Someone")
        #expect(result.publisher == "Publisher")
        #expect(result.coverURL == nil)
    }

    @Test
    func extractsUniqueDoubanCandidatesInPageOrder() {
        let html = """
        <a href="https://book.douban.com/subject/123/">A</a>
        <a href="https://www.douban.com/link2/?url=https%3A%2F%2Fbook.douban.com%2Fsubject%2F123%2F" onclick="moreurl(this,{sid: 123})">A duplicate</a>
        <a href="https://www.douban.com/link2/" onclick="moreurl(this,{sid: 456})">B</a>
        """
        let pattern = #"(?:(?:book\.douban\.com)(?:/|%2F)subject(?:/|%2F)|\bsid['\"]?\s*[:=]\s*['\"]?)(\d+)"#
        #expect(HTMLParser.captures(in: html, pattern: pattern, limit: 6) == ["123", "456"])
    }

    @Test
    func openLibraryFallbackUsesSupportedSearchAPI() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MetadataURLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        MetadataURLProtocolStub.handler = { request in
            if request.url?.host == "www.douban.com" {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!,
                    Data()
                )
            }
            #expect(request.url?.host == "openlibrary.org")
            #expect(request.url?.path == "/search.json")
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            #expect(query?.contains(URLQueryItem(name: "isbn", value: "9780980200447")) == true)
            let body = #"{"docs":[{"title":"Slow reading","author_name":["John Miedema"],"publisher":["Litwin Books"],"cover_i":5546156,"key":"/works/OL13694821W"}]}"#
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                Data(body.utf8)
            )
        }

        let result = try await MetadataLookupService(session: session).lookupISBN("9780980200447")
        #expect(result.source == .openLibrary)
        #expect(result.metadata.title == "Slow reading")
        #expect(result.metadata.author == "John Miedema")
        #expect(result.metadata.publisher == "Litwin Books")
        #expect(result.metadata.coverURL?.absoluteString == "https://covers.openlibrary.org/b/id/5546156-L.jpg")
        #expect(result.metadata.detailURL?.absoluteString == "https://openlibrary.org/works/OL13694821W")
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["TOMEKEEP_RUN_LIVE_METADATA_TESTS"] == "1"))
    func liveMetadataLookupAndDoubanSearchReturnUsableResults() async throws {
        let service = MetadataLookupService()
        let lookup = try await service.lookupISBN("9780980200447")
        #expect(lookup.metadata.title?.isEmpty == false)
        #expect(lookup.metadata.isbn13 == "9780980200447")

        let candidates = try await service.searchDouban(title: "活着", author: "余华")
        #expect(!candidates.isEmpty)
        #expect(candidates.contains { $0.title?.contains("活着") == true })
    }
}

private final class MetadataURLProtocolStub: URLProtocol, @unchecked Sendable {
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
