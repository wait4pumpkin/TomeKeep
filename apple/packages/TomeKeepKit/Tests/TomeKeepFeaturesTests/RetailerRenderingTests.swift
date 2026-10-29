import Foundation
import Testing
import TomeKeepDomain
import TomeKeepPricing
#if os(macOS)
import WebKit
#endif
@testable import TomeKeepFeatures

struct RetailerRenderingTests {
    @Test func retailerNavigationUpgradesHTTPWithoutAllowingForeignHosts() {
        #expect(RetailerBrowserPolicy.normalizedURL(URL(string: "http://product.dangdang.com/123.html")!)?.absoluteString == "https://product.dangdang.com/123.html")
        for raw in ["https://jd.com.evil.test/", "http://127.0.0.1/", "file:///etc/hosts", "https://user:pass@item.jd.com/123.html", "https://jd.com:8443/"] {
            #expect(RetailerBrowserPolicy.normalizedURL(URL(string: raw)!) == nil)
        }
        #expect(RetailerBrowserPolicy.normalizedURL(URL(string: "https://passport.jd.com/new/login.aspx")!) != nil)
    }

    @Test func renderedSnapshotFiltersUntrustedAndNonPositiveOffers() throws {
        let raw = #"{"html":"<div></div>","productPrice":42.5,"offers":[{"url":"http://item.jd.com/123.html","price":42.5,"title":"三体"},{"url":"https://item.jd.com.evil.test/123.html","price":1},{"url":"https://item.jd.com/456.html","price":0}]}"#
        let result = try JSONDecoder().decode(RenderedRetailerSnapshot.self, from: Data(raw.utf8)).page(url: URL(string: "https://search.jd.com/Search")!, channel: .jd)
        #expect(result.offers.count == 1)
        #expect(result.offers.first?.url.absoluteString == "https://item.jd.com/123.html")
        #expect(result.productPrice == 42.5)
    }

    @Test func browserFailuresExposeSafeDiagnosticCodesNotPrivateURLs() {
        let error = URLError(.cannotFindHost, userInfo: [NSURLErrorFailingURLStringErrorKey: "https://private.example/?token=secret"])
        let result = RetailerBrowserPolicy.errorMessage(error)
        #expect(result.contains("NSURLErrorDomain"))
        #expect(result.contains("-1003"))
        #expect(!result.contains("secret"))
        #expect(!result.contains("private.example"))
    }

#if os(macOS)
    @Test @MainActor func delayedJDCardAndStructuredProductPricesAreParsed() async throws {
        let fixture = #"""
        <html><body><form><input value="private-test-token"></form><div id="app"></div>
        <script>setTimeout(() => { document.getElementById('app').innerHTML = '<div data-sku="123"><div title="三体"><span class="product_price_hash">¥<span>89</span><span>.90</span></span></div></div>'; }, 75);</script></body></html>
        """#
        let page = try await renderFixture(fixture, waitForOffer: true)
        #expect(page.offers.first?.price == 89.9)
        #expect(page.offers.first?.title == "三体")
        #expect(!page.html.contains("private-test-token"))
        let structured = #"<html><body><script type="application/ld+json">[{"@graph":[{"offers":[{"price":"21.50"}]}]}]</script></body></html>"#
        let product = try await renderFixture(structured, waitForOffer: false)
        #expect(product.productPrice == 21.5)
        let dangdang = try await renderFixture(#"<html><body><ul><li><p class="name"><a href="https://product.dangdang.com/123.html" title="批判性思维">批判性思维</a></p><span class="price_n">￥79.30</span></li></ul></body></html>"#, waitForOffer: true)
        #expect(dangdang.offers.first?.price == 79.3)
        #expect(dangdang.offers.first?.title == "批判性思维")
        let jd = try await renderFixture(#"<html><body><li><div class="p-name"><a href="https://item.jd.com/456.html" title="批判性思维">批判性思维</a></div><div class="p-price">￥62.00</div></li></body></html>"#, waitForOffer: true)
        #expect(jd.offers.first?.price == 62)
    }

    @Test @MainActor func cancelledRendererStopsBeforeReturningAQuote() async {
        let task = Task { try await RetailerPageRenderer().load(URL(string: "https://search.jd.com/Search")!, channel: .jd) }
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["TOMEKEEP_RUN_LIVE_RETAILER_TESTS"] == "1"))
    @MainActor func liveJDReturnsRenderedOffersOrAnExplicitVerificationWall() async throws {
        do {
            let page = try await RetailerPageRenderer().load(RetailerPricingService.searchURL(channel: .jd, title: "三体"), channel: .jd)
            #expect(!page.offers.isEmpty)
        } catch RetailerPricingError.verificationRequired(let url) {
            #expect(RetailerPricingService.requiresVerificationURL(url, channel: .jd))
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["TOMEKEEP_RUN_LIVE_RETAILER_TESTS"] == "1"))
    @MainActor func liveDangdangRendersChineseSearchAndPrices() async throws {
        let url = RetailerPricingService.searchURL(channel: .dangdang, title: "康熙的红票")
        let page = try await RetailerPageRenderer().load(url, channel: .dangdang)
        #expect(page.url.host == "search.dangdang.com")
        #expect(page.html.contains("康熙的红票"))
        #expect(!page.offers.isEmpty)
        #expect(page.offers.allSatisfy { $0.priceCNY > 0 && $0.url.host == "product.dangdang.com" })
    }

    @MainActor private func renderFixture(_ html: String, waitForOffer: Bool) async throws -> RenderedRetailerSnapshot {
        let view = RetailerWebConfiguration.makeWebView()
        let delegate = FixtureNavigationDelegate()
        view.navigationDelegate = delegate
        defer { view.stopLoading(); view.navigationDelegate = nil }
        try await withCheckedThrowingContinuation { continuation in
            delegate.pending = continuation
            view.loadHTMLString(html, baseURL: URL(string: "https://item.jd.com/123.html")!)
        }
        for _ in 0..<20 {
            let value = try await view.evaluateJavaScript(RetailerPageScripts.snapshot)
            let json = try #require(value as? String)
            let page = try JSONDecoder().decode(RenderedRetailerSnapshot.self, from: Data(json.utf8))
            if !waitForOffer || !page.offers.isEmpty { return page }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw RetailerPricingError.notFound
    }
#endif
}

#if os(macOS)
@MainActor private final class FixtureNavigationDelegate: NSObject, WKNavigationDelegate {
    var pending: CheckedContinuation<Void, Error>?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        let continuation = pending
        pending = nil
        continuation?.resume()
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        let continuation = pending
        pending = nil
        continuation?.resume(throwing: error)
    }
}
#endif
