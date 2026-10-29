import Foundation
import TomeKeepDomain
import TomeKeepPricing

enum RetailerBrowserPolicy {
    static func normalizedURL(_ url: URL) -> URL? {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.user == nil, url.password == nil,
              url.port == nil || url.port == 80 || url.port == 443,
              let host = url.host?.lowercased(),
              ["jd.com", "360buy.com", "dangdang.com", "bookschina.com"].contains(where: { host == $0 || host.hasSuffix("." + $0) })
        else { return nil }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = "https"
        if components?.port == 80 { components?.port = nil }
        return components?.url
    }

    static func errorMessage(_ error: Error) -> String {
        let value = error as NSError
        let detail: String
        switch (error as? URLError)?.code {
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .notConnectedToInternet:
            detail = tkLocalized("无法连接书店，请检查网络后重试。")
        case .timedOut:
            detail = tkLocalized("书店连接超时，请重试。")
        case .secureConnectionFailed, .serverCertificateUntrusted, .appTransportSecurityRequiresSecureConnection:
            detail = tkLocalized("书店页面的安全连接失败，请稍后重试。")
        case .unsupportedURL:
            detail = tkLocalized("书店页面请求了不受支持的地址。")
        default:
            detail = tkLocalized("无法打开书店页面。请检查网络后重试。")
        }
        // Do not expose the failing URL's query, HTML, cookies or credentials.
        return "\(detail)（\(value.domain.prefix(80)) \(value.code)）"
    }
}

struct RenderedRetailerSnapshot: Decodable {
    struct Offer: Decodable {
        let url: URL
        let price: Double
        let title: String?
        let author: String?
    }
    let html: String
    let offers: [Offer]
    let productPrice: Double?

    func page(url: URL, channel: PriceChannel) -> RetailerPageSnapshot {
        let valid = offers.prefix(8).compactMap { offer -> PriceOffer? in
            guard let normalized = RetailerBrowserPolicy.normalizedURL(offer.url),
                  PricingHTMLParser.productID(channel: channel, url: normalized) != nil,
                  offer.price.isFinite, offer.price > 0 else { return nil }
            return PriceOffer(url: normalized, priceCNY: offer.price, title: offer.title, author: offer.author)
        }
        let price = productPrice.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
        return RetailerPageSnapshot(url: url, html: html, offers: valid, productPrice: price)
    }
}

enum RetailerPageScripts {
    /// Read only rendered product containers. No form values or retailer
    /// account details are collected. Results and HTML are bounded in size.
    static let snapshot = #"""
    (() => {
      const number = value => {
        const match = String(value || '').replace(/,/g, '').match(/(?:[¥￥]\s*)?(\d+(?:\.\d{1,2})?)/);
        const price = match ? Number(match[1]) : 0;
        return Number.isFinite(price) && price > 0 ? price : null;
      };
      const priceIn = (root, selectors) => {
        for (const selector of selectors) {
          const nodes = root.querySelectorAll(selector);
          for (const node of nodes) {
            if (!node.getClientRects().length) continue;
            const price = number(node.textContent);
            if (price) return price;
          }
        }
        return null;
      };
      const selectors = ['#jd-price', '#dd-price', '.p-price .price', '.p-price',
        '[class*="_price_"]', '.search_now_price', '.sellPrice',
        '[class*="price-now"]', '[class*="now-price"]'];
      const offers = [], seen = new Set();
      const add = (url, card) => {
        if (offers.length >= 8 || !url || seen.has(url)) return;
        let parsed; try { parsed = new URL(url, location.href); } catch (_) { return; }
        const host = parsed.hostname.toLowerCase();
        if (!['item.jd.com', 'product.dangdang.com', 'www.bookschina.com', 'm.bookschina.com'].includes(host)) return;
        if (!/^\/\d{1,24}\.html?$/.test(parsed.pathname)) return;
        const price = priceIn(card, selectors);
        if (!price) return;
        const titleNode = card.querySelector('.name a, .p-name a, [class*="_text_"], a[title], [title]');
        const authorNode = card.querySelector('.search_book_author, .author, [class*="author"]');
        const title = (titleNode?.getAttribute('title') || titleNode?.textContent || '').trim().slice(0, 2000);
        offers.push({url: parsed.href, price, title, author: authorNode?.textContent?.trim().slice(0, 500) || null});
        seen.add(url);
      };
      for (const card of document.querySelectorAll('[data-sku]')) {
        const sku = card.getAttribute('data-sku');
        if (/^\d{1,24}$/.test(sku || '')) add('https://item.jd.com/' + sku + '.html', card);
      }
      for (const link of document.querySelectorAll('a[href*="product.dangdang.com/"], a[href*="bookschina.com/"]')) {
        const card = link.closest('li, .bookItem, .book-item, .item');
        if (card) add(link.href, card);
      }
      let productPrice = priceIn(document, selectors);
      if (!productPrice) {
        const visit = value => {
          if (!value || typeof value !== 'object') return null;
          if (Array.isArray(value)) { for (const child of value) { const p = visit(child); if (p) return p; } return null; }
          const offers = value.offers;
          if (offers) {
            for (const offer of (Array.isArray(offers) ? offers : [offers])) {
              const p = number(offer?.price ?? offer?.lowPrice); if (p) return p;
            }
          }
          return value['@graph'] ? visit(value['@graph']) : null;
        };
        for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
          try { productPrice = visit(JSON.parse(node.textContent || '{}')); } catch (_) {}
          if (productPrice) break;
        }
      }
      const productHTML = document.body.cloneNode(true);
      productHTML.querySelectorAll('form, input, textarea, select, script, style, iframe, header, footer, nav').forEach(node => node.remove());
      return JSON.stringify({html: productHTML.outerHTML.slice(0, 2000000), offers, productPrice});
    })()
    """#
}

#if os(macOS)
import WebKit

func makeNativeRetailerPricingService() -> RetailerPricingService {
    RetailerPricingService(pageLoader: { url, channel in
        try await RetailerPageRenderer().load(url, channel: channel)
    })
}

@MainActor
enum RetailerWebConfiguration {
    static func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1200, height: 800), configuration: configuration)
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        return webView
    }
}

/// One renderer per lookup. WebKit lives on the main actor; waits suspend and
/// are cancelled on navigation failure, caller cancellation or timeout.
@MainActor
final class RetailerPageRenderer: NSObject, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView?
    private var navigation: CheckedContinuation<Void, Error>?

    func load(_ url: URL, channel: PriceChannel) async throws -> RetailerPageSnapshot {
        guard let url = RetailerBrowserPolicy.normalizedURL(url) else { throw URLError(.unsupportedURL) }
        let view = RetailerWebConfiguration.makeWebView()
        webView = view
        view.navigationDelegate = self
        view.uiDelegate = self
        defer {
            view.stopLoading()
            view.navigationDelegate = nil
            view.uiDelegate = nil
            webView = nil
        }
        return try await withThrowingTaskGroup(of: RetailerPageSnapshot.self) { group in
            group.addTask { try await self.render(url, channel: channel) }
            group.addTask {
                try await Task.sleep(for: .seconds(35))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            guard let page = try await group.next() else { throw CancellationError() }
            return page
        }
    }

    private func render(_ url: URL, channel: PriceChannel) async throws -> RetailerPageSnapshot {
        try await navigate(url)
        guard let view = webView else { throw CancellationError() }
        var latest: RetailerPageSnapshot?
        var stableCount = 0
        var previousSignature = ""
        for _ in 0..<30 {
            try Task.checkCancellation()
            guard let current = view.url else { throw URLError(.badURL) }
            if RetailerPricingService.requiresVerificationURL(current, channel: channel) {
                throw RetailerPricingError.verificationRequired(current)
            }
            let value = try await view.evaluateJavaScript(RetailerPageScripts.snapshot)
            try Task.checkCancellation()
            guard view.url == current else {
                latest = nil
                stableCount = 0
                previousSignature = ""
                continue
            }
            guard let json = value as? String, let data = json.data(using: .utf8) else { throw RetailerPricingError.unavailable }
            let page = try JSONDecoder().decode(RenderedRetailerSnapshot.self, from: data).page(url: current, channel: channel)
            latest = page
            let signature = "\(page.productPrice ?? 0):" + page.offers.map { "\($0.url.absoluteString):\($0.priceCNY)" }.joined(separator: "|")
            if signature == previousSignature { stableCount += 1 } else { stableCount = 0 }
            previousSignature = signature
            let isProduct = PricingHTMLParser.productID(channel: channel, url: current) != nil
            if stableCount >= 2, isProduct ? page.productPrice != nil : !page.offers.isEmpty { return page }
            try await Task.sleep(for: .milliseconds(500))
        }
        guard let latest else { throw RetailerPricingError.unavailable }
        return latest
    }

    private func navigate(_ url: URL) async throws {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation { continuation in
                navigation = continuation
                webView?.load(URLRequest(url: url))
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(CancellationError()) }
        }
    }

    private func finish(_ error: Error? = nil) {
        guard let pending = navigation else { return }
        navigation = nil
        if let error { pending.resume(throwing: error) } else { pending.resume() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) { finish() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { finish(error) }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { finish(error) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(URLError(.networkConnectionLost)) }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard action.targetFrame?.isMainFrame != false else { return .allow }
        guard let original = action.request.url, let normalized = RetailerBrowserPolicy.normalizedURL(original) else {
            finish(URLError(.unsupportedURL))
            return .cancel
        }
        if original != normalized {
            webView.load(URLRequest(url: normalized))
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
            finish(NSError(domain: "TomeKeep.RetailerHTTP", code: http.statusCode))
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url, let normalized = RetailerBrowserPolicy.normalizedURL(url) {
            webView.load(URLRequest(url: normalized))
        }
        return nil
    }
}
#endif
