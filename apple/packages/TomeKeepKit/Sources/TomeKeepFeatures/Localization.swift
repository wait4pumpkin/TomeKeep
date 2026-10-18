import Foundation
import TomeKeepNetworking

let tkLanguagePreferenceKey = "tomekeep.language"
let tkDefaultLanguageCode = Locale.current.language.languageCode?.identifier == "zh" ? "zh-Hans" : "en"

@inline(__always)
func tkLocalized(_ key: String) -> String {
    let languageCode = UserDefaults.standard.string(forKey: tkLanguagePreferenceKey) ?? tkDefaultLanguageCode
    return tkLocalized(key, locale: Locale(identifier: languageCode))
}

@inline(__always)
func tkLocalized(_ key: String, locale: Locale) -> String {
    for identifier in localizationIdentifiers(for: locale) {
        guard let url = Bundle.module.url(forResource: identifier, withExtension: "lproj"),
              let bundle = Bundle(url: url)
        else { continue }
        let runtime = bundle.localizedString(forKey: key, value: nil, table: "Runtime")
        if isResolvedLocalization(runtime, for: key) { return runtime }
        let catalog = bundle.localizedString(forKey: key, value: nil, table: nil)
        if isResolvedLocalization(catalog, for: key) { return catalog }
    }
    return key
}

private func isResolvedLocalization(_ value: String, for key: String) -> Bool {
    !value.isEmpty && value != key && value != "null"
}

private func localizationIdentifiers(for locale: Locale) -> [String] {
    var values = [locale.identifier]
    if let language = locale.language.languageCode?.identifier, !values.contains(language) {
        values.append(language)
    }
    return values
}

func tkLocalizedFormat(_ key: String, _ arguments: CVarArg...) -> String {
    let languageCode = UserDefaults.standard.string(forKey: tkLanguagePreferenceKey) ?? tkDefaultLanguageCode
    let locale = Locale(identifier: languageCode)
    return String(format: tkLocalized(key, locale: locale), locale: locale, arguments: arguments)
}

func tkErrorDescription(_ error: Error, fallback: String) -> String {
    if let decoding = error as? APIResponseDecodingError {
        return tkLocalizedFormat("服务器数据格式不兼容（%@，字段 %@）。", decoding.endpoint, decoding.field.isEmpty ? "root" : decoding.field)
    }
    if let network = error as? URLError {
        switch network.code {
        case .notConnectedToInternet: return tkLocalized("无法连接网络，请检查网络连接后重试。")
        case .timedOut: return tkLocalized("连接服务器超时，请稍后重试。")
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            return tkLocalized("无法连接同步服务器，请检查网络和服务地址。")
        case .networkConnectionLost: return tkLocalized("网络连接已中断，请重试。")
        default: return tkLocalizedFormat("网络请求失败（错误 %lld）。", network.code.rawValue)
        }
    }
    if let keychain = error as? KeychainError {
        return tkLocalizedFormat("无法访问钥匙串（%d）。", keychain.status)
    }
    if let apiError = error as? APIClientError,
       case let .rejected(statusCode, message) = apiError {
        return message.map { tkLocalized($0) } ?? tkLocalizedFormat("请求失败（HTTP %lld）。", statusCode)
    }
    guard let description = (error as? LocalizedError)?.errorDescription else {
        let underlying = error as NSError
        return tkLocalizedFormat("%@（%@，错误 %lld）。", tkLocalized(fallback), underlying.domain, underlying.code)
    }
    return tkLocalized(description)
}
