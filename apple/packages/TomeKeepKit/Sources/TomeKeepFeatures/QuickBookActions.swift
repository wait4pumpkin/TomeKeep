import SwiftUI
import SwiftData
import TomeKeepPersistence

func commonBookTags(in groups: [[String]], excluding selected: [String]) -> [String] {
    var frequency: [String: Int] = [:]
    for group in groups {
        for tag in normalizedBookTags(group) { frequency[tag, default: 0] += 1 }
    }
    let excluded = Set(normalizedBookTags(selected))
    return frequency.keys.filter {
        !excluded.contains($0)
    }.sorted {
        if frequency[$0] != frequency[$1] { return frequency[$0, default: 0] > frequency[$1, default: 0] }
        return $0 < $1
    }
}

/// Loaded only while a tag editor is open, not once for each visible book card.
struct CommonBookTagSuggestions: View {
    @Environment(\.modelContext) private var context
    let selected: [String]
    var showsHeading = false
    var showsEmptyState = false
    let onSelect: (String) -> Void
    @State private var tagGroups: [[String]] = []
    @State private var failedToLoad = false

    private var suggestions: [String] {
        commonBookTags(in: tagGroups, excluding: selected)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !suggestions.isEmpty {
                if showsHeading {
                    Text(tkLocalized("常用标签"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                CompactTagFlowLayout(spacing: tagSpacing, rowSpacing: tagRowSpacing) {
                    ForEach(suggestions, id: \.self) { tag in
#if os(macOS)
                        MacSuggestedTagButton(tag: tag) { onSelect(tag) }
#else
                        Button { onSelect(tag) } label: {
                            Text(tag)
                                .font(.subheadline)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .foregroundStyle(TagPalette.color(for: tag))
                                .background(TagPalette.color(for: tag).opacity(0.12), in: .capsule)
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(tkLocalizedFormat("添加标签 %@", tag))
                        .accessibilityIdentifier("tag.suggestion.\(tag)")
#endif
                    }
                }
            } else if failedToLoad {
                Text(tkLocalized("无法读取常用标签，仍可手动输入。"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if showsEmptyState {
                Text(tkLocalized("暂无可添加的常用标签"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .task { reload() }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in reload() }
    }

    private var tagSpacing: CGFloat {
#if os(macOS)
        4
#else
        8
#endif
    }

    private var tagRowSpacing: CGFloat {
#if os(macOS)
        6
#else
        8
#endif
    }

    private func reload() {
        do {
            tagGroups = try BookRepository(context: context).books().map(\.tags)
                + WishlistRepository(context: context).items().map(\.tags)
            failedToLoad = false
        } catch { failedToLoad = true }
    }
}

#if os(macOS)
private struct MacSuggestedTagButton: View {
    let tag: String
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        let color = TagPalette.color(for: tag)
        Button(action: action) {
            Text(tag)
                .font(.system(size: 12))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .frame(minHeight: 24)
                .foregroundStyle(color)
                .background(color.opacity(isHovering ? 0.2 : 0.12), in: .capsule)
                .overlay { Capsule().strokeBorder(color.opacity(isHovering ? 0.45 : 0.2), lineWidth: 0.5) }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help(tkLocalizedFormat("添加标签 %@", tag))
        .accessibilityLabel(tkLocalizedFormat("添加标签 %@", tag))
        .accessibilityIdentifier("tag.suggestion.\(tag)")
    }
}

struct MacTagSuggestionsPopover: View {
    let selected: [String]
    let onSelect: (String) -> Void
    @State private var suggestionsHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(tkLocalized("常用标签"))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
            ScrollView {
                CommonBookTagSuggestions(selected: selected, showsEmptyState: true, onSelect: onSelect)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { suggestionsHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: min(suggestionsHeight, 220))
        }
        .padding(12)
        .frame(width: 240)
        .accessibilityIdentifier("mac.tags.suggestions")
    }
}
#endif

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
