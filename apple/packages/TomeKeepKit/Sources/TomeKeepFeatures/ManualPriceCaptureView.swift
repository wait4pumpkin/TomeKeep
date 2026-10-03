#if os(macOS)
import SwiftData
import SwiftUI
import TomeKeepDomain
import TomeKeepPersistence
import TomeKeepPricing
import WebKit

struct ManualPriceCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    let item: WishlistItem

    @State private var channel: PriceChannel = .jd
    @State private var currentURL: URL?
    @State private var browserError: String?
    @State private var detectedPrice: Double?
    @State private var priceText = ""
    @State private var message: String?
    @State private var messageIsError = false
    @State private var isAutoCapturing = false
    @State private var verification: PriceVerificationTarget?
    @State private var browserIdentity = UUID()

    var body: some View {
        NavigationSplitView {
            Form {
                Section("书籍") {
                    Text(item.title).font(.headline)
                    if !item.author.isEmpty { Text(item.author).foregroundStyle(.secondary) }
                    if let isbn = item.isbn { LabeledContent("ISBN", value: isbn) }
                }

                Section("渠道") {
                    Picker("书店", selection: $channel) {
                        ForEach(PriceChannel.allCases, id: \.self) { Text($0.captureLabel).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: channel) { _, _ in
                        detectedPrice = nil
                        priceText = ""
                        currentURL = nil
                        browserError = nil
                        browserIdentity = UUID()
                    }
                }

                Section("当前商品") {
                    Text(browserError ?? currentURL?.absoluteString ?? tkLocalized("正在打开搜索页…"))
                        .font(.caption.monospaced())
                        .foregroundStyle(browserError == nil ? Color.secondary : Color.red)
                        .textSelection(.enabled)
                        .lineLimit(4)
                    TextField("价格（元）", text: $priceText)
                    if let detectedPrice {
                        Button("使用识别价格 ¥\(detectedPrice.formatted(.number.precision(.fractionLength(2))))") {
                            priceText = detectedPrice.formatted(.number.precision(.fractionLength(2)))
                        }
                    }
                    Button {
                        Task { await autoCapture() }
                    } label: {
                        if isAutoCapturing { ProgressView().controlSize(.small) }
                        else { Label("自动查询当前渠道", systemImage: "wand.and.stars") }
                    }
                    .disabled(isAutoCapturing)
                }

                if let message {
                    Label(message, systemImage: "exclamationmark.circle")
                        .font(.caption)
                        .foregroundStyle(messageIsError ? Color.red : Color.green)
                }

                Section {
                    Text("登录和验证码直接在右侧书店页面完成。TomeKeep 不读取账号密码，只保存书店网站自己的 Cookie。进入商品详情页后可使用自动识别价格，也可手工填写。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            .navigationSplitViewColumnWidth(min: 300, ideal: 340, max: 400)
        } detail: {
            RetailerBrowserView(
                url: searchURL,
                allowedProductHosts: channel.productHosts,
                currentURL: $currentURL,
                detectedPrice: $detectedPrice,
                loadError: $browserError
            )
            .id(browserIdentity)
        }
        .frame(minWidth: 980, minHeight: 680)
        .navigationTitle("为《\(item.title)》采价")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("保存价格") { save() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .onChange(of: detectedPrice) { _, value in
            guard priceText.isEmpty, let value else { return }
            priceText = value.formatted(.number.precision(.fractionLength(2)))
        }
        .sheet(item: $verification) { target in
            WebsiteVerificationView(url: target.url)
        }
    }

    private var searchURL: URL {
        var components: URLComponents
        switch channel {
        case .jd:
            components = URLComponents(string: "https://search.jd.com/Search")!
            components.queryItems = [
                URLQueryItem(name: "keyword", value: "书 \(item.title)"),
                URLQueryItem(name: "wtype", value: "1"),
                URLQueryItem(name: "enc", value: "utf-8"),
            ]
        case .dangdang:
            components = URLComponents(string: "https://search.dangdang.com/")!
            components.queryItems = [URLQueryItem(name: "key", value: item.title)]
        case .bookschina:
            components = URLComponents(string: "https://www.bookschina.com/book_find2/")!
            components.queryItems = [
                URLQueryItem(name: "stp", value: item.title),
                URLQueryItem(name: "sCate", value: "1"),
            ]
        }
        return components.url!
    }

    private func save() {
        message = nil
        messageIsError = true
        guard let url = currentURL, let host = url.host?.lowercased(), channel.productHosts.contains(host) else {
            message = tkLocalizedFormat("请先在右侧进入 %@ 的商品详情页。", tkLocalized(channel.captureLabel))
            return
        }
        guard let price = Double(priceText), price.isFinite, price > 0 else {
            message = tkLocalized("请输入有效的商品价格。")
            return
        }

        do {
            let quote = PriceQuote(
                channel: channel,
                currency: "CNY",
                url: url,
                fetchedAt: .now,
                status: .ok,
                priceCNY: price,
                productID: Self.productID(from: url, channel: channel),
                source: .manual
            )
            try store(quote)
            dismiss()
        } catch {
            message = tkLocalized("价格保存失败，本机原有记录未改变。")
        }
    }

    @MainActor
    private func autoCapture() async {
        isAutoCapturing = true
        message = nil
        messageIsError = false
        defer { isAutoCapturing = false }
        do {
            let repository = PriceCacheRepository(context: modelContext)
            let existing = try repository.entry(key: Self.priceKey(for: item))?.quotes.first { $0.channel == channel }
            let quote = try await RetailerPricingService().capture(
                channel: channel,
                title: item.title,
                author: item.author.nilIfEmpty,
                existingQuote: existing
            )
            try store(quote)
            currentURL = quote.url
            detectedPrice = quote.priceCNY
            priceText = quote.priceCNY?.formatted(.number.precision(.fractionLength(2))) ?? ""
            message = tkLocalizedFormat("已保存 %@ 的自动采价结果。", tkLocalized(channel.captureLabel))
        } catch RetailerPricingError.verificationRequired(let url) {
            verification = PriceVerificationTarget(url: url)
            messageIsError = true
            message = tkLocalized("请完成登录或验证码，关闭网页后再次自动查询。")
        } catch {
            messageIsError = true
            message = tkErrorDescription(error, fallback: "自动采价失败；可继续在网页中手工选择。")
        }
    }

    private func store(_ quote: PriceQuote) throws {
        let repository = PriceCacheRepository(context: modelContext)
        let key = Self.priceKey(for: item)
        let old = try repository.entry(key: key)
        let quotes = (old?.quotes ?? []).filter { $0.channel != quote.channel } + [quote]
        let now = Date.now
        try repository.upsert(PriceCacheEntry(
            key: key,
            title: item.title,
            author: item.author.nilIfEmpty,
            isbn: item.isbn,
            quotes: quotes,
            updatedAt: now,
            expiresAt: now.addingTimeInterval(24 * 60 * 60)
        ))
        requestTomeKeepSync()
    }

    static func priceKey(for item: WishlistItem) -> String {
        "\(item.title)::\(item.author)"
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }

    private static func productID(from url: URL, channel: PriceChannel) -> String? {
        let name = url.deletingPathExtension().lastPathComponent
        return name.allSatisfy(\.isNumber) ? name : nil
    }
}

private struct PriceVerificationTarget: Identifiable {
    let id = UUID()
    let url: URL
}

private struct RetailerBrowserView: NSViewRepresentable {
    let url: URL
    let allowedProductHosts: Set<String>
    @Binding var currentURL: URL?
    @Binding var detectedPrice: Double?
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(
            currentURL: $currentURL,
            detectedPrice: $detectedPrice,
            loadError: $loadError,
            allowedProductHosts: allowedProductHosts
        )
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding private var currentURL: URL?
        @Binding private var detectedPrice: Double?
        @Binding private var loadError: String?
        private let allowedProductHosts: Set<String>

        init(
            currentURL: Binding<URL?>,
            detectedPrice: Binding<Double?>,
            loadError: Binding<String?>,
            allowedProductHosts: Set<String>
        ) {
            _currentURL = currentURL
            _detectedPrice = detectedPrice
            _loadError = loadError
            self.allowedProductHosts = allowedProductHosts
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            loadError = nil
            currentURL = webView.url
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            loadError = nil
            currentURL = webView.url
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                for cookie in cookies { HTTPCookieStorage.shared.setCookie(cookie) }
            }
            guard let host = webView.url?.host?.lowercased(), allowedProductHosts.contains(host) else {
                detectedPrice = nil
                return
            }
            webView.evaluateJavaScript(Self.priceScript) { [weak self] value, _ in
                Task { @MainActor in
                    if let number = value as? NSNumber { self?.detectedPrice = number.doubleValue }
                    else if let text = value as? String { self?.detectedPrice = Double(text) }
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
            reportLoadFailure(webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
            reportLoadFailure(webView)
        }

        private func reportLoadFailure(_ webView: WKWebView) {
            currentURL = webView.url
            detectedPrice = nil
            loadError = tkLocalized("无法打开书店页面。请检查网络后重试。")
        }

        private static let priceScript = #"""
        (() => {
          const selectors = ['#dd-price', '#jd-price', '.search_now_price', '.sellPrice', '.p-price', '[class*="price-now"]', '[class*="now-price"]'];
          for (const selector of selectors) {
            const node = document.querySelector(selector);
            const match = node?.textContent?.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]{1,2})?)/);
            if (match && Number(match[1]) > 0) return Number(match[1]);
          }
          for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const value = JSON.parse(node.textContent || '{}');
              const price = value?.offers?.price ?? value?.price;
              if (Number(price) > 0) return Number(price);
            } catch (_) {}
          }
          return null;
        })()
        """#
    }
}

private extension PriceChannel {
    var captureLabel: String {
        let key = switch self { case .jd: "京东"; case .dangdang: "当当"; case .bookschina: "中图网" }
        return tkLocalized(key)
    }

    var productHosts: Set<String> {
        switch self {
        case .jd: ["item.jd.com"]
        case .dangdang: ["product.dangdang.com"]
        case .bookschina: ["www.bookschina.com", "m.bookschina.com"]
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
#endif
