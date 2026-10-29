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
    @State private var requestedURL: URL?
    @State private var captureTask: Task<Void, Never>?
    @State private var captureIdentity = UUID()

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
                        captureTask?.cancel()
                        captureIdentity = UUID()
                        isAutoCapturing = false
                        detectedPrice = nil
                        priceText = ""
                        currentURL = nil
                        browserError = nil
                        browserIdentity = UUID()
                        requestedURL = nil
                    }
                }

                Section("当前商品") {
                    Text(browserError ?? currentURL?.absoluteString ?? tkLocalized("正在打开搜索页…"))
                        .font(.caption.monospaced())
                        .foregroundStyle(browserError == nil ? Color.secondary : Color.red)
                        .textSelection(.enabled)
                        .lineLimit(4)
                    TextField("价格（元）", text: $priceText)
                    Button(tkLocalized("重新加载"), systemImage: "arrow.clockwise") {
                        requestedURL = currentURL ?? searchURL
                        browserError = nil
                        browserIdentity = UUID()
                    }
                    .disabled(isAutoCapturing)
                    if let detectedPrice {
                        Button("使用识别价格 ¥\(detectedPrice.formatted(.number.precision(.fractionLength(2))))") {
                            priceText = detectedPrice.formatted(.number.precision(.fractionLength(2)))
                        }
                    }
                    Button {
                        captureTask = Task { await autoCapture() }
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
                url: requestedURL ?? searchURL,
                channel: channel,
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
        .onChange(of: currentURL) { previous, current in
            if previous != current { priceText = "" }
        }
        .onDisappear {
            captureTask?.cancel()
            captureIdentity = UUID()
        }
        .sheet(item: $verification) { target in
            WebsiteVerificationView(url: target.url)
        }
    }

    private var searchURL: URL {
        RetailerPricingService.searchURL(channel: channel, title: item.title)
    }

    private func save() {
        message = nil
        messageIsError = true
        guard let url = currentURL, let host = url.host?.lowercased(), channel.productHosts.contains(host),
              PricingHTMLParser.productID(channel: channel, url: url) != nil else {
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
                productID: PricingHTMLParser.productID(channel: channel, url: url),
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
        let identity = UUID()
        captureIdentity = identity
        let requestedChannel = channel
        isAutoCapturing = true
        message = nil
        messageIsError = false
        defer { if captureIdentity == identity { isAutoCapturing = false } }
        do {
            let repository = PriceCacheRepository(context: modelContext)
            let existing = try repository.entry(key: Self.priceKey(for: item))?.quotes.first { $0.channel == channel }
            let quote = try await makeNativeRetailerPricingService().capture(
                channel: requestedChannel,
                title: item.title,
                author: item.author.nilIfEmpty,
                existingQuote: existing
            )
            try Task.checkCancellation()
            guard captureIdentity == identity, channel == requestedChannel else { return }
            try store(quote)
            requestedURL = quote.url
            detectedPrice = quote.priceCNY
            priceText = quote.priceCNY?.formatted(.number.precision(.fractionLength(2))) ?? ""
            message = tkLocalizedFormat("已保存 %@ 的自动采价结果。", tkLocalized(channel.captureLabel))
        } catch is CancellationError {
            // Closing the sheet or switching channels must not save a stale quote.
        } catch RetailerPricingError.verificationRequired(let url) {
            guard captureIdentity == identity, channel == requestedChannel else { return }
            verification = PriceVerificationTarget(url: url)
            messageIsError = true
            message = tkLocalized("请完成登录或验证码，关闭网页后再次自动查询。")
        } catch {
            guard captureIdentity == identity, channel == requestedChannel else { return }
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

}

private struct PriceVerificationTarget: Identifiable {
    let id = UUID()
    let url: URL
}

private struct RetailerBrowserView: NSViewRepresentable {
    let url: URL
    let channel: PriceChannel
    let allowedProductHosts: Set<String>
    @Binding var currentURL: URL?
    @Binding var detectedPrice: Double?
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(
            currentURL: $currentURL,
            detectedPrice: $detectedPrice,
            loadError: $loadError,
            allowedProductHosts: allowedProductHosts,
            channel: channel
        )
    }

    func makeNSView(context: Context) -> WKWebView {
        let webView = RetailerWebConfiguration.makeWebView()
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.requestedURL = url
        webView.load(URLRequest(url: RetailerBrowserPolicy.normalizedURL(url) ?? url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.requestedURL != url else { return }
        context.coordinator.requestedURL = url
        webView.load(URLRequest(url: RetailerBrowserPolicy.normalizedURL(url) ?? url))
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.priceTask?.cancel()
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        @Binding private var currentURL: URL?
        @Binding private var detectedPrice: Double?
        @Binding private var loadError: String?
        private let allowedProductHosts: Set<String>
        private let channel: PriceChannel
        var requestedURL: URL?
        var priceTask: Task<Void, Never>?
        private var responseError: String?

        init(
            currentURL: Binding<URL?>,
            detectedPrice: Binding<Double?>,
            loadError: Binding<String?>,
            allowedProductHosts: Set<String>,
            channel: PriceChannel
        ) {
            _currentURL = currentURL
            _detectedPrice = detectedPrice
            _loadError = loadError
            self.allowedProductHosts = allowedProductHosts
            self.channel = channel
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            loadError = nil
            responseError = nil
            priceTask?.cancel()
            detectedPrice = nil
            currentURL = webView.url
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            loadError = responseError
            currentURL = webView.url
            guard let url = webView.url, let host = url.host?.lowercased(), allowedProductHosts.contains(host),
                  PricingHTMLParser.productID(channel: channel, url: url) != nil else {
                detectedPrice = nil
                return
            }
            priceTask?.cancel()
            priceTask = Task { @MainActor [weak self, weak webView] in
                guard let self, let webView else { return }
                let pageURL = webView.url
                var lastPrice: Double?
                var stable = 0
                for _ in 0..<30 {
                    guard !Task.isCancelled, webView.url == pageURL else { return }
                    do {
                        let value = try await webView.evaluateJavaScript(RetailerPageScripts.snapshot)
                        guard !Task.isCancelled, webView.url == pageURL else { return }
                        if let json = value as? String, let data = json.data(using: .utf8), let pageURL {
                            let page = try JSONDecoder().decode(RenderedRetailerSnapshot.self, from: data).page(url: pageURL, channel: channel)
                            if let price = page.productPrice {
                                detectedPrice = price
                                stable = price == lastPrice ? stable + 1 : 0
                                lastPrice = price
                                if stable >= 2 { return }
                            }
                        }
                        try await Task.sleep(for: .milliseconds(500))
                    } catch is CancellationError { return }
                    catch { return }
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
            reportLoadFailure(webView, error: error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
            reportLoadFailure(webView, error: error)
        }

        private func reportLoadFailure(_ webView: WKWebView, error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            priceTask?.cancel()
            currentURL = webView.url
            detectedPrice = nil
            loadError = RetailerBrowserPolicy.errorMessage(error)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.targetFrame?.isMainFrame != false else { return .allow }
            guard let original = action.request.url, let normalized = RetailerBrowserPolicy.normalizedURL(original) else {
                reportLoadFailure(webView, error: URLError(.unsupportedURL))
                return .cancel
            }
            if normalized != original {
                webView.load(URLRequest(url: normalized))
                return .cancel
            }
            return .allow
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
            if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
                responseError = RetailerBrowserPolicy.errorMessage(NSError(domain: "TomeKeep.RetailerHTTP", code: http.statusCode))
                loadError = responseError
            }
            return .allow
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if action.targetFrame == nil, let url = action.request.url, let normalized = RetailerBrowserPolicy.normalizedURL(url) {
                webView.load(URLRequest(url: normalized))
            }
            return nil
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            reportLoadFailure(webView, error: URLError(.networkConnectionLost))
        }
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
