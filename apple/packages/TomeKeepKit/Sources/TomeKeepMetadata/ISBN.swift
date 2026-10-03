import Foundation

public enum ISBN: Hashable, Sendable {
    case isbn10(String)
    case isbn13(String)

    public init?(_ input: String) {
        let normalized = input.uppercased().filter { $0.isNumber || $0 == "X" }
        switch normalized.count {
        case 10 where Self.isValidISBN10(normalized):
            self = .isbn10(normalized)
        case 13 where Self.isValidISBN13(normalized):
            self = .isbn13(normalized)
        default:
            return nil
        }
    }

    public var isbn13: String {
        switch self {
        case let .isbn13(value):
            value
        case let .isbn10(value):
            Self.convertISBN10To13(value)
        }
    }

    public var semantics: ISBNSemantics? {
        let value = isbn13
        return Self.groupTable.first(where: { value.hasPrefix($0.prefix) }).map {
            ISBNSemantics(region: $0.region, language: $0.language)
        }
    }

    public var inferredPublisher: String? {
        let value = isbn13
        return Self.publisherTable.first(where: { value.hasPrefix($0.prefix) })?.publisher
    }

    private static func isValidISBN10(_ value: String) -> Bool {
        let characters = Array(value)
        guard characters.count == 10 else { return false }

        var sum = 0
        for index in 0..<9 {
            guard let digit = characters[index].wholeNumberValue else { return false }
            sum += digit * (10 - index)
        }

        let checkDigit: Int
        if characters[9] == "X" {
            checkDigit = 10
        } else if let digit = characters[9].wholeNumberValue {
            checkDigit = digit
        } else {
            return false
        }

        return (sum + checkDigit) % 11 == 0
    }

    private static func isValidISBN13(_ value: String) -> Bool {
        let digits = value.compactMap(\.wholeNumberValue)
        guard digits.count == 13 else { return false }

        let sum = digits.prefix(12).enumerated().reduce(0) { partial, pair in
            partial + pair.element * (pair.offset.isMultiple(of: 2) ? 1 : 3)
        }
        return (10 - sum % 10) % 10 == digits[12]
    }

    private static func convertISBN10To13(_ value: String) -> String {
        let prefix = "978" + value.prefix(9)
        let digits = prefix.compactMap(\.wholeNumberValue)
        let sum = digits.enumerated().reduce(0) { partial, pair in
            partial + pair.element * (pair.offset.isMultiple(of: 2) ? 1 : 3)
        }
        return prefix + String((10 - sum % 10) % 10)
    }

    private static let groupTable: [(prefix: String, region: String, language: String)] = [
        ("97899937", "澳门", "中文"),
        ("97910", "法国", "法语"), ("97911", "韩国", "韩语"),
        ("97912", "意大利", "意大利语"), ("9798", "美国（自出版）", "英语"),
        ("978957", "台湾", "中文"), ("978986", "台湾", "中文"),
        ("978988", "香港", "中文"), ("978950", "阿根廷", "西班牙语"),
        ("978956", "智利", "西班牙语"), ("978958", "哥伦比亚", "西班牙语"),
        ("978968", "墨西哥", "西班牙语"), ("978972", "葡萄牙", "葡萄牙语"),
        ("97880", "捷克", "捷克语"), ("97881", "印度", "印地语/英语"),
        ("97882", "挪威", "挪威语"), ("97883", "波兰", "波兰语"),
        ("97884", "西班牙", "西班牙语"), ("97885", "巴西", "葡萄牙语"),
        ("97886", "塞尔维亚", "塞尔维亚语"), ("97887", "丹麦", "丹麦语"),
        ("97888", "意大利", "意大利语"), ("97889", "韩国", "韩语"),
        ("97890", "荷兰", "荷兰语"), ("97891", "瑞典", "瑞典语"),
        ("97892", "国际组织", "多语种"), ("97893", "印度", "印地语/英语"),
        ("97894", "荷兰", "荷兰语"),
        ("9780", "英语区", "英语"), ("9781", "英语区", "英语"),
        ("9782", "法语区", "法语"), ("9783", "德语区", "德语"),
        ("9784", "日本", "日语"), ("9785", "俄语区", "俄语"),
        ("9787", "中国大陆", "中文"),
    ].sorted { $0.prefix.count > $1.prefix.count }

    private static let publisherTable: [(prefix: String, publisher: String)] = [
        ("9787100", "商务印书馆"), ("9787101", "中华书局"),
        ("9787107", "人民教育出版社"), ("9787108", "三联书店"),
        ("9787111", "机械工业出版社"), ("9787115", "人民邮电出版社"),
        ("9787117", "人民卫生出版社"), ("9787121", "电子工业出版社"),
        ("9787122", "化学工业出版社"), ("9787301", "北京大学出版社"),
        ("9787302", "清华大学出版社"), ("9787309", "复旦大学出版社"),
        ("9787508", "中信出版社"), ("9787513", "新星出版社"),
        ("9787544", "上海译文出版社"), ("9787550", "北京联合出版公司"),
        ("9787559", "北京联合出版公司"),
        ("978700", "中国大百科全书出版社"), ("978701", "人民出版社"),
        ("978702", "人民文学出版社"), ("978703", "科学出版社"),
        ("978704", "高等教育出版社"), ("978705", "商务印书馆"),
        ("978706", "中华书局"), ("978711", "北京大学出版社"),
    ].sorted { $0.prefix.count > $1.prefix.count }
}

public struct ISBNSemantics: Equatable, Sendable {
    public let region: String
    public let language: String

    public init(region: String, language: String) {
        self.region = region
        self.language = language
    }
}
