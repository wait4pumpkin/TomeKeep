import Foundation
import Testing
import TomeKeepDomain
@testable import TomeKeepPricing

struct PricingTests {
    @Test func dangdangSearchUsesLegacyChineseBytesAndEscapesDelimiters() {
        let url = RetailerPricingService.searchURL(channel: .dangdang, title: "康熙的红票")
        #expect(url.absoluteString.contains("key=%BF%B5%CE%F5%B5%C4%BA%EC%C6%B1"))
        #expect(url.absoluteString.contains("category_path=01.00.00.00.00.00"))
        let special = RetailerPricingService.searchURL(channel: .dangdang, title: "A&B+#")
        #expect(special.absoluteString.contains("key=%41%26%42%2B%23"))
        #expect(URLComponents(url: special, resolvingAgainstBaseURL: false)?.queryItems?.filter { $0.name == "key" }.count == 1)
    }

    @Test func productIdentityRejectsImpostorHostsAndUnsupportedNavigation() {
        #expect(PricingHTMLParser.productID(channel: .jd, url: URL(string: "https://item.jd.com/123.html")!) == "123")
        for raw in ["https://evil.test/item.jd.com/123.html", "https://item.jd.com.evil.test/123.html", "https://u:p@item.jd.com/123.html", "https://item.jd.com:999/123.html"] {
            #expect(PricingHTMLParser.productID(channel: .jd, url: URL(string: raw)!) == nil)
        }
    }

    @Test func verificationAssetsDoNotMakeOrdinaryPagesLookBlocked() {
        let ordinary = #"<script src="/verify.js"></script><a href="/captcha-help">帮助</a>"#
        #expect(!RetailerPricingService.requiresVerification(url: URL(string: "https://search.jd.com/Search")!, html: ordinary, channel: .jd))
        #expect(RetailerPricingService.requiresVerificationURL(URL(string: "https://cfe.m.jd.com/privatedomain/risk_handler/1/")!, channel: .jd))
        #expect(RetailerPricingService.requiresVerification(url: URL(string: "https://search.jd.com/Search")!, html: "请完成验证", channel: .jd))
    }

    @Test func renderedProductPriceRefreshesExistingQuoteWithoutStaticHTML() async throws {
        let url = URL(string: "https://item.jd.com/123.html")!
        let old = PriceQuote(channel: .jd, currency: "CNY", url: url, fetchedAt: .distantPast, status: .ok, priceCNY: 90, productID: "123", source: .manual)
        let service = RetailerPricingService(pageLoader: { requested, channel in
            #expect(requested == url)
            #expect(channel == .jd)
            return RetailerPageSnapshot(url: url, html: "<div style='display:none'>安全验证</div>", productPrice: 42.5)
        })
        let quote = try await service.capture(channel: .jd, title: "康熙的红票", author: nil, existingQuote: old)
        #expect(quote.priceCNY == 42.5)
        #expect(quote.url == url)
        #expect(quote.source == .manual)
    }

    @Test func renderedVerificationUsesActualRiskURLAndCancellationDoesNotSearchAgain() async {
        let risk = URL(string: "https://cfe.m.jd.com/privatedomain/risk_handler/1/")!
        let blocked = RetailerPricingService(pageLoader: { _, _ in RetailerPageSnapshot(url: risk, html: "") })
        await #expect(throws: RetailerPricingError.verificationRequired(risk)) {
            try await blocked.capture(channel: .jd, title: "三体", author: nil)
        }
        let cancelled = RetailerPricingService(pageLoader: { _, _ in throw CancellationError() })
        await #expect(throws: CancellationError.self) {
            try await cancelled.capture(channel: .jd, title: "三体", author: nil)
        }
    }

    @Test
    func pricingErrorsProvideEnglishDescriptions() {
        let english = Locale(identifier: "en")
        let chinese = Locale(identifier: "zh-Hans")
        #expect(RetailerPricingError.notFound.description(locale: english) == "No reliable offer for the same book was found.")
        #expect(RetailerPricingError.unavailable.description(locale: english) == "The retailer page is temporarily unavailable.")
        #expect(RetailerPricingError.notFound.description(locale: chinese) == "未找到可信的同书商品。")
    }

    @Test
    func dangdangHeaderLoginLinkDoesNotBlockPublicSearchResults() {
        let html = #"<a href="https://login.dangdang.com/signin.aspx">登录</a><a href="//product.dangdang.com/123.html">Book</a>"#
        #expect(!RetailerPricingService.requiresVerification(
            url: URL(string: "https://search.dangdang.com/?key=book")!,
            html: html,
            channel: .dangdang
        ))
        #expect(RetailerPricingService.requiresVerification(
            url: URL(string: "https://login.dangdang.com/signin.aspx")!,
            html: "",
            channel: .dangdang
        ))
    }

    @Test
    func parsesAllProductPriceFormats() {
        #expect(PricingHTMLParser.productPrice(channel: .jd, html: #"<span id="jd-price">¥49.00</span>"#) == 49)
        #expect(PricingHTMLParser.productPrice(channel: .dangdang, html: #"<span class="search_now_price">&yen;42.50</span>"#) == 42.5)
        #expect(PricingHTMLParser.productPrice(channel: .bookschina, html: #"<span class="sellPrice">￥39.80</span>"#) == 39.8)
    }

    @Test
    func parsesAndDeduplicatesSearchOffers() {
        let html = #"<a href="//item.jd.com/123.html"><span class="name">三体</span></a><span>¥59.90</span><a href="//item.jd.com/123.html">三体</a><span>¥59.90</span>"#
        let offers = PricingHTMLParser.offers(channel: .jd, html: html, limit: 8)
        #expect(offers.count == 1)
        #expect(offers.first?.priceCNY == 59.9)
    }

    @Test
    func bigramFallbackRejectsIrrelevantOffers() {
        let matching = PriceOffer(url: URL(string: "https://item.jd.com/1.html")!, priceCNY: 10, title: "三体全集")
        let irrelevant = PriceOffer(url: URL(string: "https://item.jd.com/2.html")!, priceCNY: 1, title: "厨房用品")
        #expect(PriceOfferMatcher.filter([matching, irrelevant], title: "三体", author: nil) == [matching])
    }

    @Test
    func ollamaMatcherUsesReturnedCandidateIndices() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PricingURLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        PricingURLProtocolStub.handler = { request in
            #expect(request.url?.absoluteString == "http://127.0.0.1:11434/api/generate")
            let body = #"{"response":"{\"matched\":[1]}"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body)
        }
        let offers = [
            PriceOffer(url: URL(string: "https://item.jd.com/1.html")!, priceCNY: 1, title: "无关"),
            PriceOffer(url: URL(string: "https://item.jd.com/2.html")!, priceCNY: 20, title: "三体"),
        ]
        let result = await PriceOfferMatchingService(session: session).filter(offers, title: "三体", author: nil)
        #expect(result == [offers[1]])
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["TOMEKEEP_RUN_LIVE_RETAILER_TESTS"] == "1"))
    func liveRetailerEndpointsReturnARecognizedOutcome() async {
        let service = RetailerPricingService()
        for channel in PriceChannel.allCases {
            do {
                let quote = try await service.capture(
                    channel: channel,
                    title: "中国农民调查",
                    author: "陈桂棣"
                )
                #expect(quote.channel == channel)
                #expect(quote.url.scheme == "https")
            } catch RetailerPricingError.verificationRequired {
                // A login or verification wall is a supported live-site outcome.
            } catch RetailerPricingError.notFound {
                // The endpoint loaded, but no candidate passed same-book matching.
            } catch {
                Issue.record("\(channel.rawValue) returned an unsupported live-site failure: \(error)")
            }
        }
    }
}

private final class PricingURLProtocolStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
