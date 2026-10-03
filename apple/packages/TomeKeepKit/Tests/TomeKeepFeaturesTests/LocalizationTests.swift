import Foundation
import Testing
@testable import TomeKeepFeatures

@Test func englishResourcesLocalizeStaticAndFormattedInterfaceCopy() {
    let english = Locale(identifier: "en")
    let chinese = Locale(identifier: "zh-Hans")
    #expect(tkLocalized("书库", locale: english) == "Library")
    #expect(tkLocalized("书库", locale: chinese) == "书库")
    #expect(tkLocalized("未读", locale: chinese) == "未读")
    #expect(tkLocalized("无法读取本机书库。", locale: english) == "Unable to load the on-device library.")
    #expect(tkLocalized("SwiftData，本地优先", locale: english) == "SwiftData, local-first")
    #expect(tkLocalized("中文", locale: english) == "Chinese")
    #expect(tkLocalized("中国大陆", locale: english) == "Mainland China")
    #expect(tkLocalized("稳定 ID、幂等导入、SHA-256 校验、逐记录报告", locale: english) == "Stable IDs, idempotent import, SHA-256 validation, and per-record reporting")
    #expect(tkLocalized("没有符合筛选条件的书籍", locale: english) == "No Books Match These Filters")
    #expect(tkLocalized("设置", locale: english) == "Settings")

    let template = tkLocalized("同步完成：接收 %lld 条，发送 %lld 条。", locale: english)
    #expect(String(format: template, locale: english, arguments: [3, 2]) == "Sync complete: received 3 and sent 2.")
    let pricingTemplate = tkLocalized("《%@》已完成 %lld/3 个渠道采价。", locale: english)
    #expect(String(format: pricingTemplate, locale: english, arguments: ["Dune", 2]) == "Price lookup for “Dune” completed for 2 of 3 retailers.")
}

@Test func featureErrorTranslationIncludesErrorsFromSharedModules() {
    let source = ExternalErrorStub()
    #expect(tkErrorDescription(source, fallback: "查询失败，仍可手工录入") == tkLocalized("服务器返回了无法识别的响应。"))
}

private struct ExternalErrorStub: LocalizedError {
    var errorDescription: String? { "服务器返回了无法识别的响应。" }
}
