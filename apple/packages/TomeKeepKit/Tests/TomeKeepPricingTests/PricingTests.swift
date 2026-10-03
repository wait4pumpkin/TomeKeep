import Foundation
import Testing
import TomeKeepDomain
@testable import TomeKeepPricing

struct PricingTests {
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
