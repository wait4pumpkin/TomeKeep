import SwiftUI
import SwiftData
import TomeKeepPersistence

func commonBookTags(in groups: [[String]], excluding selected: [String], matching query: String = "", limit: Int = 12) -> [String] {
    var frequency: [String: Int] = [:]
    for group in groups {
        for tag in normalizedBookTags(group) { frequency[tag, default: 0] += 1 }
    }
    let excluded = Set(normalizedBookTags(selected))
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return Array(frequency.keys.filter {
        !excluded.contains($0) && (query.isEmpty || $0.localizedCaseInsensitiveContains(query))
    }.sorted {
        if frequency[$0] != frequency[$1] { return frequency[$0, default: 0] > frequency[$1, default: 0] }
        return $0 < $1
    }.prefix(max(0, limit)))
}

/// Loaded only while a tag editor is open, not once for each visible book card.
struct CommonBookTagSuggestions: View {
    @Environment(\.modelContext) private var context
    let selected: [String]
    var query = ""
    let onSelect: (String) -> Void
    @State private var tagGroups: [[String]] = []
    @State private var failedToLoad = false

    private var suggestions: [String] {
        commonBookTags(in: tagGroups, excluding: selected, matching: query)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !suggestions.isEmpty {
                Text(tkLocalized("常用标签"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                CompactTagFlowLayout(spacing: 8) {
                    ForEach(suggestions, id: \.self) { tag in
                        Button { onSelect(tag) } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus").font(.caption.weight(.semibold))
                                Text(tag).lineLimit(1)
                            }
                            .font(.callout)
                            .padding(.horizontal, 12)
                            .frame(minWidth: 44, minHeight: 44)
                            .foregroundStyle(TagPalette.color(for: tag))
                            .background(TagPalette.color(for: tag).opacity(0.12), in: .capsule)
                            .contentShape(.capsule)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(tkLocalizedFormat("添加标签 %@", tag))
                        .accessibilityIdentifier("tag.suggestion.\(tag)")
                    }
                }
            } else if failedToLoad {
                Text(tkLocalized("无法读取常用标签，仍可手动输入。"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .task { reload() }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in reload() }
    }

    private func reload() {
        do {
            tagGroups = try BookRepository(context: context).books().map(\.tags)
                + WishlistRepository(context: context).items().map(\.tags)
            failedToLoad = false
        } catch { failedToLoad = true }
    }
}

struct WishlistPendingButton: View {
    let title: String
    let isPending: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isPending ? "cart.fill" : "cart")
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
                .foregroundStyle(isPending ? Color.accentColor : Color.secondary)
                .background(.regularMaterial, in: .rect(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).stroke(.secondary.opacity(0.2), lineWidth: 0.5) }
                .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(tkLocalizedFormat(isPending ? "取消《%@》的待购买标记" : "将《%@》标记为待购买", title))
        .accessibilityValue(tkLocalized(isPending ? "待购买" : "未标记为待购买"))
        .accessibilityAddTraits(isPending ? .isSelected : [])
        .help(tkLocalized(isPending ? "取消待购买" : "标记为待购买"))
    }
}
