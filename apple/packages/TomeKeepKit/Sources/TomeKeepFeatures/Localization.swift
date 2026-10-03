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
    if let keychain = error as? KeychainError {
        return tkLocalizedFormat("无法访问钥匙串（%d）。", keychain.status)
    }
    if let apiError = error as? APIClientError,
       case let .rejected(statusCode, message) = apiError {
        return message.map { tkLocalized($0) } ?? tkLocalizedFormat("请求失败（HTTP %lld）。", statusCode)
    }
    guard let description = (error as? LocalizedError)?.errorDescription else {
        return tkLocalized(fallback)
    }
    return tkLocalized(description)
}
