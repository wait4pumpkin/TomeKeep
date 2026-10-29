import Foundation
import Testing
import TomeKeepNetworking
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
    #expect(tkLocalized("常用标签", locale: english) == "Frequently Used Tags")
    #expect(tkLocalized("暂无可添加的常用标签", locale: english) == "No more suggested tags")
    #expect(tkLocalized("添加标签", locale: english) == "Add Tags")
    #expect(tkLocalized("新建标签", locale: english) == "New Tag")
    #expect(tkLocalized("标签名称", locale: english) == "Tag Name")
    #expect(tkLocalized("未标记为待购买", locale: english) == "Not marked for purchase")
    #expect(tkLocalized("切换阅读档案", locale: english) == "Switch Reading Profile")
    #expect(tkLocalized("同步中", locale: english) == "Syncing")
    #expect(tkLocalized("已购买，移入书库", locale: english) == "Purchased · Move to Library")
    #expect(tkLocalized("只看待购买", locale: english) == "Pending Purchases Only")
    #expect(tkLocalized("更多操作", locale: english) == "More Actions")
    #expect(String(format: tkLocalized("《%@》已移入书库", locale: english), "Dune") == "“Dune” moved to the library")

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

@Test func networkFailuresExposeActionableReasonsInsteadOfDataLossReassurance() {
    let description = tkErrorDescription(URLError(.notConnectedToInternet), fallback: "同步失败；本机数据没有丢失。")
    #expect(description == tkLocalized("无法连接网络，请检查网络连接后重试。"))
    let missing = DecodingError.keyNotFound(TestSyncKey.field, .init(codingPath: [], debugDescription: "private value"))
    let decoding = APIResponseDecodingError(path: "books?private=value", error: missing)
    let message = tkErrorDescription(decoding, fallback: "error")
    #expect(message.contains("books"))
    #expect(message.contains("field"))
    #expect(!message.contains("private value"))
}

private enum TestSyncKey: String, CodingKey { case field }
