import SwiftUI
import SwiftData
import TomeKeepDesignSystem
import TomeKeepDomain
import TomeKeepMetadata
import TomeKeepMigration
import TomeKeepNetworking
import TomeKeepPersistence
import TomeKeepPricing
import TomeKeepSync
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

public enum TomeKeepPlatform: Sendable {
    case iOS
    case macOS
}

public struct NativeMigrationRootView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("tomekeep.apiBaseURL") private var apiBaseURL = "https://tomekeep.pages.dev/api/"
    @AppStorage(tkLanguagePreferenceKey) private var languageCode = tkDefaultLanguageCode
    @AppStorage("tomekeep.appearance") private var appearance = TomeKeepAppearance.system.rawValue
    private let platform: TomeKeepPlatform
    @State private var macSelection: MacSidebarDestination? = .library
    @State private var iosSelection: IOSRootDestination = .library
    @State private var syncCoordinator = NativeSyncCoordinator()
    @State private var isCheckingStagedMigration = false

    public init(platform: TomeKeepPlatform) {
        self.platform = platform
    }

    public var body: some View {
        appearanceContent
            .environment(\.locale, Locale(identifier: languageCode))
            .environment(syncCoordinator)
            .task {
                await restoreApplicationSession()
                if syncCoordinator.canAccessApplication {
                    await importStagedLegacyDataIfPresent()
                    await synchronizeIfPossible(trigger: .launch)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await synchronizeIfPossible(trigger: .foreground) }
            }
            .onChange(of: syncCoordinator.accountState) { previous, current in
                guard previous == .signedOut, current == .signedIn else { return }
                Task {
                    await importStagedLegacyDataIfPresent()
                    await synchronizeIfPossible(trigger: .login)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncRequested)) { _ in
                Task { await synchronizeIfPossible(trigger: .localChange) }
            }
    }

    @ViewBuilder
    private var appearanceContent: some View {
        switch TomeKeepAppearance(rawValue: appearance) ?? .system {
        case .system:
            platformContent
                .preferredColorScheme(nil)
                .id(TomeKeepAppearance.system.rawValue)
        case .light:
            platformContent
                .preferredColorScheme(.light)
                .id(TomeKeepAppearance.light.rawValue)
        case .dark:
            platformContent
                .preferredColorScheme(.dark)
                .id(TomeKeepAppearance.dark.rawValue)
        }
    }

    @ViewBuilder
    private var platformContent: some View {
        switch syncCoordinator.accountState {
        case .unknown:
            authenticationLoadingView
        case .signedOut:
            AuthenticationGateView()
        case .signedIn:
            authenticatedPlatformContent
        }
    }

    @ViewBuilder
    private var authenticatedPlatformContent: some View {
        switch platform {
        case .iOS:
            TabView(selection: $iosSelection) {
                NavigationStack { LibraryView(platform: platform) }
                    .tabItem { Label("书库", systemImage: "books.vertical") }
                    .tag(IOSRootDestination.library)
                NavigationStack { WishlistView() }
                    .tabItem { Label("愿望", systemImage: "heart") }
                    .tag(IOSRootDestination.wishlist)
                NavigationStack { SettingsView(platform: platform) }
                    .tabItem { Label("设置", systemImage: "gearshape") }
                    .tag(IOSRootDestination.settings)
            }
        case .macOS:
#if os(macOS)
            HStack(spacing: 0) {
                VStack(spacing: 8) {
                    Divider()
                        .frame(width: 40)
                        .padding(.vertical, 6)

                    SidebarIconButton(tkLocalized("书库"), symbol: "book", selected: macSelection == .library) {
                        macSelection = .library
                    }
                    SidebarIconButton(tkLocalized("愿望单"), symbol: "star", selected: macSelection == .wishlist) {
                        macSelection = .wishlist
                    }
                    SidebarIconButton(tkLocalized("设置与同步"), symbol: "cloud", selected: macSelection == .settings) {
                        macSelection = .settings
                    }
                    Spacer()
                    ProfileSwitcherButton()
                    SidebarTextButton(languageCode.hasPrefix("zh") ? "EN" : "中", help: tkLocalized("切换语言")) {
                        languageCode = languageCode.hasPrefix("zh") ? "en" : "zh-Hans"
                    }
                    SidebarIconButton(appearanceLabel, symbol: appearanceSymbol, selected: false) {
                        appearance = TomeKeepAppearance(rawValue: appearance)?.next.rawValue ?? TomeKeepAppearance.system.rawValue
                    }
                }
                .padding(.vertical, 12)
                .frame(width: 80)

                Divider()

                NavigationStack {
                    switch macSelection ?? .library {
                    case .library:
                        LibraryView(platform: platform)
                    case .wishlist:
                        WishlistView()
                    case .settings:
                        SettingsView(platform: platform)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .onReceive(NotificationCenter.default.publisher(for: TomeKeepCommandNotification.showLibrary)) { _ in
                macSelection = .library
            }
            .onReceive(NotificationCenter.default.publisher(for: TomeKeepCommandNotification.showWishlist)) { _ in
                macSelection = .wishlist
            }
            .onReceive(NotificationCenter.default.publisher(for: TomeKeepCommandNotification.showPrices)) { _ in
                macSelection = .wishlist
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: TomeKeepAppNotification.openPriceHistory, object: nil)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: TomeKeepCommandNotification.showSettings)) { _ in
                macSelection = .settings
            }
            .onReceive(NotificationCenter.default.publisher(for: TomeKeepCommandNotification.newBook)) { _ in
                macSelection = .library
                DispatchQueue.main.async {
                    NotificationCenter.default.post(
                        name: TomeKeepCommandNotification.openBookEditor,
                        object: nil
                    )
                }
            }
#else
            EmptyView()
#endif
        }
    }

    private var authenticationLoadingView: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text(verbatim: tkLocalized("正在检查登录状态…"))
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var appearanceSymbol: String {
        switch TomeKeepAppearance(rawValue: appearance) ?? .system {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon.fill"
        }
    }

    private var appearanceLabel: String {
        switch TomeKeepAppearance(rawValue: appearance) ?? .system {
        case .system: tkLocalized("跟随系统风格")
        case .light: tkLocalized("浅色风格")
        case .dark: tkLocalized("深色风格")
        }
    }

    @MainActor
    private func restoreApplicationSession() async {
        syncCoordinator.refreshAccountState()
        guard syncCoordinator.accountState == .signedIn else {
            if syncCoordinator.accountState == .unknown {
                syncCoordinator.markSignedOut()
            }
            return
        }
        guard let baseURL = automaticSyncBaseURL else {
            syncCoordinator.markSignedOut()
            return
        }

        do {
            guard let user = try await AuthenticationService(baseURL: baseURL).restoredUser() else {
                syncCoordinator.markSignedOut()
                return
            }
            ProfileAccountContext.currentID = user.id
            syncCoordinator.markSignedIn()
        } catch {
            // A previously authenticated device remains usable offline. The
            // following sync attempt exposes the network failure in Settings.
            syncCoordinator.markSignedIn()
        }
    }

    @MainActor
    private func synchronizeIfPossible(trigger: NativeSyncTrigger) async {
        guard syncCoordinator.accountState == .signedIn,
              let baseURL = automaticSyncBaseURL
        else { return }
        await syncCoordinator.synchronize(
            context: modelContext,
            baseURL: baseURL,
            uploadsPriceCache: platform == .macOS,
            trigger: trigger
        )
    }

    private var automaticSyncBaseURL: URL? {
        guard let url = URL(string: apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), let host = url.host,
              scheme == "https" || (scheme == "http" && isLocalSyncHost(host))
        else { return nil }
        return url.absoluteString.hasSuffix("/") ? url : URL(string: url.absoluteString + "/")
    }

    private func isLocalSyncHost(_ host: String) -> Bool {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" { return true }
        if host.hasPrefix("192.168.") || host.hasPrefix("10.") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 172 && (16...31).contains(parts[1])
    }

    @MainActor
    private func importStagedLegacyDataIfPresent() async {
        guard platform == .iOS, !isCheckingStagedMigration else { return }
        isCheckingStagedMigration = true
        defer { isCheckingStagedMigration = false }

        do {
            let sourceURL = try NativeStorageLocations.stagedLegacyImport()
            let databaseURL = sourceURL.appending(path: "db.json")
            guard FileManager.default.fileExists(atPath: databaseURL.path) else { return }

            let service = LegacyImportService()
            let preparation = try await service.prepare(
                sourceURL: sourceURL,
                destinationCoversURL: NativeStorageLocations.covers()
            )
            let markerKey = "tomekeep.stagedLegacyImport.\(preparation.sourceDatabaseSHA256)"
            guard !UserDefaults.standard.bool(forKey: markerKey) else { return }

            let repository = LibraryArchiveRepository(context: modelContext)
            let counts = try repository.importArchive(
                preparation.archive,
                sourceHash: preparation.sourceDatabaseSHA256,
                reportURL: nil
            )
            let reportURL = try await service.writeReport(
                preparation: preparation,
                destinationCounts: LegacyArchiveCounts(
                    books: counts.books,
                    wishlist: counts.wishlist,
                    profiles: counts.profiles,
                    readingStates: counts.readingStates,
                    priceCacheEntries: counts.priceCacheEntries,
                    covers: preparation.coverDigests.count
                ),
                reportsDirectory: NativeStorageLocations.migrationReports()
            )
            try repository.recordImportReportURL(reportURL)
            UserDefaults.standard.set(true, forKey: markerKey)
            NotificationCenter.default.post(name: TomeKeepAppNotification.syncCompleted, object: nil)
            requestTomeKeepSync()
        } catch {
            // Keep launch non-blocking. The Settings migration screen exposes the
            // same staged source and reports a detailed, actionable error.
        }
    }
}

private enum TomeKeepAppearance: String {
    case system
    case light
    case dark

    var next: Self {
        switch self {
        case .system: .light
        case .light: .dark
        case .dark: .system
        }
    }

}

private enum MacSidebarDestination: Hashable {
    case library
    case wishlist
    case settings
}

private enum IOSRootDestination: Hashable {
    case library
    case wishlist
    case settings
}

private struct SidebarIconButton: View {
    let title: String
    let symbol: String
    let selected: Bool
    let action: () -> Void
    @State private var isHovering = false

    init(_ title: String, symbol: String, selected: Bool, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.selected = selected
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 40, height: 40)
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                .background(
                    selected ? Color.accentColor.opacity(0.14) : (isHovering ? Color.primary.opacity(0.06) : Color.clear),
                    in: .rect(cornerRadius: 11)
                )
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help(Text(verbatim: title))
        .accessibilityLabel(Text(verbatim: title))
    }
}

private struct SidebarTextButton: View {
    let text: String
    let help: String
    let action: () -> Void
    @State private var isHovering = false

    init(_ text: String, help: String, action: @escaping () -> Void) {
        self.text = text
        self.help = help
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(verbatim: text)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .frame(width: 40, height: 40)
                .foregroundStyle(Color.secondary)
                .background(isHovering ? Color.primary.opacity(0.06) : Color.clear, in: .rect(cornerRadius: 11))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help(Text(verbatim: help))
        .accessibilityLabel(Text(verbatim: help))
    }
}

#if os(macOS)
private struct ProfileSwitcherButton: View {
    @Environment(\.modelContext) private var modelContext
    @State private var profiles: [UserProfile] = []
    @State private var activeProfileID: String?
    @State private var isPresented = false
    @State private var errorMessage: String?
    @State private var isHovering = false

    var body: some View {
        Button {
            reload()
            isPresented.toggle()
        } label: {
            Image(systemName: "person")
                .font(.system(size: 16, weight: .medium))
                .frame(width: 40, height: 40)
                .foregroundStyle(isPresented ? Color.accentColor : Color.secondary)
                .background(
                    isPresented ? Color.accentColor.opacity(0.14) : (isHovering ? Color.primary.opacity(0.06) : Color.clear),
                    in: .rect(cornerRadius: 11)
                )
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help(Text(verbatim: activeProfileName ?? tkLocalized("当前档案")))
        .accessibilityLabel(Text(verbatim: activeProfileName ?? tkLocalized("当前档案")))
        .popover(isPresented: $isPresented, arrowEdge: .leading) {
            VStack(alignment: .leading, spacing: 4) {
                Text(tkLocalized("当前档案"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.top, 8)

                ForEach(profiles) { profile in
                    Button {
                        select(profile)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark")
                                .frame(width: 12)
                                .opacity(profile.id == activeProfileID ? 1 : 0)
                            Text(profile.name)
                                .lineLimit(1)
                            Spacer(minLength: 20)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                }
            }
            .frame(minWidth: 190)
            .padding(.bottom, 6)
        }
        .alert("无法完成操作", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(errorMessage ?? tkLocalized("未知错误"))
        }
        .task { reload() }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in
            reload()
        }
    }

    private var activeProfileName: String? {
        profiles.first { $0.id == activeProfileID }?.name
    }

    private func reload() {
        do {
            let repository = ProfileRepository(context: modelContext)
            profiles = try repository.profiles()
            activeProfileID = try repository.activeProfileID() ?? profiles.first?.id
        } catch {
            errorMessage = tkLocalized("无法读取档案。")
        }
    }

    private func select(_ profile: UserProfile) {
        do {
            try ProfileRepository(context: modelContext).setActiveProfile(id: profile.id)
            activeProfileID = profile.id
            isPresented = false
            NotificationCenter.default.post(name: TomeKeepAppNotification.activeProfileChanged, object: nil)
        } catch {
            errorMessage = tkLocalized("无法切换阅读档案。")
        }
    }
}
#endif

private enum BookSort: String, CaseIterable {
    case recentlyAdded
    case completed
    case title
    case author

    var label: String {
        switch self {
        case .recentlyAdded: tkLocalized("最近添加")
        case .completed: tkLocalized("完成日期")
        case .title: tkLocalized("书名")
        case .author: tkLocalized("作者")
        }
    }

    var symbol: String {
        switch self {
        case .recentlyAdded: "calendar"
        case .completed: "checkmark.circle"
        case .title: "text.bubble"
        case .author: "person"
        }
    }
}

private enum SortDirection: String, CaseIterable {
    case ascending
    case descending

    var symbol: String { self == .ascending ? "arrow.up" : "arrow.down" }
    var label: String { tkLocalized(self == .ascending ? "升序" : "降序") }
}

private enum ReadingFilter: String, CaseIterable {
    case all
    case unread
    case reading
    case read

    var label: String {
        switch self {
        case .all: tkLocalized("全部状态")
        case .unread: tkLocalized("未读")
        case .reading: tkLocalized("在读")
        case .read: tkLocalized("已读")
        }
    }

    var symbol: String {
        switch self {
        case .all: "square.grid.2x2"
        case .unread: "bookmark"
        case .reading: "book"
        case .read: "checkmark.circle"
        }
    }
}

func nextReadingStatus(after status: ReadingStatus) -> ReadingStatus {
    switch status {
    case .unread: .reading
    case .reading: .read
    case .read: .unread
    }
}

func normalizedBookTags(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.compactMap { value in
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, seen.insert(normalized).inserted else { return nil }
        return normalized
    }
}

private enum LibraryDisplayMode: String, CaseIterable {
    case covers
    case details

    var label: String { tkLocalized(self == .covers ? "简要视图" : "详细视图") }
    var symbol: String { self == .covers ? "square.grid.3x3" : "square.grid.2x2" }
}

private enum WishlistSort: String, CaseIterable {
    case recentlyAdded
    case priority
    case title
    case author
    case pendingBuy

    var label: String {
        switch self {
        case .recentlyAdded: tkLocalized("最近添加")
        case .priority: tkLocalized("优先级")
        case .title: tkLocalized("书名")
        case .author: tkLocalized("作者")
        case .pendingBuy: tkLocalized("待购买优先")
        }
    }

    var symbol: String {
        switch self {
        case .recentlyAdded: "calendar"
        case .priority: "exclamationmark.circle"
        case .title: "text.bubble"
        case .author: "person"
        case .pendingBuy: "cart"
        }
    }
}

private enum WishlistPurchaseFilter: String, CaseIterable {
    case all
    case pending

    var label: String { tkLocalized(self == .all ? "全部愿望" : "待购买") }
    var symbol: String { self == .all ? "square.grid.2x2" : "cart" }
}

private let untaggedFilterToken = "__untagged__"

private enum TagPalette {
    // Mirrors the old client's violet/blue/emerald/amber/rose/sky/fuchsia/teal palette.
    static let colors: [Color] = [
        Color(red: 0.55, green: 0.36, blue: 0.96),
        Color(red: 0.23, green: 0.51, blue: 0.96),
        Color(red: 0.06, green: 0.70, blue: 0.50),
        Color(red: 0.96, green: 0.62, blue: 0.04),
        Color(red: 0.95, green: 0.27, blue: 0.42),
        Color(red: 0.05, green: 0.65, blue: 0.91),
        Color(red: 0.85, green: 0.27, blue: 0.94),
        Color(red: 0.08, green: 0.65, blue: 0.62),
    ]

    static func color(for tag: String) -> Color {
        colors[tagPaletteIndex(for: tag, paletteCount: colors.count)]
    }
}

func tagPaletteIndex(for tag: String, paletteCount: Int = 8) -> Int {
    precondition(paletteCount > 0)
    var hash: UInt32 = 2_166_136_261
    for scalar in tag.unicodeScalars {
        hash ^= scalar.value
        hash = hash &* 16_777_619
    }
    return Int(hash % UInt32(paletteCount))
}

private struct TagFilterBar: View {
    let tags: [String]
    @Binding var selection: Set<String>
    var compactColumns: Binding<Int>? = nil
    var includesUntagged = false

    var body: some View {
#if os(iOS)
        ScrollView(.horizontal, showsIndicators: false) {
            tagButtons
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
        }
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
#else
        tagButtons
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.bar)
            .overlay(alignment: .bottom) { Divider() }
#endif
    }

    @ViewBuilder
    private var tagButtons: some View {
        HStack(spacing: 7) {
            if includesUntagged {
                let selected = selection.contains(untaggedFilterToken)
                Button {
                    if selected { selection.remove(untaggedFilterToken) }
                    else {
                        selection.removeAll()
                        selection.insert(untaggedFilterToken)
                    }
                } label: {
                    Label(tkLocalized("无标签"), systemImage: "tag.slash")
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .foregroundStyle(selected ? Color.white : Color.secondary)
                        .background(selected ? Color.purple : Color.clear, in: .capsule)
                        .overlay {
                            Capsule().stroke(selected ? Color.purple : Color.primary.opacity(0.16), lineWidth: 1)
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("tag.filter.untagged")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
            ForEach(tags, id: \.self) { tag in
                let selected = selection.contains(tag)
                let color = TagPalette.color(for: tag)
                Button {
                    if selected { selection.remove(tag) }
                    else {
                        selection.remove(untaggedFilterToken)
                        selection.insert(tag)
                    }
                } label: {
                    Text(tag)
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .foregroundStyle(selected ? Color.white : Color.secondary)
                        .background(selected ? color : Color.clear, in: .capsule)
                        .overlay {
                            Capsule().stroke(selected ? color : Color.primary.opacity(0.16), lineWidth: 1)
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("tag.filter.\(tag)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
            if !selection.isEmpty {
                Button("清除标签筛选", systemImage: "xmark.circle.fill") {
                    selection.removeAll()
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("清除标签筛选")
            }
            Spacer(minLength: 0)
            if let compactColumns {
                Slider(
                    value: Binding(
                        get: { Double(compactColumns.wrappedValue) },
                        set: { compactColumns.wrappedValue = Int($0.rounded()) }
                    ),
                    in: 8...20,
                    step: 1
                )
                .frame(width: 96)
                .help("每行 \(compactColumns.wrappedValue) 本")
                .accessibilityLabel("每行封面数量")
                .accessibilityValue("\(compactColumns.wrappedValue)")
            }
        }
    }
}

#if os(iOS)
private struct IOSInlineSearchField: View {
    @Binding var text: String
    let prompt: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)

            TextField(prompt, text: $text)
                .focused($isFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)

            if !text.isEmpty {
                Button("清除搜索", systemImage: "xmark.circle.fill") {
                    text = ""
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 38)
        .background(.quaternary, in: .rect(cornerRadius: 10))
        .padding(.horizontal, 16)
        .padding(.vertical, 5)
        .accessibilityIdentifier("inline.search.field")
        .onAppear { isFocused = true }
    }
}
#endif

#if os(macOS)
private struct SearchField: View {
    @Binding var text: String
    let prompt: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(text: $text) {
                Text(verbatim: prompt)
            }
            .textFieldStyle(.plain)
            if !text.isEmpty {
                Button("清除搜索", systemImage: "xmark.circle.fill") { text = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                    .help(tkLocalized("清除搜索"))
            }
        }
        .padding(.horizontal, 9)
        .frame(height: 30)
        .background(Color(nsColor: .textBackgroundColor), in: .rect(cornerRadius: 7))
        .overlay {
            RoundedRectangle(cornerRadius: 7)
                .stroke(Color.primary.opacity(0.12), lineWidth: 1)
        }
    }
}

private struct ControlGroupBox<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 1) { content }
            .padding(2)
            .background(Color(nsColor: .controlBackgroundColor), in: .rect(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.primary.opacity(0.10), lineWidth: 1)
            }
    }
}
#endif

private struct ToolbarChoiceButton: View {
    let symbol: String
    let label: String
    let selected: Bool
    var badge: String? = nil
    let action: () -> Void
#if os(macOS)
    @State private var isHovering = false
#endif

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(selected ? Color.accentColor : Color.clear)

                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(selected ? Color.white : Color.secondary)
            }
            .frame(width: 28, height: 24)
            .contentShape(.rect)
            .overlay(alignment: .topTrailing) {
                if let badge {
                    Text(badge)
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 12, height: 12)
                        .background(.blue, in: .circle)
                        .offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
        .contentShape(.rect)
        .help(label)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
#if os(macOS)
        .overlay(alignment: .bottom) {
            if isHovering {
                Text(verbatim: label)
                    .font(.caption2)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(.regularMaterial, in: .rect(cornerRadius: 5))
                    .overlay {
                        RoundedRectangle(cornerRadius: 5)
                            .stroke(Color.primary.opacity(0.12), lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.14), radius: 4, y: 2)
                    .fixedSize()
                    .offset(y: 31)
                    .allowsHitTesting(false)
            }
        }
        .zIndex(isHovering ? 100 : 0)
        .onHover { isHovering = $0 }
#endif
    }
}

private struct TagBadgeRow: View {
    let tags: [String]

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(tags.prefix(3)), id: \.self) { tag in
                let color = TagPalette.color(for: tag)
                Text(tag)
                    .font(.caption2.weight(.medium))
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .foregroundStyle(color)
                    .background(color.opacity(0.12), in: .capsule)
            }
            if tags.count > 3 {
                Text("+\(tags.count - 3)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct EditorRoute<Value>: Identifiable {
    let id = UUID()
    let value: Value?
}

struct BookDateSection: Identifiable {
    let id: String
    let yearLabel: String?
    let monthLabel: String?
    let showsYear: Bool
    let isUnfinished: Bool
    let books: [Book]
}

func makeBookDateSections(
    books: [Book],
    locale: Locale,
    date: (Book) -> Date?
) -> [BookDateSection] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = locale
    calendar.timeZone = .current

    struct PendingSection {
        let year: Int
        let month: Int
        var books: [Book]
    }

    var pending: [PendingSection] = []
    var unfinished: [Book] = []
    for book in books {
        guard let value = date(book) else {
            unfinished.append(book)
            continue
        }
        let components = calendar.dateComponents([.year, .month], from: value)
        guard let year = components.year, let month = components.month else {
            unfinished.append(book)
            continue
        }
        if let last = pending.last, last.year == year, last.month == month {
            pending[pending.count - 1].books.append(book)
        } else {
            pending.append(PendingSection(year: year, month: month, books: [book]))
        }
    }

    var previousYear: Int?
    var result = pending.compactMap { section -> BookDateSection? in
        guard let representative = calendar.date(from: DateComponents(year: section.year, month: section.month, day: 1)) else {
            return nil
        }
        let showsYear = previousYear != section.year
        previousYear = section.year
        return BookDateSection(
            id: "\(section.year)-\(section.month)",
            yearLabel: representative.formatted(.dateTime.year().locale(locale)),
            monthLabel: representative.formatted(.dateTime.month(.abbreviated).locale(locale)),
            showsYear: showsYear,
            isUnfinished: false,
            books: section.books
        )
    }
    if !unfinished.isEmpty {
        result.append(BookDateSection(
            id: "unfinished",
            yearLabel: nil,
            monthLabel: nil,
            showsYear: true,
            isUnfinished: true,
            books: unfinished
        ))
    }
    return result
}

private struct CoverPreviewRoute: Identifiable {
    let id = UUID()
    let title: String
    let fileURL: URL
}

private struct CoverPreviewOverlay: View {
    let preview: CoverPreviewRoute
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.75)
                .ignoresSafeArea()
                .contentShape(.rect)
                .onTapGesture(perform: onDismiss)

            TomeKeepBookCover(fileURL: preview.fileURL)
                .frame(maxWidth: 520, maxHeight: 700)
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .shadow(color: .black.opacity(0.45), radius: 24, y: 12)
                .padding(36)
                .contentShape(.rect)
                .onTapGesture {}
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
#if os(macOS)
        .onExitCommand(perform: onDismiss)
#endif
        .accessibilityLabel(preview.title)
        .accessibilityHint(tkLocalized("点击封面外区域关闭"))
        .accessibilityIdentifier("cover.preview")
    }
}

private struct LibraryView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var books: [Book] = []
    @State private var searchText = ""
    @State private var editingBook: Book?
    @State private var editorRoute: EditorRoute<Book>?
    @State private var pendingDeletion: Book?
    @State private var errorMessage: String?
    @AppStorage("native.library.sort") private var sort: BookSort = .recentlyAdded
    @AppStorage("native.library.sortDirection") private var sortDirection: SortDirection = .descending
    @State private var selectedTags: Set<String> = []
    @AppStorage("native.library.displayMode") private var displayMode: LibraryDisplayMode = .covers
    @AppStorage("native.library.compactColumns") private var compactColumns = 8
    @AppStorage("native.library.readingFilter") private var readingFilter: ReadingFilter = .all
    @AppStorage("native.library.selectedTags") private var storedSelectedTags = ""
    @State private var activeProfile: UserProfile?
    @State private var readingStates: [String: ReadingState] = [:]
    @State private var progressPulse = false
    @State private var coverPreview: CoverPreviewRoute?
    @State private var expandedCompactBookID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
#if os(iOS)
    @State private var isPresentingContinuousScanner = false
    @State private var isSearchPresented = false
#endif

    let platform: TomeKeepPlatform

    var body: some View {
        let titledContent = libraryContent.navigationTitle(Text(verbatim: tkLocalized("书库")))
#if os(macOS)
        let navigationBase = titledContent.toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("添加书籍", systemImage: "plus") { presentAdd() }
                    .help(tkLocalized("添加书籍"))
                    .accessibilityIdentifier("library.add.toolbar")
            }
        }
#else
        let navigationBase = titledContent
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(isSearchPresented ? "关闭搜索" : "搜索", systemImage: isSearchPresented ? "xmark" : "magnifyingglass") {
                        toggleSearch()
                    }
                    .accessibilityIdentifier("library.search.toggle")
                }
                ToolbarItem(placement: .principal) {
                    Text(verbatim: tkLocalized("书库"))
                        .font(.title3.weight(.semibold))
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }
                ToolbarItem { librarySortMenu }
                ToolbarItem {
                    Button {
                        displayMode = displayMode == .covers ? .details : .covers
                    } label: {
                        Label(
                            displayMode == .covers ? "切换到详细视图" : "切换到封面视图",
                            systemImage: displayMode == .covers ? "rectangle.grid.1x2" : "square.grid.2x2"
                        )
                    }
                    .accessibilityIdentifier("library.display.toggle")
                }
                ToolbarItem {
                    Button("连续扫描", systemImage: "barcode.viewfinder") {
                        isPresentingContinuousScanner = true
                    }
                    .accessibilityIdentifier("library.scan.toolbar")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("添加书籍", systemImage: "plus") { presentAdd() }
                        .accessibilityIdentifier("library.add.toolbar")
                }
            }
#endif
        let navigation = navigationBase.safeAreaInset(edge: .bottom) {
            libraryProgress
        }

        let presentations = navigation.sheet(item: $editorRoute) { route in
            BookEditorView(book: route.value, onSave: save)
                .presentationDetents(platform == .iOS ? [.medium, .large] : [.large])
                .frame(minWidth: platform == .macOS ? 480 : nil)
        }
#if os(iOS)
        .fullScreenCover(isPresented: $isPresentingContinuousScanner) {
            ContinuousISBNImportView(onFinished: reload)
        }
#endif
        .overlay {
            if let coverPreview {
                CoverPreviewOverlay(preview: coverPreview) {
                    self.coverPreview = nil
                }
                .zIndex(1_000)
            }
        }
        .confirmationDialog(
            "从书库删除《\(pendingDeletion?.title ?? "")》？",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除", role: .destructive) {
                if let book = pendingDeletion { delete(book) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("该记录会标记为已删除，并在未来同步时传递到其他设备。")
        }
        .alert("无法完成操作", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(errorMessage ?? tkLocalized("未知错误"))
        }

        let lifecycle = presentations.task {
            selectedTags = decodeStoredTags(storedSelectedTags)
            reload()
            progressPulse = !reduceMotion
        }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in
            reload()
        }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.activeProfileChanged)) { _ in
            reload()
        }
        .onChange(of: selectedTags) { _, value in
            storedSelectedTags = encodeStoredTags(value)
        }
        .onChange(of: sort) { _, value in
            sortDirection = value == .title || value == .author ? .ascending : .descending
        }
#if os(macOS)
        return lifecycle.onReceive(NotificationCenter.default.publisher(for: TomeKeepCommandNotification.openBookEditor)) { _ in
            presentAdd()
        }
#else
        return lifecycle
#endif
    }

    @ViewBuilder
    private var libraryContent: some View {
        VStack(spacing: 0) {
#if os(macOS)
            libraryControlBar
                .zIndex(10)
#else
            if isSearchPresented {
                IOSInlineSearchField(text: $searchText, prompt: tkLocalized("标题、作者或 ISBN"))
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
#endif
            if !allTags.isEmpty {
                TagFilterBar(
                    tags: allTags,
                    selection: $selectedTags,
                    compactColumns: displayMode == .covers ? $compactColumns : nil
                )
            }
            Group {
            if books.isEmpty {
                ContentUnavailableView {
                    Label("书库为空", systemImage: "books.vertical")
                } description: {
                    Text("录入第一本书，数据会保存在这台设备上。")
                } actions: {
                    Button("添加书籍", systemImage: "plus") {
                        presentAdd()
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("library.add.empty")
                }
            } else if filteredBooks.isEmpty {
                filteredLibraryEmptyState
            } else {
#if os(macOS)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if let sections = groupedBookSections {
                            ForEach(sections) { section in
                                VStack(alignment: .leading, spacing: 8) {
                                    bookSectionHeader(section)
                                    if displayMode == .covers {
                                        compactBookGrid(section.books)
                                    } else {
                                        detailedBookGrid(section.books)
                                    }
                                }
                            }
                        } else if displayMode == .covers {
                            compactBookGrid(filteredBooks)
                        } else {
                            detailedBookGrid(filteredBooks)
                        }
                    }
                    .padding(16)
                }
                .background(Color(nsColor: .windowBackgroundColor))
#else
                if displayMode == .covers {
                    ScrollView {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 96, maximum: 132), spacing: 14)],
                            alignment: .leading,
                            spacing: 18
                        ) {
                            ForEach(filteredBooks) { book in
                                IOSCompactBookCard(book: book) { presentEdit(book) }
                                    .contextMenu { iosBookContextMenu(book) }
                            }
                        }
                        .padding(16)
                    }
                    .refreshable { reload() }
                } else {
                    List {
                        if let sections = iosGroupedBookSections {
                            ForEach(sections) { section in
                                Section {
                                    ForEach(section.books) { book in iosBookRow(book) }
                                } header: {
                                    iosSectionLabel(section)
                                }
                            }
                        } else {
                            ForEach(filteredBooks) { book in iosBookRow(book) }
                        }
                    }
                    .listStyle(.inset)
                    .refreshable { reload() }
                }
#endif
            }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder
    private var filteredLibraryEmptyState: some View {
        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView.search(text: searchText)
        } else {
            ContentUnavailableView(
                tkLocalized("没有符合筛选条件的书籍"),
                systemImage: "line.3.horizontal.decrease.circle",
                description: Text(verbatim: tkLocalized("可取消标签或阅读状态筛选。"))
            )
        }
    }

    private var librarySortMenu: some View {
        Menu {
                    Picker("排序", selection: $sort) {
                        ForEach(BookSort.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    Picker("方向", selection: $sortDirection) {
                        ForEach(SortDirection.allCases, id: \.self) { direction in
                            Label(direction.label, systemImage: direction.symbol).tag(direction)
                        }
                    }
                    Divider()
                    Picker("阅读状态", selection: $readingFilter) {
                        ForEach(ReadingFilter.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
        } label: {
            Label("筛选与排序", systemImage: selectedTags.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
    }

#if os(iOS)
    private func toggleSearch() {
        if isSearchPresented { searchText = "" }
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.22)) {
            isSearchPresented.toggle()
        }
    }
#endif

    private var librarySortControls: some View {
        HStack(spacing: 8) {
            HStack(spacing: 1) {
                ForEach(BookSort.allCases, id: \.self) { option in
                    ToolbarChoiceButton(
                        symbol: option.symbol,
                        label: option.label,
                        selected: sort == option,
                        badge: sort == option ? (sortDirection == .ascending ? "↑" : "↓") : nil
                    ) {
                        if sort == option { sortDirection = sortDirection == .ascending ? .descending : .ascending }
                        else { sort = option }
                    }
                }
            }
            .padding(2)
            .background(.quaternary, in: .rect(cornerRadius: 8))
            HStack(spacing: 1) {
                ForEach(ReadingFilter.allCases, id: \.self) { option in
                    ToolbarChoiceButton(symbol: option.symbol, label: option.label, selected: readingFilter == option) {
                        readingFilter = option
                    }
                }
            }
            .padding(2)
            .background(.quaternary, in: .rect(cornerRadius: 8))
        }
    }

#if os(macOS)
    private var libraryControlBar: some View {
        HStack(spacing: 12) {
            SearchField(text: $searchText, prompt: tkLocalized("书名、作者或 ISBN"))
                .frame(width: 230)

            ControlGroupBox {
                ForEach(ReadingFilter.allCases, id: \.self) { option in
                    ToolbarChoiceButton(symbol: option.symbol, label: option.label, selected: readingFilter == option) {
                        readingFilter = option
                    }
                }
            }

            Spacer(minLength: 18)

            ControlGroupBox {
                ForEach(BookSort.allCases, id: \.self) { option in
                    ToolbarChoiceButton(
                        symbol: option.symbol,
                        label: option.label,
                        selected: sort == option,
                        badge: sort == option ? (sortDirection == .ascending ? "↑" : "↓") : nil
                    ) {
                        if sort == option { sortDirection = sortDirection == .ascending ? .descending : .ascending }
                        else { sort = option }
                    }
                }
            }

            ControlGroupBox {
                ForEach(LibraryDisplayMode.allCases, id: \.self) { mode in
                    ToolbarChoiceButton(symbol: mode.symbol, label: mode.label, selected: displayMode == mode) {
                        if mode != .covers { expandedCompactBookID = nil }
                        displayMode = mode
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
    }
#endif

#if os(macOS)
    @ViewBuilder
    private var libraryDisplayControls: some View {
                Picker("显示方式", selection: $displayMode) {
                    ForEach(LibraryDisplayMode.allCases, id: \.self) { mode in
                        Label(mode.label, systemImage: mode.symbol).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                if displayMode == .covers {
                    Slider(value: Binding(
                        get: { Double(compactColumns) },
                        set: { compactColumns = Int($0.rounded()) }
                    ), in: 8...20, step: 1)
                    .frame(width: 90)
                    .help("每行 \(compactColumns) 本")
                    .accessibilityLabel("每行封面数量")
                    .accessibilityValue("\(compactColumns)")
                }
    }
#endif

    @ViewBuilder
    private var libraryProgress: some View {
        if !books.isEmpty {
                VStack(spacing: 7) {
                    ProgressView(value: readingProgress)
                        .tint(.accentColor)
                        .opacity(progressPulse ? 0.72 : 1)
                        .animation(
                            reduceMotion ? nil : .easeInOut(duration: 1.6).repeatForever(autoreverses: true),
                            value: progressPulse
                        )
                        .accessibilityLabel("阅读进度")
                        .accessibilityValue("\(readCount) / \(filteredBooks.count) 已读")
                    HStack(spacing: 6) {
                        Text("\(readCount)/\(filteredBooks.count) 已读")
                        Text("· 本机书库 \(books.count) 本")
                        if let activeProfile { Text("· \(activeProfile.name)") }
                        if !selectedTags.isEmpty { Text("· \(selectedTags.count) 个标签") }
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(.bar)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("library.summary")
        }
    }

#if os(macOS)
    private var groupedBookSections: [BookDateSection]? {
        let locale = Locale(identifier: UserDefaults.standard.string(forKey: tkLanguagePreferenceKey) ?? tkDefaultLanguageCode)
        switch sort {
        case .recentlyAdded:
            return makeBookDateSections(books: filteredBooks, locale: locale, date: \.addedAt)
        case .completed:
            return makeBookDateSections(books: filteredBooks, locale: locale) { readingStates[$0.id]?.completedAt }
        case .title, .author:
            return nil
        }
    }

    @ViewBuilder
    private func bookSectionHeader(_ section: BookDateSection) -> some View {
        if section.isUnfinished {
            Text(tkLocalized("未读完"))
                .font(.title3.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
                .padding(.bottom, 4)
                .overlay(alignment: .bottom) { Divider() }
        } else {
            if section.showsYear, let year = section.yearLabel {
                Text(verbatim: year)
                    .font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                    .padding(.bottom, 4)
                    .overlay(alignment: .bottom) { Divider() }
            }
            if let month = section.monthLabel {
                Text(verbatim: month)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
            }
        }
    }

    private func compactBookGrid(_ values: [Book]) -> some View {
        let rows = compactRows(values)
        return LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(row) { book in
                            BookCard(
                                book: book,
                                readingState: readingStates[book.id],
                                isExpanded: expandedCompactBookID == book.id,
                                action: { toggleCompactBook(book) },
                                zoom: { previewCover(book) }
                            )
                            .frame(maxWidth: .infinity)
                            .contextMenu { bookContextMenu(for: book, includesISBN: false) }
                        }
                        ForEach(row.count..<compactColumns, id: \.self) { _ in
                            CompactBookPlaceholder()
                                .frame(maxWidth: .infinity)
                        }
                    }

                    if let book = row.first(where: { $0.id == expandedCompactBookID }),
                       let columnIndex = row.firstIndex(where: { $0.id == book.id }) {
                        compactExpandedPanel(book, columnIndex: columnIndex)
                    }
                }
            }
        }
    }

    private func compactRows(_ values: [Book]) -> [[Book]] {
        stride(from: 0, to: values.count, by: compactColumns).map { start in
            Array(values[start..<min(start + compactColumns, values.count)])
        }
    }

    private func toggleCompactBook(_ book: Book) {
        withAnimation(compactPanelAnimation) {
            expandedCompactBookID = expandedCompactBookID == book.id ? nil : book.id
        }
    }

    private func dismissCompactBookIfCurrent(_ bookID: String) {
        guard expandedCompactBookID == bookID else { return }
        withAnimation(compactPanelAnimation) {
            expandedCompactBookID = nil
        }
    }

    private var compactPanelAnimation: Animation {
        if reduceMotion { return .easeOut(duration: 0.2) }
        return .timingCurve(0.23, 1, 0.32, 1, duration: 0.2)
    }

    private var compactPanelTransition: AnyTransition {
        if reduceMotion { return .opacity }
        return .scale(scale: 0.97, anchor: .topLeading).combined(with: .opacity)
    }

    private func compactExpandedPanel(_ book: Book, columnIndex: Int) -> some View {
        GeometryReader { proxy in
            let gap: CGFloat = 10
            let gridWidth = proxy.size.width
            let cellWidth = max(0, (gridWidth - gap * CGFloat(compactColumns - 1)) / CGFloat(compactColumns))
            let panelWidth = min(gridWidth, min(360, max(min(280, gridWidth), gridWidth * 0.34)))
            let desiredOffset = CGFloat(columnIndex) * (cellWidth + gap)
            let panelOffset = min(desiredOffset, max(0, gridWidth - panelWidth))

            DetailedBookCard(
                book: book,
                readingState: readingStates[book.id],
                onCycleStatus: { cycleReadingStatus(for: book) },
                onUpdateTags: { updateTags($0, for: book) },
                onCopyTitle: { copyToPasteboard(book.title) },
                onZoom: { previewCover(book) },
                onSave: { save($0, replacing: book) },
                onDelete: { pendingDeletion = book }
            )
            .frame(width: panelWidth)
            .offset(x: panelOffset)
            .background {
                OutsideClickMonitor {
                    dismissCompactBookIfCurrent(book.id)
                }
            }
            .contextMenu { bookContextMenu(for: book, includesISBN: true) }
            .transition(compactPanelTransition)
            .id(book.id)
        }
        .frame(height: 150)
    }

    private func detailedBookGrid(_ values: [Book]) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 260, maximum: 360), spacing: 12)],
            alignment: .leading,
            spacing: 12
        ) {
            ForEach(values) { book in
                DetailedBookCard(
                    book: book,
                    readingState: readingStates[book.id],
                    onCycleStatus: { cycleReadingStatus(for: book) },
                    onUpdateTags: { updateTags($0, for: book) },
                    onCopyTitle: { copyToPasteboard(book.title) },
                    onZoom: { previewCover(book) },
                    onSave: { save($0, replacing: book) },
                    onDelete: { pendingDeletion = book }
                )
                .contextMenu { bookContextMenu(for: book, includesISBN: true) }
            }
        }
    }

    @ViewBuilder
    private func bookContextMenu(for book: Book, includesISBN: Bool) -> some View {
        Button("编辑", systemImage: "pencil") { presentEdit(book) }
        if includesISBN, let isbn = book.isbn {
            Button("复制 ISBN", systemImage: "doc.on.doc") { copyToPasteboard(isbn) }
        }
        if let detailURL = book.detailURL {
            Link(destination: detailURL) { Label("打开关联页面", systemImage: "link") }
        }
        Button("删除", systemImage: "trash", role: .destructive) {
            pendingDeletion = book
        }
    }

    private func previewCover(_ book: Book) {
        guard let fileName = book.coverFileName,
              let directory = try? NativeStorageLocations.covers()
        else { return }
        coverPreview = CoverPreviewRoute(title: book.title, fileURL: directory.appending(path: fileName))
    }
#endif

#if os(iOS)
    private var iosGroupedBookSections: [BookDateSection]? {
        let locale = Locale(identifier: UserDefaults.standard.string(forKey: tkLanguagePreferenceKey) ?? tkDefaultLanguageCode)
        switch sort {
        case .recentlyAdded:
            return makeBookDateSections(books: filteredBooks, locale: locale, date: \.addedAt)
        case .completed:
            return makeBookDateSections(books: filteredBooks, locale: locale) { readingStates[$0.id]?.completedAt }
        case .title, .author:
            return nil
        }
    }

    @ViewBuilder
    private func iosSectionLabel(_ section: BookDateSection) -> some View {
        if section.isUnfinished {
            Text(tkLocalized("未读完"))
        } else {
            Text([section.yearLabel, section.monthLabel].compactMap { $0 }.joined(separator: " · "))
        }
    }

    private func iosBookRow(_ book: Book) -> some View {
        Button { presentEdit(book) } label: {
            BookRow(book: book, readingState: readingStates[book.id])
        }
        .buttonStyle(.plain)
        .contextMenu { iosBookContextMenu(book) }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                cycleReadingStatus(for: book)
            } label: {
                Label("切换阅读状态", systemImage: "book")
            }
            .tint(.blue)
        }
        .swipeActions(edge: .trailing) {
            Button("删除", systemImage: "trash", role: .destructive) {
                pendingDeletion = book
            }
        }
    }

    @ViewBuilder
    private func iosBookContextMenu(_ book: Book) -> some View {
        Button("编辑", systemImage: "pencil") { presentEdit(book) }
        Button("切换阅读状态", systemImage: "book") { cycleReadingStatus(for: book) }
        if let detailURL = book.detailURL {
            Link(destination: detailURL) { Label("打开关联页面", systemImage: "link") }
        }
        Button("删除", systemImage: "trash", role: .destructive) { pendingDeletion = book }
    }
#endif

    private var filteredBooks: [Book] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let matching = books.filter {
            let status = readingStates[$0.id]?.status ?? .unread
            let matchesStatus = readingFilter == .all || readingFilter.rawValue == status.rawValue
            return matchesStatus &&
            selectedTags.isSubset(of: Set($0.tags)) &&
            (query.isEmpty ||
            $0.title.localizedCaseInsensitiveContains(query) ||
            $0.author.localizedCaseInsensitiveContains(query) ||
            ($0.isbn?.localizedCaseInsensitiveContains(query) ?? false))
        }
        return matching.sorted(by: orderedBefore)
    }

    private var readCount: Int { filteredBooks.count { readingStates[$0.id]?.status == .read } }
    private var readingProgress: Double {
        filteredBooks.isEmpty ? 0 : Double(readCount) / Double(filteredBooks.count)
    }

    private func orderedBefore(_ lhs: Book, _ rhs: Book) -> Bool {
        let order: ComparisonResult = switch sort {
        case .recentlyAdded: lhs.addedAt == rhs.addedAt ? .orderedSame : (lhs.addedAt < rhs.addedAt ? .orderedAscending : .orderedDescending)
        case .completed:
            switch (readingStates[lhs.id]?.completedAt, readingStates[rhs.id]?.completedAt) {
            case let (left?, right?): left == right ? .orderedSame : (left < right ? .orderedAscending : .orderedDescending)
            case (nil, nil): .orderedSame
            case (nil, _): .orderedDescending
            case (_, nil): .orderedAscending
            }
        case .title: lhs.title.localizedStandardCompare(rhs.title)
        case .author: lhs.author.localizedStandardCompare(rhs.author)
        }
        if order == .orderedSame { return lhs.id < rhs.id }
        return sortDirection == .ascending ? order == .orderedAscending : order == .orderedDescending
    }

    private var allTags: [String] {
        Array(Set(books.flatMap(\.tags))).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    private func presentAdd() {
        editingBook = nil
        editorRoute = EditorRoute(value: nil)
    }

    private func presentEdit(_ book: Book) {
        editingBook = book
        editorRoute = EditorRoute(value: book)
    }

    private func reload() {
        do {
            books = try BookRepository(context: modelContext).books()
            let profiles = try ProfileRepository(context: modelContext).profiles()
            let activeID = try ProfileRepository(context: modelContext).activeProfileID() ?? profiles.first?.id
            activeProfile = profiles.first { $0.id == activeID }
            readingStates = try activeID.map { try ProfileRepository(context: modelContext).readingStates(profileID: $0) } ?? [:]
        } catch {
            errorMessage = tkLocalized("无法读取本机书库。")
        }
    }

    private func save(_ draft: BookDraft) -> String? {
        save(draft, replacing: editingBook)
    }

    private func save(_ draft: BookDraft, replacing originalBook: Book?) -> String? {
        let instant = Date.now
        let normalizedISBN: String?
        if draft.isbn.isEmpty {
            normalizedISBN = nil
        } else if let isbn = ISBN(draft.isbn) {
            normalizedISBN = isbn.isbn13
        } else {
            return tkLocalized("请输入校验位正确的 ISBN-10 或 ISBN-13。")
        }

        let book = Book(
            id: originalBook?.id ?? UUID().uuidString.lowercased(),
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            author: draft.author.trimmingCharacters(in: .whitespacesAndNewlines),
            isbn: normalizedISBN,
            publisher: draft.publisher.nilIfBlank,
            coverURL: draft.coverURL ?? originalBook?.coverURL,
            coverKey: originalBook?.coverKey,
            coverFileName: draft.coverFileName ?? originalBook?.coverFileName,
            detailURL: draft.detailURL ?? originalBook?.detailURL,
            rating: originalBook?.rating,
            tags: draft.tags,
            addedAt: originalBook?.addedAt ?? instant,
            updatedAt: instant
        )

        guard !book.title.isEmpty else { return tkLocalized("书名不能为空。") }

        do {
            let repository = BookRepository(context: modelContext)
            if originalBook == nil {
                try repository.add(book)
            } else {
                try repository.update(book)
            }
            reload()
            cacheCoverIfNeeded(for: book)
            requestTomeKeepSync()
            return nil
        } catch BookRepositoryError.duplicateISBN {
            return tkLocalized("书库中已经存在相同 ISBN 的书籍。")
        } catch {
            return tkLocalized("保存失败，请稍后重试。")
        }
    }

    private func cycleReadingStatus(for book: Book) {
        guard let profileID = activeProfile?.id else {
            errorMessage = tkLocalized("请先选择阅读档案。")
            return
        }
        let current = readingStates[book.id]?.status ?? .unread
        do {
            readingStates[book.id] = try ProfileRepository(context: modelContext)
                .setReadingStatus(nextReadingStatus(after: current), bookID: book.id, profileID: profileID)
            requestTomeKeepSync()
        } catch {
            errorMessage = tkLocalized("无法更新阅读状态。")
        }
    }

    private func updateTags(_ tags: [String], for book: Book) {
        var updated = book
        updated.tags = normalizedBookTags(tags)
        updated.updatedAt = .now
        do {
            try BookRepository(context: modelContext).update(updated)
            reload()
            requestTomeKeepSync()
        } catch {
            errorMessage = tkLocalized("无法更新标签。")
        }
    }

    private func cacheCoverIfNeeded(for book: Book) {
        guard book.coverFileName == nil, let remoteURL = book.coverURL else { return }
        Task {
            guard let fileName = try? await CoverCacheService().cache(remoteURL: remoteURL, recordID: book.id) else { return }
            var updated = book
            updated.coverFileName = fileName
            updated.updatedAt = .now
            try? BookRepository(context: modelContext).update(updated)
            reload()
            requestTomeKeepSync()
        }
    }

    private func delete(_ book: Book) {
        defer { pendingDeletion = nil }
        do {
            try BookRepository(context: modelContext).softDelete(id: book.id)
            reload()
            requestTomeKeepSync()
        } catch {
            errorMessage = tkLocalized("删除失败，请稍后重试。")
        }
    }
}

#if os(macOS)
private struct HoverHelpBubble: View {
    let label: String

    var body: some View {
        Text(verbatim: label)
            .font(.caption2)
            .foregroundStyle(.primary)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(.regularMaterial, in: .rect(cornerRadius: 5))
            .overlay {
                RoundedRectangle(cornerRadius: 5)
                    .stroke(Color.primary.opacity(0.12), lineWidth: 0.5)
            }
            .shadow(color: .black.opacity(0.14), radius: 4, y: 2)
            .fixedSize()
            .allowsHitTesting(false)
    }
}

private struct ImmediateHoverHelpModifier: ViewModifier {
    let label: String
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if isHovering {
                    HoverHelpBubble(label: label)
                        .offset(y: -29)
                }
            }
            .zIndex(isHovering ? 100 : 0)
            .onHover { isHovering = $0 }
            .help(label)
    }
}

private struct CardActionModifier: ViewModifier {
    let label: String
    var baseColor: Color = .secondary
    var hoverColor: Color = .accentColor
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .frame(width: 22, height: 22)
            .contentShape(.rect)
            .foregroundStyle(isHovering ? hoverColor : baseColor)
            .background(isHovering ? hoverColor.opacity(0.13) : Color.clear, in: .rect(cornerRadius: 5))
            .overlay(alignment: .top) {
                if isHovering {
                    HoverHelpBubble(label: label)
                        .offset(y: -29)
                }
            }
            .zIndex(isHovering ? 100 : 0)
            .onHover { isHovering = $0 }
            .help(label)
    }
}

private extension View {
    func immediateHoverHelp(_ label: String) -> some View {
        modifier(ImmediateHoverHelpModifier(label: label))
    }

    func cardAction(
        _ label: String,
        baseColor: Color = .secondary,
        hoverColor: Color = .accentColor
    ) -> some View {
        modifier(CardActionModifier(label: label, baseColor: baseColor, hoverColor: hoverColor))
    }
}

private struct CompactTagFlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let maximumWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maximumWidth {
                totalWidth = max(totalWidth, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += (rowWidth == 0 ? 0 : spacing) + size.width
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maximumWidth, max(totalWidth, rowWidth)), height: totalHeight + rowHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var point = bounds.origin
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if point.x > bounds.minX, point.x + size.width > bounds.maxX {
                point.x = bounds.minX
                point.y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: point, proposal: ProposedViewSize(size))
            point.x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

private struct OutsideClickMonitor: NSViewRepresentable {
    let action: () -> Void

    func makeNSView(context: Context) -> OutsideClickTrackingView {
        let view = OutsideClickTrackingView()
        view.action = action
        return view
    }

    func updateNSView(_ nsView: OutsideClickTrackingView, context: Context) {
        nsView.action = action
    }
}

@MainActor
private final class OutsideClickTrackingView: NSView {
    var action: (() -> Void)?
    private var eventMonitor: Any?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        removeEventMonitor()
        guard window != nil else { return }
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            guard let self, event.window === window else { return event }
            let localPoint = convert(event.locationInWindow, from: nil)
            if !bounds.contains(localPoint) {
                DispatchQueue.main.async { [weak self] in self?.action?() }
            }
            return event
        }
    }

    deinit {
        MainActor.assumeIsolated {
            if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
        }
    }

    private func removeEventMonitor() {
        guard let eventMonitor else { return }
        NSEvent.removeMonitor(eventMonitor)
        self.eventMonitor = nil
    }
}

private struct InlineBookTagEditor: View {
    let tags: [String]
    let onChange: ([String]) -> Void
    @State private var isAdding = false
    @State private var input = ""
    @FocusState private var inputIsFocused: Bool

    var body: some View {
        CompactTagFlowLayout(spacing: 4) {
            ForEach(tags, id: \.self) { tag in
                let color = TagPalette.color(for: tag)
                HStack(spacing: 2) {
                    Text(tag)
                        .lineLimit(1)
                    TagRemoveButton(tag: tag, color: color) {
                        onChange(tags.filter { $0 != tag })
                    }
                }
                .font(.caption2.weight(.medium))
                .foregroundStyle(color)
                .padding(.leading, 6)
                .padding(.trailing, 3)
                .frame(height: 18)
                .background(color.opacity(0.12), in: .capsule)
                .overlay { Capsule().stroke(color.opacity(0.24), lineWidth: 0.5) }
            }

            if isAdding {
                TextField("标签", text: $input)
                    .textFieldStyle(.plain)
                    .font(.caption2)
                    .padding(.horizontal, 7)
                    .frame(width: 82, height: 18)
                    .background(Color(nsColor: .textBackgroundColor), in: .capsule)
                    .overlay { Capsule().stroke(Color.accentColor.opacity(0.7), lineWidth: 1) }
                    .background {
                        OutsideClickMonitor {
                            guard inputIsFocused else { return }
                            inputIsFocused = false
                        }
                    }
                    .focused($inputIsFocused)
                    .onSubmit(commitInput)
                    .onExitCommand(perform: cancelInput)
                    .accessibilityLabel(tkLocalized("新增标签"))
            } else {
                TagAddButton {
                    isAdding = true
                    Task {
                        await Task.yield()
                        inputIsFocused = true
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: inputIsFocused) { wasFocused, isFocused in
            if wasFocused, !isFocused { commitInput() }
        }
    }

    private func commitInput() {
        guard isAdding else { return }
        let updated = normalizedBookTags(tags + [input])
        input = ""
        isAdding = false
        if updated != tags { onChange(updated) }
    }

    private func cancelInput() {
        inputIsFocused = false
        input = ""
        isAdding = false
    }
}

private struct TagRemoveButton: View {
    let tag: String
    let color: Color
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 7, weight: .bold))
                .frame(width: 12, height: 12)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovering ? Color.red : color.opacity(0.68))
        .background(isHovering ? Color.red.opacity(0.12) : Color.clear, in: .circle)
        .onHover { isHovering = $0 }
        .help(tkLocalizedFormat("删除标签 %@", tag))
        .accessibilityLabel(tkLocalizedFormat("删除标签 %@", tag))
    }
}

private struct TagAddButton: View {
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 8, weight: .bold))
                .frame(width: 18, height: 18)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovering ? Color.accentColor : Color.secondary.opacity(0.65))
        .background(isHovering ? Color.accentColor.opacity(0.12) : Color.clear, in: .circle)
        .overlay { Circle().strokeBorder(isHovering ? Color.accentColor.opacity(0.7) : Color.secondary.opacity(0.28), style: StrokeStyle(lineWidth: 1, dash: [2])) }
        .onHover { isHovering = $0 }
        .immediateHoverHelp(tkLocalized("新增标签"))
        .accessibilityLabel(tkLocalized("新增标签"))
    }
}

private struct DetailedBookCard: View {
    let book: Book
    let readingState: ReadingState?
    let onCycleStatus: () -> Void
    let onUpdateTags: ([String]) -> Void
    let onCopyTitle: () -> Void
    let onZoom: () -> Void
    let onSave: (BookDraft) -> String?
    let onDelete: () -> Void
    @State private var isHovering = false
    @State private var isEditing = false
    @State private var draft = BookDraft(book: nil)
    @State private var validationMessage: String?
    @State private var didCopyTitle = false
    @State private var isTitleHovering = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                TomeKeepBookCover(fileURL: localCoverURL)
                    .frame(width: 78, height: 112)
                    .overlay(alignment: .topTrailing) {
                        if localCoverURL != nil {
                            CoverZoomButton(action: onZoom)
                                .padding(5)
                                .opacity(isHovering ? 1 : 0)
                        }
                    }

                if isEditing {
                    inlineEditor
                } else {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .top, spacing: 6) {
                            bookTitle
                            statusButton
                        }
                        if !book.author.isEmpty {
                            Text(book.author)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if let publisher = book.publisher {
                            Text(publisher)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        } else if let isbn = book.isbn, let inferred = ISBN(isbn)?.inferredPublisher {
                            Text(inferred)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .italic()
                                .lineLimit(1)
                        }
                        InlineBookTagEditor(tags: book.tags, onChange: onUpdateTags)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                }
            }
            .frame(height: 112)

            Divider()

            if isEditing {
                HStack(spacing: 8) {
                    if let validationMessage {
                        Label(validationMessage, systemImage: "exclamationmark.circle")
                            .font(.caption2)
                            .foregroundStyle(.red)
                            .lineLimit(1)
                            .accessibilityIdentifier("library.book.inline.validation.\(book.id)")
                    }
                    Spacer(minLength: 8)
                    Button("取消") { cancelEditing() }
                        .controlSize(.small)
                    Button("保存") { saveInline() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("library.book.inline.save.\(book.id)")
                }
                .padding(.horizontal, 10)
                .frame(height: 36)
            } else {
                HStack(spacing: 4) {
                    isbnBadge
                    if let completedAt = readingState?.completedAt {
                        Text(completedAt, format: .dateTime.year().month().day())
                            .font(.caption2)
                            .foregroundStyle(.green)
                            .lineLimit(1)
                            .help(tkLocalized("完成日期"))
                    }
                    Spacer(minLength: 6)
                    Button {
                        onCopyTitle()
                        didCopyTitle = true
                    } label: {
                        Image(systemName: didCopyTitle ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(.plain)
                    .cardAction(
                        tkLocalized(didCopyTitle ? "已复制书名" : "复制书名"),
                        baseColor: didCopyTitle ? .green : .secondary,
                        hoverColor: didCopyTitle ? .green : .accentColor
                    )
                    .accessibilityLabel(tkLocalized(didCopyTitle ? "已复制书名" : "复制书名"))
                    .accessibilityIdentifier("library.book.copy.\(book.id)")
                    .task(id: didCopyTitle) {
                        guard didCopyTitle else { return }
                        try? await Task.sleep(for: .seconds(1.2))
                        didCopyTitle = false
                    }
                    Button("编辑", systemImage: "pencil") { beginEditing() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .cardAction(tkLocalized("编辑"))
                        .accessibilityIdentifier("library.book.edit.\(book.id)")
                    Button("删除", systemImage: "trash") { onDelete() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .cardAction(tkLocalized("删除"), hoverColor: .red)
                        .accessibilityIdentifier("library.book.delete.\(book.id)")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .frame(height: 30)
            }
        }
        .background(Color(nsColor: .controlBackgroundColor), in: .rect(cornerRadius: 11))
        .overlay {
            RoundedRectangle(cornerRadius: 11)
                .stroke(isHovering ? Color.accentColor.opacity(0.55) : Color.primary.opacity(0.10), lineWidth: 1)
        }
        .onHover { isHovering = $0 }
        .zIndex(isHovering ? 10 : 0)
        .accessibilityIdentifier("library.book.detail.\(book.id)")
    }

    private var inlineEditor: some View {
        VStack(spacing: 3) {
            TextField("书名", text: $draft.title)
                .accessibilityIdentifier("library.book.inline.title.\(book.id)")
            TextField("作者", text: $draft.author)
            TextField("出版社", text: $draft.publisher)
            TextField("ISBN-10 或 ISBN-13", text: $draft.isbn)
        }
        .textFieldStyle(.roundedBorder)
        .controlSize(.small)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
    }

    @ViewBuilder
    private var bookTitle: some View {
        if let detailURL = book.detailURL {
            Link(destination: detailURL) {
                Text(book.title)
                    .font(.headline)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(isTitleHovering ? Color.accentColor : Color.primary)
            .underline(isTitleHovering)
            .onHover { isTitleHovering = $0 }
            .help(tkLocalized("打开关联页面"))
            .accessibilityLabel(book.title)
            .accessibilityHint(tkLocalized("打开关联页面"))
        } else {
            Text(book.title)
                .font(.headline)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var statusButton: some View {
        let status = readingState?.status ?? .unread
        let next = nextReadingStatus(after: status)
        return Button(action: onCycleStatus) {
            ReadingStatusBadge(status: status, compact: true)
                .frame(width: 24, height: 24)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .immediateHoverHelp("\(status.label) · \(tkLocalized("点击切换为")) \(next.label)")
        .accessibilityLabel("\(tkLocalized("阅读状态"))：\(status.label)")
        .accessibilityHint("\(tkLocalized("点击切换为")) \(next.label)")
        .accessibilityIdentifier("library.book.status.\(book.id)")
    }

    @ViewBuilder
    private var isbnBadge: some View {
        if let value = book.isbn, let parsed = ISBN(value) {
            Button { copyToPasteboard(parsed.isbn13) } label: {
                if let semantics = parsed.semantics {
                    Label("\(tkLocalized(semantics.language)) · \(tkLocalized(semantics.region))", systemImage: "barcode")
                        .lineLimit(1)
                } else {
                    Label(parsed.isbn13, systemImage: "barcode")
                        .lineLimit(1)
                }
            }
            .buttonStyle(.plain)
            .help(tkLocalizedFormat("复制 ISBN %@", parsed.isbn13))
        } else if let value = book.isbn {
            Label(value, systemImage: "barcode")
                .lineLimit(1)
        } else {
            Text(tkLocalized("无 ISBN"))
        }
    }

    private func beginEditing() {
        draft = BookDraft(book: book)
        validationMessage = nil
        isEditing = true
    }

    private func cancelEditing() {
        validationMessage = nil
        isEditing = false
    }

    private func saveInline() {
        validationMessage = onSave(draft)
        if validationMessage == nil { isEditing = false }
    }

    private var localCoverURL: URL? {
        guard let fileName = book.coverFileName,
              let directory = try? NativeStorageLocations.covers()
        else { return nil }
        return directory.appending(path: fileName)
    }
}

private struct BookCard: View {
    let book: Book
    let readingState: ReadingState?
    let isExpanded: Bool
    let action: () -> Void
    let zoom: () -> Void
    @State private var isHovering = false

    var body: some View {
        VStack(spacing: 6) {
            TomeKeepBookCover(fileURL: localCoverURL)
                .frame(maxWidth: .infinity)
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .overlay {
                    RoundedRectangle(cornerRadius: TomeKeepTheme.coverCornerRadius)
                        .stroke(
                            isExpanded ? Color.accentColor : (isHovering ? Color.accentColor.opacity(0.8) : .primary.opacity(0.08)),
                            lineWidth: isExpanded || isHovering ? 2 : 1
                        )
                }
                .overlay(alignment: .topTrailing) {
                    if localCoverURL != nil {
                        CoverZoomButton(action: zoom)
                        .padding(5)
                        .opacity(isHovering ? 1 : 0)
                    }
                }
                .contentShape(.rect)
                .onTapGesture(perform: action)
            compactBookTitle
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .clipped()
        .onHover { isHovering = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library.book.card.\(book.id)")
        .accessibilityLabel("\(book.title), \(book.author), \(tkLocalized((readingState?.status ?? .unread).label))")
        .accessibilityHint(tkLocalized(isExpanded ? "收起详细卡片" : "展开详细卡片"))
    }

    @ViewBuilder
    private var compactBookTitle: some View {
        if let titleURL {
            Link(destination: titleURL) {
                compactBookTitleText
            }
            .buttonStyle(.plain)
            .help(tkLocalized("打开关联页面"))
        } else {
            Button(action: action) { compactBookTitleText }
                .buttonStyle(.plain)
        }
    }

    private var compactBookTitleText: some View {
        Text(book.title)
            .font(.caption)
            .foregroundStyle(.primary)
            .multilineTextAlignment(.center)
            .lineLimit(2, reservesSpace: true)
            .frame(maxWidth: .infinity, alignment: .top)
    }

    private var titleURL: URL? {
        if let detailURL = book.detailURL { return detailURL }
        guard let isbn = book.isbn else { return nil }
        return URL(string: "https://isbnsearch.org/isbn/\(isbn)")
    }

    private var localCoverURL: URL? {
        guard let fileName = book.coverFileName,
              let directory = try? NativeStorageLocations.covers()
        else { return nil }
        return directory.appending(path: fileName)
    }
}

private struct CompactBookPlaceholder: View {
    var body: some View {
        VStack(spacing: 6) {
            Color.clear
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
            Text(" ")
                .font(.caption)
                .lineLimit(2, reservesSpace: true)
        }
        .hidden()
        .accessibilityHidden(true)
    }
}

private struct CoverZoomButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(.black.opacity(0.56), in: .rect(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help(tkLocalized("查看大图"))
        .accessibilityLabel(tkLocalized("查看大图"))
    }
}
#endif

private struct BookRow: View {
    let book: Book
    let readingState: ReadingState?

    var body: some View {
        HStack(spacing: TomeKeepTheme.contentSpacing) {
            TomeKeepBookCover(fileURL: localCoverURL)
                .frame(width: 52, height: 78)
                .overlay(alignment: .bottomTrailing) {
                    ReadingStatusBadge(status: readingState?.status ?? .unread, compact: true)
                        .offset(x: 5, y: 5)
                }

            VStack(alignment: .leading, spacing: 5) {
                Text(book.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                if !book.author.isEmpty {
                    Text(book.author)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 8) {
                    if let isbn = book.isbn {
                        Button {
                            copyToPasteboard(isbn)
                        } label: {
                            if let semantics = ISBN(isbn)?.semantics {
                                Label("\(tkLocalized(semantics.language)) · \(tkLocalized(semantics.region))", systemImage: "barcode")
                            } else {
                                Label(isbn, systemImage: "barcode")
                            }
                        }
                        .buttonStyle(.plain)
                        .help("复制 ISBN \(isbn)")
                    }
                    if let publisher = book.publisher {
                        Text(publisher)
                    } else if let isbn = book.isbn, let inferred = ISBN(isbn)?.inferredPublisher {
                        Text(inferred).italic()
                    }
                }
                .font(.caption)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                if !book.tags.isEmpty {
                    TagBadgeRow(tags: book.tags)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 6)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("打开编辑表单")
    }

    private var localCoverURL: URL? {
        guard let fileName = book.coverFileName,
              let directory = try? NativeStorageLocations.covers()
        else { return nil }
        return directory.appending(path: fileName)
    }
}

#if os(iOS)
private struct IOSCompactBookCard: View {
    let book: Book
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                TomeKeepBookCover(fileURL: localCoverURL)
                    .aspectRatio(2.0 / 3.0, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 7))
                    .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                Text(book.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if !book.author.isEmpty {
                    Text(book.author)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(tkLocalized("打开编辑表单"))
    }

    private var localCoverURL: URL? {
        guard let fileName = book.coverFileName,
              let directory = try? NativeStorageLocations.covers()
        else { return nil }
        return directory.appending(path: fileName)
    }
}
#endif

private struct ReadingStatusBadge: View {
    let status: ReadingStatus
    var compact = false

    var body: some View {
        Image(systemName: status.symbol)
            .font(.system(size: compact ? 8 : 10, weight: .semibold))
            .foregroundStyle(status.tint)
            .frame(width: compact ? 16 : 20, height: compact ? 16 : 20)
            .background(status.tint.opacity(0.16), in: .circle)
            .overlay {
                Circle()
                    .stroke(status.tint.opacity(0.28), lineWidth: 0.5)
            }
            .accessibilityLabel(tkLocalized(status.label))
    }
}

private struct WishlistView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var items: [WishlistItem] = []
    @State private var searchText = ""
    @State private var editingItem: WishlistItem?
    @State private var editorRoute: EditorRoute<WishlistItem>?
    @State private var errorMessage: String?
    @AppStorage("native.wishlist.sort") private var sort: WishlistSort = .recentlyAdded
    @AppStorage("native.wishlist.sortDirection") private var sortDirection: SortDirection = .descending
    @AppStorage("native.wishlist.displayMode") private var displayMode: LibraryDisplayMode = .details
    @AppStorage("native.wishlist.compactColumns") private var compactColumns = 8
    @State private var selectedTags: Set<String> = []
    @State private var purchaseFilter: WishlistPurchaseFilter = .all
    @AppStorage("native.wishlist.selectedTags") private var storedSelectedTags = ""
    @State private var recentlyDeletedItem: WishlistItem?
#if os(iOS)
    @State private var isSearchPresented = false
#endif
#if os(macOS)
    @State private var expandedCompactItemID: String?
    @State private var priceEntries: [String: PriceCacheEntry] = [:]
    @State private var pricingItem: WishlistItem?
    @State private var coverPreview: CoverPreviewRoute?
    @State private var isShowingPriceHistory = false
    @State private var pricingMessage: String?
    @State private var verificationQueue: [PricingVerificationRequest] = []
    @State private var activeVerification: PricingVerificationRequest?
    @State private var lastVerification: PricingVerificationRequest?
#endif

    var body: some View {
#if os(macOS)
        let navigationBase = wishlistContent
            .navigationTitle(Text(verbatim: tkLocalized("愿望单")))
            .toolbar {
                ToolbarItem {
                    Button("价格记录", systemImage: "tag") { isShowingPriceHistory = true }
                        .labelStyle(.iconOnly)
                        .help("价格记录")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("添加愿望", systemImage: "plus") { presentAdd() }
                        .help(tkLocalized("添加愿望"))
                }
            }
#else
        let navigationBase = wishlistContent
            .navigationTitle(Text(verbatim: tkLocalized("愿望单")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(isSearchPresented ? "关闭搜索" : "搜索", systemImage: isSearchPresented ? "xmark" : "magnifyingglass") {
                        toggleSearch()
                    }
                    .accessibilityIdentifier("wishlist.search.toggle")
                }
                ToolbarItem(placement: .principal) {
                    Text(verbatim: tkLocalized("愿望单"))
                        .font(.title3.weight(.semibold))
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }
                ToolbarItem { wishlistSortMenu }
                ToolbarItem {
                    Button {
                        displayMode = displayMode == .covers ? .details : .covers
                    } label: {
                        Label(
                            displayMode == .covers ? "切换到详细视图" : "切换到封面视图",
                            systemImage: displayMode == .covers ? "rectangle.grid.1x2" : "square.grid.2x2"
                        )
                    }
                    .accessibilityIdentifier("wishlist.display.toggle")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("添加愿望", systemImage: "plus") { presentAdd() }
                }
            }
#endif
        let navigation = navigationBase.safeAreaInset(edge: .bottom) {
            if !items.isEmpty {
                Text("共 \(items.count) 项 · \(items.filter(\.pendingBuy).count) 项待购买")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(.bar)
                    .accessibilityIdentifier("wishlist.summary")
                }
        }

        let editor = navigation.sheet(item: $editorRoute) { route in
            WishlistEditorView(item: route.value, onSave: save)
#if os(iOS)
                .presentationDetents([.medium, .large])
#else
                .frame(minWidth: 480)
#endif
        }
#if os(macOS)
        let pricingSheets = editor.sheet(item: $pricingItem, onDismiss: reloadPriceEntries) { item in
            ManualPriceCaptureView(item: item)
        }
        .sheet(isPresented: $isShowingPriceHistory) {
            NavigationStack { PriceHistoryView() }
                .frame(minWidth: 760, minHeight: 560)
        }
        .sheet(item: $activeVerification, onDismiss: verificationDidDismiss) { request in
            WebsiteVerificationView(url: request.url)
        }
        let platformSheets = pricingSheets.overlay {
            if let coverPreview {
                CoverPreviewOverlay(preview: coverPreview) {
                    self.coverPreview = nil
                }
                .zIndex(1_000)
            }
        }
#else
        let platformSheets = editor
#endif

        let lifecycle = platformSheets.alert("无法完成操作", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("好", role: .cancel) {} } message: {
            Text(errorMessage ?? tkLocalized("未知错误"))
        }
        .task {
            selectedTags = decodeStoredTags(storedSelectedTags)
            reload()
        }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in
            reload()
        }
        .onChange(of: selectedTags) { _, value in
            storedSelectedTags = encodeStoredTags(value)
        }
        .onChange(of: sort) { _, value in
            sortDirection = value == .recentlyAdded || value == .pendingBuy ? .descending : .ascending
        }
        .task(id: recentlyDeletedItem?.id) {
            guard let id = recentlyDeletedItem?.id else { return }
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, recentlyDeletedItem?.id == id else { return }
            recentlyDeletedItem = nil
        }
#if os(macOS)
        return lifecycle.safeAreaInset(edge: .top) {
            if let recentlyDeletedItem {
                HStack(spacing: 8) {
                    Image(systemName: "trash")
                    Text(tkLocalizedFormat("已删除《%@》", recentlyDeletedItem.title))
                    Spacer()
                    Button(tkLocalized("撤销")) { restore(recentlyDeletedItem) }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }
                .font(.caption)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.regularMaterial)
            } else if let pricingMessage {
                HStack(spacing: 8) {
                    Image(systemName: "tag.fill")
                    Text(pricingMessage)
                    Spacer()
                    Button("关闭") { self.pricingMessage = nil }
                        .buttonStyle(.plain)
                }
                .font(.caption)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.regularMaterial)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.openPriceHistory)) { _ in
            isShowingPriceHistory = true
        }
#else
        return lifecycle.safeAreaInset(edge: .top) {
            if let recentlyDeletedItem {
                HStack(spacing: 8) {
                    Image(systemName: "trash")
                    Text(tkLocalizedFormat("已删除《%@》", recentlyDeletedItem.title))
                        .lineLimit(1)
                    Spacer()
                    Button(tkLocalized("撤销")) { restore(recentlyDeletedItem) }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }
                .font(.caption)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.regularMaterial)
            }
        }
#endif
    }

    @ViewBuilder
    private var wishlistContent: some View {
        VStack(spacing: 0) {
#if os(macOS)
            wishlistControlBar
                .zIndex(10)
#else
            if isSearchPresented {
                IOSInlineSearchField(text: $searchText, prompt: tkLocalized("书名、作者或 ISBN"))
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
#endif
            if !allTags.isEmpty || !items.isEmpty {
                TagFilterBar(
                    tags: allTags,
                    selection: $selectedTags,
                    compactColumns: displayMode == .covers ? $compactColumns : nil,
                    includesUntagged: true
                )
            }
            Group {
            if items.isEmpty {
                ContentUnavailableView {
                    Label("愿望单为空", systemImage: "heart")
                } description: {
                    Text("把准备购买或想读的书放在这里。")
                } actions: {
                    Button("添加愿望", systemImage: "plus") { presentAdd() }
                        .buttonStyle(.borderedProminent)
                }
            } else if filteredItems.isEmpty {
                filteredWishlistEmptyState
            } else {
#if os(macOS)
                if displayMode == .covers {
                    ScrollView {
                        compactWishlistGrid(filteredItems)
                        .padding(16)
                    }
                    .background(Color(nsColor: .windowBackgroundColor))
                } else {
                    ScrollView {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 260, maximum: 360), spacing: 12)],
                            alignment: .leading,
                            spacing: 12
                        ) {
                            ForEach(filteredItems) { item in detailedWishlistCard(item) }
                        }
                        .padding(16)
                    }
                    .background(Color(nsColor: .windowBackgroundColor))
                }
#else
                if displayMode == .covers {
                    ScrollView {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 96, maximum: 132), spacing: 14)],
                            alignment: .leading,
                            spacing: 18
                        ) {
                            ForEach(filteredItems) { item in
                                IOSCompactWishlistCard(item: item, coverURL: localCoverURL(item.coverFileName)) {
                                    presentEdit(item)
                                }
                                .contextMenu { wishlistContextMenu(for: item) }
                            }
                        }
                        .padding(16)
                    }
                    .refreshable { reload() }
                } else {
                    wishlistList
                }
#endif
            }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder
    private var filteredWishlistEmptyState: some View {
        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView.search(text: searchText)
        } else {
            ContentUnavailableView(
                tkLocalized("没有符合筛选条件的愿望"),
                systemImage: "line.3.horizontal.decrease.circle",
                description: Text(verbatim: tkLocalized("可取消标签筛选。"))
            )
        }
    }

    private var wishlistSortMenu: some View {
        Menu {
                    Picker(tkLocalized("购买状态"), selection: $purchaseFilter) {
                        ForEach(WishlistPurchaseFilter.allCases, id: \.self) { option in
                            Label(option.label, systemImage: option.symbol).tag(option)
                        }
                    }
                    Divider()
                    Picker("排序", selection: $sort) {
                        ForEach(WishlistSort.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    Picker("方向", selection: $sortDirection) {
                        ForEach(SortDirection.allCases, id: \.self) { direction in
                            Label(direction.label, systemImage: direction.symbol).tag(direction)
                        }
                    }
        } label: {
            Label(
                selectedTags.isEmpty ? sort.label : tkLocalizedFormat("%@ · %lld 个标签", sort.label, selectedTags.count),
                systemImage: "line.3.horizontal.decrease.circle"
            )
        }
    }

#if os(iOS)
    private func toggleSearch() {
        if isSearchPresented { searchText = "" }
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.22)) {
            isSearchPresented.toggle()
        }
    }
#endif

    private var wishlistSortControls: some View {
        HStack(spacing: 1) {
            ForEach(WishlistSort.allCases, id: \.self) { option in
                ToolbarChoiceButton(
                    symbol: option.symbol,
                    label: option.label,
                    selected: sort == option,
                    badge: sort == option ? (sortDirection == .ascending ? "↑" : "↓") : nil
                ) {
                    if sort == option { sortDirection = sortDirection == .ascending ? .descending : .ascending }
                    else { sort = option }
                }
            }
        }
        .padding(2)
        .background(.quaternary, in: .rect(cornerRadius: 8))
    }

#if os(macOS)
    private var wishlistControlBar: some View {
        HStack(spacing: 12) {
            SearchField(text: $searchText, prompt: tkLocalized("书名、作者或 ISBN"))
                .frame(width: 230)

            ControlGroupBox {
                ForEach(WishlistPurchaseFilter.allCases, id: \.self) { option in
                    ToolbarChoiceButton(symbol: option.symbol, label: option.label, selected: purchaseFilter == option) {
                        purchaseFilter = option
                    }
                }
            }

            Spacer(minLength: 18)

            ControlGroupBox {
                ForEach(WishlistSort.allCases, id: \.self) { option in
                    ToolbarChoiceButton(
                        symbol: option.symbol,
                        label: option.label,
                        selected: sort == option,
                        badge: sort == option ? (sortDirection == .ascending ? "↑" : "↓") : nil
                    ) {
                        if sort == option { sortDirection = sortDirection == .ascending ? .descending : .ascending }
                        else { sort = option }
                    }
                }
            }

            ControlGroupBox {
                ForEach(LibraryDisplayMode.allCases, id: \.self) { mode in
                    ToolbarChoiceButton(symbol: mode.symbol, label: mode.label, selected: displayMode == mode) {
                        if mode != .covers { expandedCompactItemID = nil }
                        displayMode = mode
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
    }

    @ViewBuilder
    private var wishlistDisplayControls: some View {
                Picker("显示方式", selection: $displayMode) {
                    ForEach(LibraryDisplayMode.allCases, id: \.self) { mode in
                        Label(mode.label, systemImage: mode.symbol).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                if displayMode == .covers {
                    Slider(value: Binding(
                        get: { Double(compactColumns) },
                        set: { compactColumns = Int($0.rounded()) }
                    ), in: 8...20, step: 1)
                    .frame(width: 90)
                    .help("每行 \(compactColumns) 本")
                    .accessibilityLabel("每行封面数量")
                    .accessibilityValue("\(compactColumns)")
                }
    }
#endif

    private var wishlistList: some View {
        List(filteredItems) { item in
                    HStack(spacing: 14) {
                        TomeKeepBookCover(fileURL: localCoverURL(item.coverFileName))
                            .frame(width: 44, height: 66)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title).font(.headline)
                            Text(item.author.isEmpty ? tkLocalized("未知作者") : item.author)
                                .foregroundStyle(.secondary)
                            HStack(spacing: 8) {
                                Label(tkLocalized(item.priority.label), systemImage: item.priority.symbol)
                                if item.pendingBuy { Label("待购买", systemImage: "cart") }
                            }
                            .font(.caption)
                            .foregroundStyle(item.priority.tint)
                            if !item.tags.isEmpty {
                                TagBadgeRow(tags: item.tags)
                            }
                        }
                        Spacer()
#if os(macOS)
                        Button("比价", systemImage: "tag") { pricingItem = item }
                            .buttonStyle(.bordered)
#endif
#if os(macOS)
                        Button("移入书库", systemImage: "books.vertical") { moveToLibrary(item) }
                            .buttonStyle(.bordered)
#endif
                    }
                    .padding(.vertical, 5)
                    .contentShape(.rect)
                    .onTapGesture { presentEdit(item) }
                    .contextMenu {
                        wishlistContextMenu(for: item)
                    }
#if os(iOS)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            togglePendingBuy(item)
                        } label: {
                            Label(item.pendingBuy ? "取消待购买" : "标为待购买", systemImage: "cart")
                        }
                        .tint(item.pendingBuy ? .gray : .orange)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("移入书库", systemImage: "books.vertical") { moveToLibrary(item) }
                            .tint(.blue)
                        Button("删除", systemImage: "trash", role: .destructive) { delete(item) }
                    }
#endif
                }
                .listStyle(.inset)
                .refreshable { reload() }
    }

    @ViewBuilder
    private func wishlistContextMenu(for item: WishlistItem) -> some View {
        Button("编辑", systemImage: "pencil") { presentEdit(item) }
        if let detailURL = item.detailURL {
            Link(destination: detailURL) { Label("打开关联页面", systemImage: "link") }
        }
        Button("移入书库", systemImage: "books.vertical") { moveToLibrary(item) }
#if os(macOS)
        Button("打开比价", systemImage: "tag") { pricingItem = item }
#endif
        Divider()
        Button("删除", systemImage: "trash", role: .destructive) { delete(item) }
    }

#if os(macOS)
    private func detailedWishlistCard(_ item: WishlistItem) -> some View {
        DetailedWishlistCard(
            item: item,
            coverURL: localCoverURL(item.coverFileName),
            priceEntry: priceEntries[priceKey(for: item)],
            onTogglePending: { togglePendingBuy(item) },
            onUpdateTags: { updateTags($0, for: item) },
            onMoveToLibrary: { moveToLibrary(item) },
            onOpenPricing: { pricingItem = item },
            onZoom: { previewCover(item) },
            onSave: { save($0, replacing: item) },
            onDelete: { delete(item) }
        )
        .contextMenu { wishlistContextMenu(for: item) }
    }

    private func compactWishlistGrid(_ values: [WishlistItem]) -> some View {
        let rows = stride(from: 0, to: values.count, by: compactColumns).map { start in
            Array(values[start..<min(start + compactColumns, values.count)])
        }
        return LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(row) { item in
                            WishlistCard(
                                item: item,
                                coverURL: localCoverURL(item.coverFileName),
                                isExpanded: expandedCompactItemID == item.id,
                                action: { toggleCompactItem(item) },
                                zoom: { previewCover(item) }
                            )
                            .frame(maxWidth: .infinity)
                            .contextMenu { wishlistContextMenu(for: item) }
                        }
                        ForEach(row.count..<compactColumns, id: \.self) { _ in
                            CompactBookPlaceholder().frame(maxWidth: .infinity)
                        }
                    }
                    if let item = row.first(where: { $0.id == expandedCompactItemID }),
                       let columnIndex = row.firstIndex(where: { $0.id == item.id }) {
                        compactExpandedPanel(item, columnIndex: columnIndex)
                    }
                }
            }
        }
    }

    private func toggleCompactItem(_ item: WishlistItem) {
        withAnimation(compactPanelAnimation) {
            expandedCompactItemID = expandedCompactItemID == item.id ? nil : item.id
        }
    }

    private func dismissCompactItemIfCurrent(_ itemID: String) {
        guard expandedCompactItemID == itemID else { return }
        withAnimation(compactPanelAnimation) { expandedCompactItemID = nil }
    }

    private var compactPanelAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.2) : .timingCurve(0.23, 1, 0.32, 1, duration: 0.2)
    }

    private var compactPanelTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.97, anchor: .topLeading).combined(with: .opacity)
    }

    private func compactExpandedPanel(_ item: WishlistItem, columnIndex: Int) -> some View {
        GeometryReader { proxy in
            let gap: CGFloat = 10
            let gridWidth = proxy.size.width
            let cellWidth = max(0, (gridWidth - gap * CGFloat(compactColumns - 1)) / CGFloat(compactColumns))
            let panelWidth = min(gridWidth, min(360, max(min(280, gridWidth), gridWidth * 0.34)))
            let desiredOffset = CGFloat(columnIndex) * (cellWidth + gap)
            let panelOffset = min(desiredOffset, max(0, gridWidth - panelWidth))

            detailedWishlistCard(item)
                .frame(width: panelWidth)
                .offset(x: panelOffset)
                .background {
                    OutsideClickMonitor { dismissCompactItemIfCurrent(item.id) }
                }
                .transition(compactPanelTransition)
                .id(item.id)
        }
        .frame(height: 150)
    }
#endif

    private var filteredItems: [WishlistItem] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let filtered = items.filter { item in
            let matchesQuery = query.isEmpty ||
                item.title.localizedCaseInsensitiveContains(query) ||
                item.author.localizedCaseInsensitiveContains(query) ||
                (item.isbn?.localizedCaseInsensitiveContains(query) ?? false)
            let matchesTags: Bool
            if selectedTags.contains(untaggedFilterToken) {
                matchesTags = item.tags.isEmpty
            } else {
                matchesTags = selectedTags.isEmpty || selectedTags.allSatisfy(item.tags.contains)
            }
            let matchesPurchase = purchaseFilter == .all || item.pendingBuy
            return matchesQuery && matchesTags && matchesPurchase
        }
        return filtered.sorted { lhs, rhs in
            let order = wishlistComparison(lhs, rhs)
            if order == .orderedSame { return lhs.id < rhs.id }
            return sortDirection == .ascending ? order == .orderedAscending : order == .orderedDescending
        }
    }

    private func wishlistComparison(_ lhs: WishlistItem, _ rhs: WishlistItem) -> ComparisonResult {
        switch sort {
        case .recentlyAdded:
            return lhs.addedAt == rhs.addedAt ? .orderedSame : (lhs.addedAt < rhs.addedAt ? .orderedAscending : .orderedDescending)
        case .priority:
            let rank: [WishlistPriority: Int] = [.high: 0, .medium: 1, .low: 2]
            guard rank[lhs.priority] != rank[rhs.priority] else {
                return lhs.title.localizedStandardCompare(rhs.title)
            }
            return (rank[lhs.priority] ?? 1) < (rank[rhs.priority] ?? 1) ? .orderedAscending : .orderedDescending
        case .title:
            return lhs.title.localizedStandardCompare(rhs.title)
        case .author:
            return lhs.author.localizedStandardCompare(rhs.author)
        case .pendingBuy:
            guard lhs.pendingBuy != rhs.pendingBuy else {
                return lhs.addedAt == rhs.addedAt ? .orderedSame : (lhs.addedAt < rhs.addedAt ? .orderedAscending : .orderedDescending)
            }
            return lhs.pendingBuy ? .orderedAscending : .orderedDescending
        }
    }

    private var allTags: [String] { Array(Set(items.flatMap(\.tags))).sorted() }

    private func presentAdd() { editingItem = nil; editorRoute = EditorRoute(value: nil) }
    private func presentEdit(_ item: WishlistItem) { editingItem = item; editorRoute = EditorRoute(value: item) }

    private func reload() {
        do {
            items = try WishlistRepository(context: modelContext).items()
#if os(macOS)
            reloadPriceEntries()
#endif
        }
        catch { errorMessage = tkLocalized("无法读取愿望单。") }
    }

    private func save(_ draft: WishlistDraft) -> String? {
        save(draft, replacing: editingItem)
    }

    private func save(_ draft: WishlistDraft, replacing existingItem: WishlistItem?) -> String? {
        let isbn: String?
        if draft.isbn.isEmpty { isbn = nil }
        else if let normalized = ISBN(draft.isbn) { isbn = normalized.isbn13 }
        else { return tkLocalized("请输入校验位正确的 ISBN-10 或 ISBN-13。") }
        let now = Date.now
        let item = WishlistItem(
            id: existingItem?.id ?? UUID().uuidString.lowercased(),
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            author: draft.author.trimmingCharacters(in: .whitespacesAndNewlines),
            isbn: isbn,
            publisher: draft.publisher.nilIfBlank,
            coverURL: draft.coverURL ?? existingItem?.coverURL,
            coverKey: existingItem?.coverKey,
            coverFileName: draft.coverFileName ?? existingItem?.coverFileName,
            detailURL: draft.detailURL ?? existingItem?.detailURL,
            tags: draft.tags,
            priority: draft.priority,
            pendingBuy: draft.pendingBuy,
            addedAt: existingItem?.addedAt ?? now,
            updatedAt: now
        )
        guard !item.title.isEmpty else { return tkLocalized("书名不能为空。") }
        do {
            let repository = WishlistRepository(context: modelContext)
            if existingItem == nil { try repository.add(item) } else { try repository.update(item) }
            reload()
            cacheCoverIfNeeded(for: item)
            requestTomeKeepSync()
#if os(macOS)
            if existingItem == nil {
                Task { await captureAllPrices(for: item) }
            }
#endif
            return nil
        } catch WishlistRepositoryError.duplicateISBN {
            return tkLocalized("愿望单中已经存在相同 ISBN 的书籍。")
        } catch { return tkLocalized("保存失败，请稍后重试。") }
    }

    private func cacheCoverIfNeeded(for item: WishlistItem) {
        guard item.coverFileName == nil, let remoteURL = item.coverURL else { return }
        Task {
            guard let fileName = try? await CoverCacheService().cache(remoteURL: remoteURL, recordID: item.id) else { return }
            var updated = item
            updated.coverFileName = fileName
            updated.updatedAt = .now
            try? WishlistRepository(context: modelContext).update(updated)
            reload()
            requestTomeKeepSync()
        }
    }

    private func moveToLibrary(_ item: WishlistItem) {
        do {
#if os(macOS)
            if expandedCompactItemID == item.id { expandedCompactItemID = nil }
#endif
            _ = try WishlistRepository(context: modelContext).moveToLibrary(id: item.id)
            reload()
            requestTomeKeepSync()
        }
        catch WishlistRepositoryError.duplicateISBN { errorMessage = tkLocalized("书库中已经存在相同 ISBN 的书籍。") }
        catch { errorMessage = tkLocalized("无法移入书库。") }
    }

    private func delete(_ item: WishlistItem) {
        do {
#if os(macOS)
            if expandedCompactItemID == item.id { expandedCompactItemID = nil }
#endif
            try WishlistRepository(context: modelContext).softDelete(id: item.id)
            recentlyDeletedItem = item
            reload()
            requestTomeKeepSync()
        }
        catch { errorMessage = tkLocalized("删除失败，请稍后重试。") }
    }

    private func togglePendingBuy(_ item: WishlistItem) {
        var updated = item
        updated.pendingBuy.toggle()
        updated.updatedAt = .now
        do {
            try WishlistRepository(context: modelContext).update(updated)
            reload()
            requestTomeKeepSync()
        } catch {
            errorMessage = tkLocalized("保存失败，请稍后重试。")
        }
    }

    private func updateTags(_ tags: [String], for item: WishlistItem) {
        var updated = item
        updated.tags = normalizedBookTags(tags)
        updated.updatedAt = .now
        do {
            try WishlistRepository(context: modelContext).update(updated)
            reload()
            requestTomeKeepSync()
        } catch {
            errorMessage = tkLocalized("保存失败，请稍后重试。")
        }
    }

    private func restore(_ item: WishlistItem) {
        do {
            try WishlistRepository(context: modelContext).restore(id: item.id)
            recentlyDeletedItem = nil
            reload()
            requestTomeKeepSync()
        } catch WishlistRepositoryError.duplicateISBN {
            errorMessage = tkLocalized("愿望单中已经存在相同 ISBN 的书籍。")
        } catch {
            errorMessage = tkLocalized("无法恢复愿望。")
        }
    }

#if os(macOS)
    private func reloadPriceEntries() {
        guard let entries = try? PriceCacheRepository(context: modelContext).entries() else { return }
        priceEntries = Dictionary(uniqueKeysWithValues: entries.map { ($0.key, $0) })
    }
#endif

    private func localCoverURL(_ fileName: String?) -> URL? {
        guard let fileName, let directory = try? NativeStorageLocations.covers() else { return nil }
        return directory.appending(path: fileName)
    }

#if os(macOS)
    private func previewCover(_ item: WishlistItem) {
        guard let url = localCoverURL(item.coverFileName) else { return }
        coverPreview = CoverPreviewRoute(title: item.title, fileURL: url)
    }
#endif

#if os(macOS)
    @MainActor
    private func captureAllPrices(for item: WishlistItem) async {
        pricingMessage = tkLocalizedFormat("正在为《%@》查询三个书店…", item.title)
        let repository = PriceCacheRepository(context: modelContext)
        let key = priceKey(for: item)
        let existing = (try? repository.entry(key: key))?.quotes ?? []
        let service = RetailerPricingService()

        let outcomes = await withTaskGroup(of: PricingCaptureOutcome.self, returning: [PricingCaptureOutcome].self) { group in
            for channel in PriceChannel.allCases {
                let oldQuote = existing.first { $0.channel == channel }
                group.addTask {
                    do {
                        return .quote(try await service.capture(
                            channel: channel,
                            title: item.title,
                            author: item.author.nilIfBlank,
                            existingQuote: oldQuote
                        ))
                    } catch RetailerPricingError.verificationRequired(let url) {
                        return .verification(PricingVerificationRequest(item: item, channel: channel, url: url))
                    } catch RetailerPricingError.notFound {
                        return .status(channel, .notFound, "未找到可信商品")
                    } catch {
                        return .status(channel, .error, "查询失败")
                    }
                }
            }
            var values: [PricingCaptureOutcome] = []
            for await outcome in group { values.append(outcome) }
            return values
        }

        var quotes = existing
        var requests: [PricingVerificationRequest] = []
        for outcome in outcomes {
            switch outcome {
            case .quote(let quote):
                quotes.removeAll { $0.channel == quote.channel }
                quotes.append(quote)
            case .verification(let request):
                requests.append(request)
                quotes.removeAll { $0.channel == request.channel }
                quotes.append(statusQuote(channel: request.channel, status: .needsLogin, message: "需要登录或验证码"))
            case let .status(channel, status, message):
                quotes.removeAll { $0.channel == channel }
                quotes.append(statusQuote(channel: channel, status: status, message: message))
            }
        }
        do {
            try repository.upsert(priceEntry(item: item, key: key, quotes: quotes))
            reloadPriceEntries()
            requestTomeKeepSync()
            let successCount = quotes.count { $0.status == .ok }
            pricingMessage = tkLocalizedFormat("《%@》已完成 %lld/3 个渠道采价。", item.title, successCount)
        } catch {
            pricingMessage = tkLocalized("采价已完成，但保存失败；愿望记录不受影响。")
        }
        enqueueVerification(requests)
    }

    @MainActor
    private func retryAfterVerification(_ request: PricingVerificationRequest) async {
        do {
            let repository = PriceCacheRepository(context: modelContext)
            let key = priceKey(for: request.item)
            let old = try repository.entry(key: key)
            let quote = try await RetailerPricingService().capture(
                channel: request.channel,
                title: request.item.title,
                author: request.item.author.nilIfBlank,
                existingQuote: old?.quotes.first { $0.channel == request.channel }
            )
            var quotes = old?.quotes ?? []
            quotes.removeAll { $0.channel == request.channel }
            quotes.append(quote)
            try repository.upsert(priceEntry(item: request.item, key: key, quotes: quotes))
            reloadPriceEntries()
            requestTomeKeepSync()
            pricingMessage = tkLocalizedFormat("已在完成验证后自动更新 %@ 价格。", tkLocalized(request.channel.label))
        } catch {
            pricingMessage = tkLocalizedFormat("%@ 验证后仍无法自动采价，可使用“比价”窗口手工保存。", tkLocalized(request.channel.label))
        }
        presentNextVerification()
    }

    private func enqueueVerification(_ requests: [PricingVerificationRequest]) {
        verificationQueue.append(contentsOf: requests.sorted { $0.channel.rawValue < $1.channel.rawValue })
        presentNextVerification()
    }

    private func presentNextVerification() {
        guard activeVerification == nil, !verificationQueue.isEmpty else { return }
        let request = verificationQueue.removeFirst()
        lastVerification = request
        activeVerification = request
    }

    private func verificationDidDismiss() {
        guard let request = lastVerification else { presentNextVerification(); return }
        lastVerification = nil
        Task { await retryAfterVerification(request) }
    }

    private func priceKey(for item: WishlistItem) -> String {
        "\(item.title)::\(item.author)"
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }

    private func priceEntry(item: WishlistItem, key: String, quotes: [PriceQuote]) -> PriceCacheEntry {
        let now = Date.now
        return PriceCacheEntry(
            key: key,
            title: item.title,
            author: item.author.nilIfBlank,
            isbn: item.isbn,
            quotes: quotes,
            updatedAt: now,
            expiresAt: now.addingTimeInterval(24 * 60 * 60)
        )
    }

    private func statusQuote(channel: PriceChannel, status: PriceQuoteStatus, message: String) -> PriceQuote {
        PriceQuote(
            channel: channel,
            currency: "CNY",
            url: RetailerPricingService.searchURL(channel: channel, title: ""),
            fetchedAt: .now,
            status: status,
            source: .auto,
            message: message
        )
    }
#endif
}

#if os(iOS)
private struct IOSCompactWishlistCard: View {
    let item: WishlistItem
    let coverURL: URL?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                ZStack(alignment: .topTrailing) {
                    TomeKeepBookCover(fileURL: coverURL)
                        .aspectRatio(2.0 / 3.0, contentMode: .fit)
                        .clipShape(.rect(cornerRadius: 7))
                        .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                    if item.pendingBuy {
                        Image(systemName: "cart.fill")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 24, height: 24)
                            .background(.orange, in: .circle)
                            .padding(6)
                            .accessibilityLabel(tkLocalized("待购买"))
                    }
                }
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 4) {
                    Image(systemName: item.priority.symbol)
                    Text(tkLocalized(item.priority.label))
                }
                .font(.caption)
                .foregroundStyle(item.priority.tint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(tkLocalized("打开编辑表单"))
    }
}
#endif

#if os(macOS)
private struct DetailedWishlistCard: View {
    let item: WishlistItem
    let coverURL: URL?
    let priceEntry: PriceCacheEntry?
    let onTogglePending: () -> Void
    let onUpdateTags: ([String]) -> Void
    let onMoveToLibrary: () -> Void
    let onOpenPricing: () -> Void
    let onZoom: () -> Void
    let onSave: (WishlistDraft) -> String?
    let onDelete: () -> Void
    @State private var isHovering = false
    @State private var isEditing = false
    @State private var draft = WishlistDraft(item: nil)
    @State private var validationMessage: String?
    @State private var isTitleHovering = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                TomeKeepBookCover(fileURL: coverURL)
                    .frame(width: 78, height: 112)
                    .overlay(alignment: .topTrailing) {
                        HStack(spacing: 4) {
                            if coverURL != nil {
                                CoverZoomButton(action: onZoom)
                                    .opacity(isHovering ? 1 : 0)
                            }
                        }
                        .padding(5)
                    }

                if isEditing {
                    inlineEditor
                } else {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .top, spacing: 6) {
                            wishlistTitle
                            Button(action: onTogglePending) {
                                Image(systemName: item.pendingBuy ? "cart.fill" : "cart")
                                    .font(.caption.weight(.semibold))
                                    .frame(width: 24, height: 24)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(item.pendingBuy ? Color.accentColor : Color.secondary)
                            .immediateHoverHelp(tkLocalized(item.pendingBuy ? "取消待购买" : "标记为待购买"))
                            .accessibilityIdentifier("wishlist.book.pending.\(item.id)")
                        }
                        Text(item.author.isEmpty ? tkLocalized("未知作者") : item.author)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        if let publisher = item.publisher {
                            Text(publisher)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        } else if let isbn = item.isbn, let inferred = ISBN(isbn)?.inferredPublisher {
                            Text(inferred)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .italic()
                                .lineLimit(1)
                        }
                        InlineBookTagEditor(tags: item.tags, onChange: onUpdateTags)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                }
            }
            .frame(height: 112)

            Divider()

            if isEditing {
                HStack(spacing: 8) {
                    if let validationMessage {
                        Label(validationMessage, systemImage: "exclamationmark.circle")
                            .font(.caption2)
                            .foregroundStyle(.red)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Button("取消") { cancelEditing() }.controlSize(.small)
                    Button("保存") { saveInline() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 10)
                .frame(height: 36)
            } else {
                HStack(spacing: 4) {
                    isbnBadge
                    Label(tkLocalized(item.priority.label), systemImage: item.priority.symbol)
                        .foregroundStyle(item.priority.tint)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    if let bestQuote {
                        Link(destination: bestQuote.url) {
                            Text(bestQuote.priceCNY ?? 0, format: .currency(code: "CNY"))
                                .fontWeight(.semibold)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.accentColor)
                        .help(tkLocalized("打开最低价商品"))
                    }
                    Button("移入书库", systemImage: "books.vertical") { onMoveToLibrary() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .cardAction(tkLocalized("移入书库"), hoverColor: .green)
                        .accessibilityIdentifier("wishlist.book.move.\(item.id)")
                    Button("比价", systemImage: "tag") { onOpenPricing() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .cardAction(tkLocalized("比价"))
                        .accessibilityIdentifier("wishlist.book.price.\(item.id)")
                    Button("编辑", systemImage: "pencil") { beginEditing() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .cardAction(tkLocalized("编辑"))
                        .accessibilityIdentifier("wishlist.book.edit.\(item.id)")
                    Button("删除", systemImage: "trash") { onDelete() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .cardAction(tkLocalized("删除"), hoverColor: .red)
                        .accessibilityIdentifier("wishlist.book.delete.\(item.id)")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .frame(height: 30)
            }
        }
        .background(Color(nsColor: .controlBackgroundColor), in: .rect(cornerRadius: 11))
        .overlay {
            RoundedRectangle(cornerRadius: 11)
                .stroke(isHovering ? Color.accentColor.opacity(0.55) : Color.primary.opacity(0.10), lineWidth: 1)
        }
        .onHover { isHovering = $0 }
        .zIndex(isHovering ? 10 : 0)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("wishlist.book.detail.\(item.id)")
    }

    private var inlineEditor: some View {
        VStack(spacing: 3) {
            TextField("书名", text: $draft.title)
            TextField("作者", text: $draft.author)
            TextField("出版社", text: $draft.publisher)
            TextField("ISBN-10 或 ISBN-13", text: $draft.isbn)
        }
        .textFieldStyle(.roundedBorder)
        .controlSize(.small)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
    }

    @ViewBuilder
    private var wishlistTitle: some View {
        if let url = item.detailURL ?? item.isbn.flatMap({ URL(string: "https://isbnsearch.org/isbn/\($0)") }) {
            Link(destination: url) {
                Text(item.title)
                    .font(.headline)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(isTitleHovering ? Color.accentColor : Color.primary)
            .underline(isTitleHovering)
            .onHover { isTitleHovering = $0 }
            .help(tkLocalized("打开关联页面"))
        } else {
            Text(item.title)
                .font(.headline)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var isbnBadge: some View {
        if let value = item.isbn, let parsed = ISBN(value) {
            Button { copyToPasteboard(parsed.isbn13) } label: {
                if let semantics = parsed.semantics {
                    Label("\(tkLocalized(semantics.language)) · \(tkLocalized(semantics.region))", systemImage: "barcode")
                } else {
                    Label(parsed.isbn13, systemImage: "barcode")
                }
            }
            .buttonStyle(.plain)
            .lineLimit(1)
            .help(tkLocalizedFormat("复制 ISBN %@", parsed.isbn13))
        }
    }

    private var bestQuote: PriceQuote? {
        priceEntry?.quotes
            .filter { $0.status == .ok && $0.priceCNY != nil }
            .min { ($0.priceCNY ?? .infinity) < ($1.priceCNY ?? .infinity) }
    }

    private func beginEditing() {
        draft = WishlistDraft(item: item)
        validationMessage = nil
        isEditing = true
    }

    private func cancelEditing() {
        validationMessage = nil
        isEditing = false
    }

    private func saveInline() {
        validationMessage = onSave(draft)
        if validationMessage == nil { isEditing = false }
    }
}

private struct WishlistCard: View {
    let item: WishlistItem
    let coverURL: URL?
    let isExpanded: Bool
    let action: () -> Void
    let zoom: () -> Void
    @State private var isHovering = false

    var body: some View {
        VStack(spacing: 6) {
            TomeKeepBookCover(fileURL: coverURL)
                .frame(maxWidth: .infinity)
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .overlay {
                    RoundedRectangle(cornerRadius: TomeKeepTheme.coverCornerRadius)
                        .stroke(
                            isExpanded ? Color.accentColor : (isHovering ? Color.accentColor.opacity(0.8) : .primary.opacity(0.08)),
                            lineWidth: isExpanded || isHovering ? 2 : 1
                        )
                }
                .overlay(alignment: .topTrailing) {
                    HStack(spacing: 4) {
                        if coverURL != nil {
                            Button(action: zoom) {
                                Image(systemName: "arrow.up.left.and.arrow.down.right")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 22, height: 22)
                                    .background(.black.opacity(0.56), in: .rect(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                            .opacity(isHovering ? 1 : 0)
                            .accessibilityLabel(tkLocalized("查看大图"))
                        }
                        if item.pendingBuy {
                            Image(systemName: "cart.fill")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(width: 22, height: 22)
                                .background(.blue, in: .circle)
                        }
                    }
                    .padding(5)
                }
                .contentShape(.rect)
                .onTapGesture(perform: action)
            compactTitle
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .clipped()
        .onHover { isHovering = $0 }
        .contentShape(.rect)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("wishlist.book.card.\(item.id)")
        .accessibilityLabel("\(item.title), \(item.author), \(tkLocalized(item.priority.label))")
        .accessibilityHint(tkLocalized(isExpanded ? "收起详细卡片" : "展开详细卡片"))
    }

    @ViewBuilder
    private var compactTitle: some View {
        if let url = item.detailURL ?? item.isbn.flatMap({ URL(string: "https://isbnsearch.org/isbn/\($0)") }) {
            Link(destination: url) {
                compactTitleText
            }
            .buttonStyle(.plain)
            .help(tkLocalized("打开关联页面"))
        } else {
            Button(action: action) { compactTitleText }.buttonStyle(.plain)
        }
    }

    private var compactTitleText: some View {
        Text(item.title)
            .font(.caption)
            .foregroundStyle(.primary)
            .multilineTextAlignment(.center)
            .lineLimit(2, reservesSpace: true)
            .frame(maxWidth: .infinity, alignment: .top)
    }
}

private struct PricingVerificationRequest: Identifiable, Sendable {
    let id = UUID()
    let item: WishlistItem
    let channel: PriceChannel
    let url: URL
}

private enum PricingCaptureOutcome: Sendable {
    case quote(PriceQuote)
    case verification(PricingVerificationRequest)
    case status(PriceChannel, PriceQuoteStatus, String)
}
#endif

private struct WishlistDraft {
    var title = ""
    var author = ""
    var isbn = ""
    var publisher = ""
    var tagsText = ""
    var priority: WishlistPriority = .medium
    var pendingBuy = false
    var coverURL: URL?
    var coverFileName: String?
    var detailURL: URL?

    init(item: WishlistItem?) {
        guard let item else { return }
        title = item.title
        author = item.author
        isbn = item.isbn ?? ""
        publisher = item.publisher ?? ""
        tagsText = item.tags.joined(separator: "，")
        priority = item.priority
        pendingBuy = item.pendingBuy
        coverURL = item.coverURL
        coverFileName = item.coverFileName
        detailURL = item.detailURL
    }

    var tags: [String] {
        tagsText.split(whereSeparator: { ",，、".contains($0) })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

private struct WishlistEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: WishlistDraft
    @State private var validationMessage: String?
    @State private var isLookingUp = false
    @State private var lookupMessage: String?
    @State private var verificationTarget: WebsiteVerificationTarget?
    @State private var candidates: [BookMetadata] = []
    @State private var isShowingCandidates = false
    @State private var didInspectPasteboard = false
    let item: WishlistItem?
    let onSave: (WishlistDraft) -> String?

    init(item: WishlistItem?, onSave: @escaping (WishlistDraft) -> String?) {
        self.item = item
        self.onSave = onSave
        _draft = State(initialValue: WishlistDraft(item: item))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    if item == nil {
                        Button {
                            Task { await importFromPasteboard() }
                        } label: {
                            Label(tkLocalized("从剪贴板导入"), systemImage: "doc.on.clipboard")
                        }
                        .disabled(isLookingUp)
                    }
                    TextField("书名", text: $draft.title)
                    TextField("作者", text: $draft.author)
                    TextField("出版社", text: $draft.publisher)
                    Button("按书名关联豆瓣", systemImage: "link.badge.plus") {
                        Task { await searchDouban() }
                    }
                    .disabled(isLookingUp || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    HStack {
                        TextField("ISBN-10 或 ISBN-13", text: $draft.isbn)
                        Button {
                            Task { await fillMetadata() }
                        } label: {
                            if isLookingUp { ProgressView().controlSize(.small) }
                            else { Label("查询资料", systemImage: "sparkle.magnifyingglass") }
                        }
                        .disabled(isLookingUp || draft.isbn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    TextField("标签（逗号分隔）", text: $draft.tagsText)
                    if let lookupMessage {
                        Label(lookupMessage, systemImage: draft.coverURL == nil ? "info.circle" : "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(draft.coverURL == nil ? Color.secondary : Color.green)
                    }
                }
                Section("购买计划") {
                    Picker("优先级", selection: $draft.priority) {
                        ForEach(WishlistPriority.allCases, id: \.self) { value in
                            Text(value.label).tag(value)
                        }
                    }
                    Toggle("标记为待购买", isOn: $draft.pendingBuy)
                }
                if let validationMessage {
                    Label(validationMessage, systemImage: "exclamationmark.circle")
                        .foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(tkLocalized(item == nil ? "添加愿望" : "编辑愿望"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        validationMessage = onSave(draft)
                        if validationMessage == nil { dismiss() }
                    }
                    .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .task { await inspectPasteboardOnAdd() }
        .sheet(item: $verificationTarget, onDismiss: {
            Task { await fillMetadata(showVerification: false) }
        }) { target in
            WebsiteVerificationView(url: target.url)
        }
        .sheet(isPresented: $isShowingCandidates) {
            MetadataCandidatePicker(candidates: candidates) { apply($0) }
        }
    }

    @MainActor
    private func inspectPasteboardOnAdd() async {
        guard item == nil, !didInspectPasteboard else { return }
        didInspectPasteboard = true
#if os(macOS)
        guard let text = pasteboardString(),
              case .doubanURL = parseClipboardBookSeed(text)
        else { return }
        await importClipboardText(text)
#endif
    }

    @MainActor
    private func importFromPasteboard() async {
        guard let text = pasteboardString() else {
            lookupMessage = tkLocalized("剪贴板为空。")
            return
        }
        await importClipboardText(text)
    }

    @MainActor
    private func importClipboardText(_ text: String) async {
        guard let seed = parseClipboardBookSeed(text) else {
            lookupMessage = tkLocalized("剪贴板为空。")
            return
        }
        switch seed {
        case .doubanURL(let url):
            isLookingUp = true
            lookupMessage = tkLocalized("正在从剪贴板导入…")
            defer { isLookingUp = false }
            do {
                let result = try await MetadataLookupService().lookupDoubanURL(url)
                apply(result.metadata)
                lookupMessage = tkLocalized("已从剪贴板解析豆瓣链接。")
            } catch {
                lookupMessage = tkErrorDescription(error, fallback: "豆瓣链接解析失败，仍可手工录入。")
            }
        case .isbn13(let isbn):
            draft.isbn = isbn
            await fillMetadata()
        case .title(let title):
            draft.title = title
            lookupMessage = tkLocalized("已从剪贴板填入书名。")
        }
    }

    @MainActor
    private func fillMetadata(showVerification: Bool = true) async {
        isLookingUp = true
        lookupMessage = nil
        defer { isLookingUp = false }
        do {
            let result = try await MetadataLookupService().lookupISBN(draft.isbn)
            if let value = result.metadata.title { draft.title = value }
            if let value = result.metadata.author { draft.author = value }
            if let value = result.metadata.publisher { draft.publisher = value }
            if let value = result.metadata.isbn13 { draft.isbn = value }
            draft.coverURL = result.metadata.coverURL
            draft.detailURL = result.metadata.detailURL
            lookupMessage = tkLocalizedFormat("已从 %@ 填充资料", tkLocalized(result.source.label))
        } catch MetadataLookupError.verificationRequired(let url) {
            if showVerification { verificationTarget = WebsiteVerificationTarget(url: url) }
            lookupMessage = showVerification
                ? tkLocalized("请完成网页验证；关闭窗口后会自动重试")
                : tkLocalized("验证尚未生效，可再次打开网页或手工录入")
        } catch {
            lookupMessage = tkErrorDescription(error, fallback: "查询失败，仍可手工录入")
        }
    }

    @MainActor
    private func searchDouban() async {
        isLookingUp = true
        lookupMessage = nil
        defer { isLookingUp = false }
        do {
            candidates = try await MetadataLookupService().searchDouban(title: draft.title, author: draft.author.nilIfBlank)
            isShowingCandidates = true
        } catch {
            lookupMessage = tkErrorDescription(error, fallback: "豆瓣搜索失败，仍可手工录入")
        }
    }

    private func apply(_ metadata: BookMetadata) {
        if let value = metadata.title { draft.title = value }
        if let value = metadata.author { draft.author = value }
        if let value = metadata.publisher { draft.publisher = value }
        if let value = metadata.isbn13 { draft.isbn = value }
        draft.coverURL = metadata.coverURL
        draft.detailURL = metadata.detailURL
        lookupMessage = tkLocalized("已关联豆瓣候选，可继续编辑")
    }
}

private struct ReadingProfilesView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var profiles: [UserProfile] = []
    @State private var activeProfileID: String?
    @State private var books: [Book] = []
    @State private var states: [String: ReadingState] = [:]
    @State private var searchText = ""
    @State private var isManagingProfiles = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if profiles.isEmpty {
                ContentUnavailableView("没有阅读档案", systemImage: "person.crop.circle.badge.plus", description: Text("创建档案后可分别记录每个人的阅读进度。"))
            } else {
                List(filteredBooks) { book in
                    HStack(spacing: 12) {
                        TomeKeepBookCover(fileURL: localCoverURL(book.coverFileName))
                            .frame(width: 38, height: 57)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(book.title).font(.headline)
                            Text(book.author).foregroundStyle(.secondary)
                            if let completedAt = states[book.id]?.completedAt {
                                Text("完成于 \(completedAt.formatted(.dateTime.year().month().day()))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Picker("阅读状态", selection: statusBinding(for: book.id)) {
                            ForEach(ReadingStatus.allCases, id: \.self) { status in
                                Text(status.label).tag(status)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 110)
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle("阅读档案")
        .searchable(text: $searchText, prompt: "筛选书库")
        .toolbar {
            ToolbarItem {
                if profiles.count > 1 {
                    Picker("当前档案", selection: activeBinding) {
                        ForEach(profiles) { profile in Text(profile.name).tag(profile.id) }
                    }
                    .frame(minWidth: 120)
                } else if let profile = profiles.first {
                    Label(profile.name, systemImage: "person.crop.circle")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button("管理档案", systemImage: "person.2") { isManagingProfiles = true }
            }
        }
        .sheet(isPresented: $isManagingProfiles, onDismiss: reload) {
            ProfileManagerView()
                .frame(minWidth: 420, minHeight: 320)
        }
        .alert("无法完成操作", isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) { Button("好", role: .cancel) {} } message: { Text(errorMessage ?? tkLocalized("未知错误")) }
        .task { reload() }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in
            reload()
        }
    }

    private var filteredBooks: [Book] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return books }
        return books.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.author.localizedCaseInsensitiveContains(query) }
    }

    private var activeBinding: Binding<String> {
        Binding(
            get: { activeProfileID ?? profiles.first?.id ?? "" },
            set: { id in
                do { try ProfileRepository(context: modelContext).setActiveProfile(id: id); activeProfileID = id; reloadStates() }
                catch { errorMessage = tkLocalized("无法切换阅读档案。") }
            }
        )
    }

    private func statusBinding(for bookID: String) -> Binding<ReadingStatus> {
        Binding(
            get: { states[bookID]?.status ?? .unread },
            set: { status in
                guard let profileID = activeProfileID else { return }
                do {
                    states[bookID] = try ProfileRepository(context: modelContext)
                        .setReadingStatus(status, bookID: bookID, profileID: profileID)
                    requestTomeKeepSync()
                } catch { errorMessage = tkLocalized("无法更新阅读状态。") }
            }
        )
    }

    private func reload() {
        do {
            let repository = ProfileRepository(context: modelContext)
            profiles = try repository.profiles()
            activeProfileID = try repository.activeProfileID() ?? profiles.first?.id
            books = try BookRepository(context: modelContext).books()
            reloadStates()
        } catch { errorMessage = tkLocalized("无法读取阅读档案。") }
    }

    private func reloadStates() {
        guard let activeProfileID else { states = [:]; return }
        do { states = try ProfileRepository(context: modelContext).readingStates(profileID: activeProfileID) }
        catch { errorMessage = tkLocalized("无法读取阅读状态。") }
    }

    private func localCoverURL(_ fileName: String?) -> URL? {
        guard let fileName, let directory = try? NativeStorageLocations.covers() else { return nil }
        return directory.appending(path: fileName)
    }
}

private struct ProfileManagerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var profiles: [UserProfile] = []
    @State private var newName = ""
    @State private var errorMessage: String?
    @State private var pendingDeletion: UserProfile?
    @State private var editingProfile: UserProfile?
    @State private var editedName = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("现有档案") {
                    ForEach(profiles) { profile in
                        HStack {
                            Label(profile.name, systemImage: "person.crop.circle")
                            Spacer()
                            Button("重命名", systemImage: "pencil") {
                                editingProfile = profile
                                editedName = profile.name
                            }
                            .labelStyle(.iconOnly)
                            Button("删除", systemImage: "trash", role: .destructive) {
                                pendingDeletion = profile
                            }
                                .labelStyle(.iconOnly)
                                .disabled(profiles.count == 1)
                        }
                    }
                }
                Section("新建档案") {
                    HStack {
                        TextField("档案名称", text: $newName)
                        Button("添加") { add() }
                            .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            .navigationTitle("管理阅读档案")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .task { reload() }
            .confirmationDialog(
                "删除“\(pendingDeletion?.name ?? "")”档案？",
                isPresented: Binding(
                    get: { pendingDeletion != nil },
                    set: { if !$0 { pendingDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("删除档案及阅读记录", role: .destructive) {
                    guard let profile = pendingDeletion else { return }
                    pendingDeletion = nil
                    delete(profile)
                }
                Button("取消", role: .cancel) { pendingDeletion = nil }
            } message: {
                Text("该档案的所有阅读状态会同时删除。")
            }
            .alert(
                "重命名档案",
                isPresented: Binding(
                    get: { editingProfile != nil },
                    set: { if !$0 { editingProfile = nil } }
                )
            ) {
                TextField("档案名称", text: $editedName)
                Button("取消", role: .cancel) { editingProfile = nil }
                Button("保存") { rename() }
                    .disabled(editedName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func reload() {
        do { profiles = try ProfileRepository(context: modelContext).profiles() }
        catch { errorMessage = tkLocalized("无法读取档案。") }
    }
    private func add() {
        do {
            _ = try ProfileRepository(context: modelContext).add(name: newName)
            newName = ""
            reload()
            requestTomeKeepSync()
        }
        catch { errorMessage = tkLocalized("无法创建档案。") }
    }
    private func delete(_ profile: UserProfile) {
        do {
            try ProfileRepository(context: modelContext).delete(id: profile.id)
            reload()
            requestTomeKeepSync()
        }
        catch ProfileRepositoryError.lastProfile { errorMessage = tkLocalized("至少需要保留一个档案。") }
        catch { errorMessage = tkLocalized("无法删除档案。") }
    }
    private func rename() {
        guard let profile = editingProfile else { return }
        do {
            try ProfileRepository(context: modelContext).rename(id: profile.id, name: editedName)
            editingProfile = nil
            reload()
            requestTomeKeepSync()
        } catch {
            errorMessage = tkLocalized("无法重命名档案。")
        }
    }
}

private struct PriceHistoryView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var entries: [PriceCacheEntry] = []
    @State private var booksByISBN: [String: Book] = [:]
    @State private var searchText = ""
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if entries.isEmpty {
                ContentUnavailableView("没有价格记录", systemImage: "tag", description: Text("历史比价结果会保留在这里。"))
            } else if filteredEntries.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else {
                List(filteredEntries) { entry in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(displayTitle(for: entry)).font(.headline)
                            Spacer()
                            Text(entry.updatedAt.formatted(
                                .dateTime.year().month().day().hour().minute()
                            ))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let author = entry.author { Text(author).foregroundStyle(.secondary) }
                        HStack(spacing: 8) {
                            ForEach(entry.quotes, id: \.self) { quote in
                                HStack(spacing: 4) {
                                    Link(destination: quote.url) {
                                        HStack(spacing: 5) {
                                            Text(tkLocalized(quote.channel.label))
                                            Text(quote.priceCNY.map { "¥\($0.formatted(.number.precision(.fractionLength(2))))" } ?? tkLocalized(quote.status.label))
                                        }
                                    }
                                    .buttonStyle(.plain)
                                    if quote.source == .manual {
                                        Button {
                                            clearManualFlag(entry: entry, quote: quote)
                                        } label: {
                                            Image(systemName: "pencil")
                                                .foregroundStyle(.orange)
                                        }
                                        .buttonStyle(.plain)
                                        .help("移除手工价格标记")
                                        .accessibilityLabel("手工录入，点击移除标记")
                                    }
                                }
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, 9).padding(.vertical, 5)
                                .background(.quaternary, in: .capsule)
                            }
                        }
                    }
                    .padding(.vertical, 6)
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle("价格记录")
        .searchable(text: $searchText, prompt: "书名、作者或 ISBN")
        .task {
            reload()
        }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in
            reload()
        }
        .alert("无法读取", isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) { Button("好", role: .cancel) {} } message: { Text(errorMessage ?? tkLocalized("未知错误")) }
    }

    private var filteredEntries: [PriceCacheEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return entries }
        return entries.filter {
            displayTitle(for: $0).localizedCaseInsensitiveContains(query) ||
            ($0.author?.localizedCaseInsensitiveContains(query) ?? false) ||
            ($0.isbn?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    private func reload() {
        do {
            entries = try PriceCacheRepository(context: modelContext).entries()
            booksByISBN = Dictionary(
                try BookRepository(context: modelContext).books().compactMap { book in
                    book.isbn.map { ($0, book) }
                },
                uniquingKeysWith: { first, _ in first }
            )
        } catch {
            errorMessage = tkLocalized("无法读取价格记录。")
        }
    }

    private func displayTitle(for entry: PriceCacheEntry) -> String {
        let title = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { return title }
        if let isbn = entry.isbn, let book = booksByISBN[isbn] { return book.title }
        if let isbn = entry.isbn { return "ISBN \(isbn)" }
        return tkLocalized("旧版价格记录")
    }

    private func clearManualFlag(entry: PriceCacheEntry, quote: PriceQuote) {
        var updated = entry
        guard let index = updated.quotes.firstIndex(of: quote) else { return }
        updated.quotes[index].source = nil
        updated.updatedAt = .now
        do {
            try PriceCacheRepository(context: modelContext).upsert(updated)
            if let entryIndex = entries.firstIndex(where: { $0.key == updated.key }) {
                entries[entryIndex] = updated
            }
            requestTomeKeepSync()
        } catch {
            errorMessage = tkLocalized("无法更新价格来源标记。")
        }
    }
}

private struct AuthenticationGateView: View {
    @Environment(NativeSyncCoordinator.self) private var syncCoordinator
    @AppStorage("tomekeep.apiBaseURL") private var apiBaseURL = "https://tomekeep.pages.dev/api/"
    @State private var username = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var isRegistering = false
    @State private var showsAdvancedSettings = false
    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 10) {
                    Image(systemName: "books.vertical.fill")
                        .font(.system(size: 46, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                    Text("TomeKeep")
                        .font(.largeTitle.weight(.bold))
                    Text(verbatim: tkLocalized("登录后使用书库，并在设备间自动同步。"))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                VStack(spacing: 14) {
                    TextField(tkLocalized("用户名"), text: $username)
#if os(iOS)
                        .textInputAutocapitalization(.never)
                        .textContentType(.username)
                        .autocorrectionDisabled()
#endif
                    SecureField(tkLocalized("密码"), text: $password)
#if os(iOS)
                        .textContentType(.password)
                        .submitLabel(.go)
#endif
                        .onSubmit { submitLogin() }

                    if let errorMessage {
                        Label {
                            Text(verbatim: errorMessage)
                        } icon: {
                            Image(systemName: "exclamationmark.circle")
                        }
                        .font(.caption)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        submitLogin()
                    } label: {
                        HStack(spacing: 8) {
                            if isWorking { ProgressView().controlSize(.small) }
                            Text(verbatim: tkLocalized(isWorking ? "正在登录…" : "登录"))
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!canSubmit)

                    Button(tkLocalized("使用邀请码注册")) {
                        isRegistering = true
                    }
                    .disabled(isWorking || validatedBaseURL == nil)

                    DisclosureGroup(
                        tkLocalized("高级设置"),
                        isExpanded: $showsAdvancedSettings
                    ) {
                        VStack(alignment: .leading, spacing: 6) {
                            TextField(tkLocalized("API 地址"), text: $apiBaseURL)
#if os(iOS)
                                .textInputAutocapitalization(.never)
                                .keyboardType(.URL)
                                .autocorrectionDisabled()
#endif
                            Text(verbatim: tkLocalized("正式服务已预设；仅本地开发时需要修改。"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.top, 8)
                    }
                    .font(.callout)
                }
                .textFieldStyle(.roundedBorder)
                .padding(22)
                .background(.regularMaterial, in: .rect(cornerRadius: 18))
            }
            .frame(maxWidth: 390)
            .padding(.horizontal, 24)
            .padding(.vertical, 48)
            .frame(maxWidth: .infinity)
        }
        .background(Color.accentColor.opacity(0.035))
        .sheet(isPresented: $isRegistering) {
            if let baseURL = validatedBaseURL {
                RegistrationView(baseURL: baseURL) { user in
                    completeAuthentication(user)
                }
            }
        }
    }

    private var canSubmit: Bool {
        !isWorking &&
        !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !password.isEmpty &&
        validatedBaseURL != nil
    }

    private func submitLogin() {
        guard canSubmit else { return }
        Task { await login() }
    }

    @MainActor
    private func login() async {
        guard let baseURL = validatedBaseURL else {
            errorMessage = tkLocalized("同步地址无效。")
            return
        }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let user = try await AuthenticationService(baseURL: baseURL).login(
                username: username.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
            password = ""
            completeAuthentication(user)
        } catch {
            errorMessage = authenticationErrorDescription(error)
        }
    }

    private func completeAuthentication(_ user: AuthUser) {
        ProfileAccountContext.currentID = user.id
        syncCoordinator.markSignedIn()
    }

    private var validatedBaseURL: URL? {
        guard let url = URL(string: apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), let host = url.host,
              scheme == "https" || (scheme == "http" && isLocalDevelopmentHost(host))
        else { return nil }
        return url.absoluteString.hasSuffix("/") ? url : URL(string: url.absoluteString + "/")
    }

    private func isLocalDevelopmentHost(_ host: String) -> Bool {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" { return true }
        if host.hasPrefix("192.168.") || host.hasPrefix("10.") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 172 && (16...31).contains(parts[1])
    }

    private func authenticationErrorDescription(_ error: Error) -> String {
        if case APIClientError.rejected(statusCode: 401, message: _) = error {
            return tkLocalized("用户名或密码不正确。")
        }
        if case APIClientError.rejected(statusCode: 429, message: _) = error {
            return tkLocalized("尝试次数过多，请稍后再试。")
        }
        return tkErrorDescription(error, fallback: "无法连接同步服务。")
    }
}

private struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(NativeSyncCoordinator.self) private var syncCoordinator
    @AppStorage("tomekeep.apiBaseURL") private var apiBaseURL = "https://tomekeep.pages.dev/api/"
    @State private var username = ""
    @State private var password = ""
    @State private var currentUser: AuthUser?
    @State private var isWorking = false
    @State private var message: String?
    @State private var messageIsError = false
    @State private var isManagingInvites = false
    @State private var isRegistering = false
    @State private var isShowingMigration = false
    let platform: TomeKeepPlatform

    var body: some View {
        Form {
            Section("同步服务") {
                TextField("API 地址", text: $apiBaseURL)
#if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
#endif
                Text("正式服务默认使用 TomeKeep Cloud；本地开发可填写 Mac 的局域网地址和 `/api/` 路径。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                syncStatus
            }

            Section("账户") {
                if let currentUser {
                    LabeledContent("当前账户", value: currentUser.name.isEmpty ? currentUser.username : currentUser.name)
                    LabeledContent("用户名", value: currentUser.username)
                    if currentUser.isAdmin {
                        Label("管理员", systemImage: "checkmark.shield.fill")
                            .foregroundStyle(.blue)
                        Button("管理邀请码", systemImage: "ticket") { isManagingInvites = true }
                    }
                    Button {
                        Task { await synchronize() }
                    } label: {
                        if syncCoordinator.isSyncing { ProgressView().controlSize(.small) }
                        else { Label("立即同步", systemImage: "arrow.triangle.2.circlepath") }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isWorking || syncCoordinator.isSyncing)
                    Button("退出登录", role: .destructive) { logout() }
                } else {
                    TextField("用户名", text: $username)
#if os(iOS)
                        .textInputAutocapitalization(.never)
#endif
                    SecureField("密码", text: $password)
                    Button {
                        Task { await login() }
                    } label: {
                        if isWorking { ProgressView().controlSize(.small) }
                        else { Text("登录") }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isWorking || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                    Button("使用邀请码注册") { isRegistering = true }
                }
                if let message {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(messageIsError ? Color.red : Color.secondary)
                }
            }

            Section("本机数据") {
                LabeledContent("存储方式", value: tkLocalized("SwiftData，本地优先"))
                LabeledContent("凭据", value: tkLocalized("系统钥匙串"))
                Text("登录和同步不会改变 Electron/PWA 的旧数据目录。网络不可用时，本机录入仍可继续。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    isShowingMigration = true
                } label: {
                    Label(platform == .iOS ? "从 Mac 转移数据" : "数据迁移", systemImage: "externaldrive.badge.plus")
                }
            }
#if os(iOS)
            Section("更多功能") {
                NavigationLink {
                    ReadingProfilesView()
                } label: {
                    Label("阅读档案", systemImage: "person.crop.circle")
                }
                NavigationLink {
                    PriceHistoryView()
                } label: {
                    Label("价格记录", systemImage: "tag")
                }
                Text("阅读档案和历史价格保留完整能力，但不占用主要标签栏。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
#endif
        }
        .formStyle(.grouped)
        .navigationTitle(Text(verbatim: tkLocalized("设置")))
#if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
#endif
#if os(macOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(tkLocalized("数据迁移"), systemImage: "externaldrive.badge.plus") {
                    isShowingMigration = true
                }
                .labelStyle(.iconOnly)
                .help(Text(verbatim: tkLocalized("数据迁移")))
            }
        }
#endif
        .task { await restoreSession() }
        .sheet(isPresented: $isManagingInvites) {
            if let baseURL = validatedBaseURL {
                AdminInvitesView(baseURL: baseURL)
            }
        }
        .sheet(isPresented: $isRegistering) {
            if let baseURL = validatedBaseURL {
                RegistrationView(baseURL: baseURL) { user in
                    currentUser = user
                    syncCoordinator.markSignedIn()
                    ProfileAccountContext.currentID = user.id
                    username = ""
                    password = ""
                    messageIsError = false
                    message = tkLocalized("注册并登录成功，正在同步数据。")
                    Task { await synchronize(trigger: .login) }
                }
            } else {
                ContentUnavailableView(
                    "同步地址无效",
                    systemImage: "exclamationmark.triangle",
                    description: Text("请先关闭此窗口，并在设置中填写有效的 API 地址。")
                )
            }
        }
        .sheet(isPresented: $isShowingMigration) {
            NavigationStack { LegacyMigrationView() }
#if os(macOS)
                .frame(minWidth: 720, minHeight: 520)
#endif
        }
    }

    @ViewBuilder
    private var syncStatus: some View {
        if syncCoordinator.isSyncing {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(verbatim: tkLocalized("正在与服务器同步…"))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        } else if let error = syncCoordinator.lastError {
            Label {
                Text(verbatim: error)
            } icon: {
                Image(systemName: "exclamationmark.icloud")
            }
                .font(.caption)
                .foregroundStyle(.orange)
        } else if let date = syncCoordinator.lastSuccessAt,
                  let result = syncCoordinator.lastResult {
            Label {
                Text(verbatim: tkLocalizedFormat(
                    "上次同步 %@：接收 %lld 条，发送 %lld 条。",
                    date.formatted(date: .abbreviated, time: .shortened),
                    result.pulled,
                    result.pushed
                ))
            } icon: {
                Image(systemName: "checkmark.icloud")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        } else {
            Label {
                Text(verbatim: tkLocalized("尚未在本次运行中完成同步"))
            } icon: {
                Image(systemName: "icloud")
            }
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @MainActor
    private func login() async {
        guard let baseURL = validatedBaseURL else {
            message = tkLocalized("请输入有效的 HTTPS 地址；本地调试允许 localhost、127.0.0.1 或局域网 HTTP 地址。")
            return
        }
        isWorking = true
        message = nil
        messageIsError = false
        defer { isWorking = false }
        do {
            currentUser = try await AuthenticationService(baseURL: baseURL).login(
                username: username.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
            syncCoordinator.markSignedIn()
            ProfileAccountContext.currentID = currentUser?.id
            password = ""
            let result = await syncCoordinator.synchronize(
                context: modelContext,
                baseURL: baseURL,
                uploadsPriceCache: platform == .macOS,
                trigger: .login
            )
            if let result {
                message = tkLocalizedFormat("登录并同步完成：接收 %lld 条，发送 %lld 条。", result.pulled, result.pushed)
            } else if let error = syncCoordinator.lastError {
                messageIsError = true
                message = tkLocalizedFormat("登录成功，但%@", error)
            } else {
                message = tkLocalized("登录成功；同步请求已加入队列。")
            }
        } catch {
            messageIsError = true
            message = localizedAuthenticationError(error)
        }
    }

    @MainActor
    private func restoreSession() async {
        guard let baseURL = validatedBaseURL else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            currentUser = try await AuthenticationService(baseURL: baseURL).restoredUser()
            if currentUser == nil {
                syncCoordinator.markSignedOut()
            } else {
                syncCoordinator.markSignedIn()
            }
            ProfileAccountContext.currentID = currentUser?.id
        }
        catch {
            messageIsError = true
            message = tkLocalized("无法恢复会话；本机数据仍可正常使用。")
        }
    }

    @MainActor
    private func synchronize() async {
        await synchronize(trigger: .manual)
    }

    @MainActor
    private func synchronize(trigger: NativeSyncTrigger) async {
        guard let baseURL = validatedBaseURL else {
            messageIsError = true
            message = tkLocalized("同步地址无效。")
            return
        }
        message = nil
        messageIsError = false
        let result = await syncCoordinator.synchronize(
            context: modelContext,
            baseURL: baseURL,
            uploadsPriceCache: platform == .macOS,
            trigger: trigger
        )
        if let result {
            message = tkLocalizedFormat("同步完成：接收 %lld 条，发送 %lld 条。", result.pulled, result.pushed)
        } else if let error = syncCoordinator.lastError {
            messageIsError = true
            message = error
        } else {
            message = tkLocalized("同步请求已加入队列。")
        }
    }

    private func logout() {
        do {
            try KeychainTokenStore().delete()
            currentUser = nil
            ProfileAccountContext.currentID = nil
            syncCoordinator.markSignedOut()
            syncCoordinator.clearSessionStatus()
            message = nil
            messageIsError = false
        } catch { message = tkLocalized("无法从钥匙串移除登录信息。") }
    }

    private var validatedBaseURL: URL? {
        guard let url = URL(string: apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), let host = url.host,
              scheme == "https" || (scheme == "http" && isLocalDevelopmentHost(host))
        else { return nil }
        return url.absoluteString.hasSuffix("/") ? url : URL(string: url.absoluteString + "/")
    }

    private func isLocalDevelopmentHost(_ host: String) -> Bool {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" { return true }
        if host.hasPrefix("192.168.") || host.hasPrefix("10.") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 172 && (16...31).contains(parts[1])
    }

    private func localizedAuthenticationError(_ error: Error) -> String {
        if case APIClientError.rejected(statusCode: 401, message: _) = error {
            return tkLocalized("用户名或密码不正确。")
        }
        if case APIClientError.rejected(statusCode: 429, message: _) = error {
            return tkLocalized("尝试次数过多，请稍后再试。")
        }
        return tkErrorDescription(error, fallback: "无法连接同步服务。")
    }
}

private struct RegistrationView: View {
    @Environment(\.dismiss) private var dismiss
    let baseURL: URL
    let didRegister: (AuthUser) -> Void

    @State private var username = ""
    @State private var displayName = ""
    @State private var password = ""
    @State private var inviteCode = ""
    @State private var isWorking = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("账户") {
                    TextField("用户名", text: $username)
#if os(iOS)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
#endif
                    TextField("显示名称", text: $displayName)
                    SecureField("密码（至少 8 位）", text: $password)
                    TextField("邀请码", text: $inviteCode)
#if os(iOS)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
#endif
                }
                Section {
                    Text("邀请码只能使用一次；注册成功后会直接登录，并将会话保存在系统钥匙串中。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let message {
                    Section { Text(message).foregroundStyle(.red) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("注册 TomeKeep")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("注册") { Task { await register() } }
                        .disabled(!canSubmit || isWorking)
                }
            }
            .overlay { if isWorking { ProgressView() } }
        }
#if os(macOS)
        .frame(minWidth: 460, minHeight: 430)
#endif
    }

    private var canSubmit: Bool {
        username.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 &&
        !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        password.count >= 8 &&
        !inviteCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @MainActor
    private func register() async {
        isWorking = true
        message = nil
        defer { isWorking = false }
        do {
            let user = try await AuthenticationService(baseURL: baseURL).register(
                username: username.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password,
                name: displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                inviteCode: inviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            didRegister(user)
            dismiss()
        } catch APIClientError.rejected(statusCode: 400, message: let serverMessage) {
            message = switch serverMessage {
            case "invalid_invite_code": tkLocalized("邀请码无效。")
            case "invite_code_used": tkLocalized("邀请码已经使用。")
            case "password_too_short": tkLocalized("密码至少需要 8 位。")
            case "invalid_username": tkLocalized("用户名长度需为 2–32 位。")
            default: tkLocalized("请检查注册信息。")
            }
        } catch APIClientError.rejected(statusCode: 409, message: _) {
            message = tkLocalized("用户名已被使用。")
        } catch APIClientError.rejected(statusCode: 429, message: _) {
            message = tkLocalized("尝试次数过多，请稍后再试。")
        } catch {
            message = tkErrorDescription(error, fallback: "无法连接注册服务。")
        }
    }
}

private struct AdminInvitesView: View {
    @Environment(\.dismiss) private var dismiss
    let baseURL: URL
    @State private var invites: [InviteCode] = []
    @State private var total = 0
    @State private var isWorking = false
    @State private var message: String?
    @State private var pendingDeletion: InviteCode?

    var body: some View {
        NavigationStack {
            Group {
                if invites.isEmpty, !isWorking {
                    ContentUnavailableView("没有邀请码", systemImage: "ticket", description: Text("创建一个邀请码后可供新用户注册。"))
                } else {
                    List(invites) { invite in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(invite.code).font(.headline.monospaced()).textSelection(.enabled)
                                if let username = invite.usedByUsername {
                                    Text("已由 \(username) 使用").font(.caption).foregroundStyle(.secondary)
                                } else {
                                    Text("未使用").font(.caption).foregroundStyle(.green)
                                }
                            }
                            Spacer()
                            if invite.usedByUsername == nil {
                                Button("删除", systemImage: "trash", role: .destructive) {
                                    pendingDeletion = invite
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .overlay { if isWorking { ProgressView() } }
            .navigationTitle("邀请码（\(total)）")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button("新建邀请码", systemImage: "plus") { Task { await create() } }
                        .disabled(isWorking)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let message {
                    Text(message).font(.caption).foregroundStyle(.red)
                        .padding(8).frame(maxWidth: .infinity).background(.bar)
                }
            }
            .task { await reload() }
            .confirmationDialog(
                "删除邀请码 \(pendingDeletion?.code ?? "")？",
                isPresented: Binding(
                    get: { pendingDeletion != nil },
                    set: { if !$0 { pendingDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("删除邀请码", role: .destructive) {
                    guard let invite = pendingDeletion else { return }
                    pendingDeletion = nil
                    Task { await delete(invite) }
                }
                Button("取消", role: .cancel) { pendingDeletion = nil }
            } message: {
                Text("未使用的邀请码删除后无法恢复。")
            }
        }
#if os(macOS)
        .frame(minWidth: 560, minHeight: 440)
#endif
    }

    @MainActor
    private func reload() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let page = try await AdminService(baseURL: baseURL).invites()
            invites = page.items
            total = page.total
            message = nil
        } catch {
            message = tkErrorDescription(error, fallback: "无法读取邀请码。")
        }
    }

    @MainActor
    private func create() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let code = try await AdminService(baseURL: baseURL).createInvite()
            message = nil
            let page = try await AdminService(baseURL: baseURL).invites()
            invites = page.items
            total = page.total
            if !invites.contains(where: { $0.code == code }) {
                invites.insert(InviteCode(code: code, createdAt: "", usedByUsername: nil, usedAt: nil), at: 0)
            }
        } catch {
            message = tkErrorDescription(error, fallback: "无法创建邀请码。")
        }
    }

    @MainActor
    private func delete(_ invite: InviteCode) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await AdminService(baseURL: baseURL).deleteInvite(code: invite.code)
            invites.removeAll { $0.code == invite.code }
            total = max(0, total - 1)
            message = nil
        } catch {
            message = tkErrorDescription(error, fallback: "无法删除邀请码。")
        }
    }
}

private extension WishlistPriority {
    var label: String {
        let key = switch self { case .high: "高"; case .medium: "中"; case .low: "低" }
        return tkLocalized(key)
    }
    var symbol: String { switch self { case .high: "exclamationmark.circle.fill"; case .medium: "circle.fill"; case .low: "arrow.down.circle.fill" } }
    var tint: Color { switch self { case .high: .red; case .medium: .orange; case .low: .secondary } }
}

private extension ReadingStatus {
    var label: String {
        let key = switch self { case .unread: "未读"; case .reading: "在读"; case .read: "读完" }
        return tkLocalized(key)
    }
    var symbol: String { switch self { case .unread: "book.closed.fill"; case .reading: "book.pages.fill"; case .read: "checkmark" } }
    var tint: Color { switch self { case .unread: .gray; case .reading: .orange; case .read: .green } }
}

private func copyToPasteboard(_ value: String) {
#if os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
#elseif os(iOS)
    UIPasteboard.general.string = value
#endif
}

@MainActor
private func pasteboardString() -> String? {
#if os(macOS)
    let value = NSPasteboard.general.string(forType: .string)
#elseif os(iOS)
    let value = UIPasteboard.general.string
#else
    let value: String? = nil
#endif
    return value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
}

private extension PriceChannel {
    var label: String {
        let key = switch self { case .jd: "京东"; case .bookschina: "中图网"; case .dangdang: "当当" }
        return tkLocalized(key)
    }
}

private extension PriceQuoteStatus {
    var label: String {
        switch self {
        case .ok: tkLocalized("已获取")
        case .needsLogin: tkLocalized("需登录")
        case .blocked: tkLocalized("已阻止")
        case .notFound: tkLocalized("未找到")
        case .error: tkLocalized("失败")
        }
    }
}

private struct LegacyMigrationView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var isChoosingSource = false
    @State private var isImporting = false
    @State private var summary: LegacyMigrationSummary?
    @State private var errorMessage: String?

    private let service = LegacyImportService()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("迁移 TomeKeep 数据", systemImage: "externaldrive.badge.plus")
                        .font(.largeTitle.bold())
                    Text("只读迁移包，将书库、愿望单、档案、阅读状态、价格记录和本地封面复制到这台设备。来源数据不会被修改。")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 680, alignment: .leading)
                }

                GroupBox {
                    VStack(alignment: .leading, spacing: 14) {
                        migrationDetail(tkLocalized("输入"), value: tkLocalized("包含 db.json 与 covers 文件夹的迁移目录"))
                        migrationDetail(tkLocalized("写入"), value: tkLocalized("原生 SwiftData 与独立 Covers 目录"))
                        migrationDetail(tkLocalized("保证"), value: tkLocalized("稳定 ID、幂等导入、SHA-256 校验、逐记录报告"))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                } label: {
                    Label("迁移范围", systemImage: "checklist")
                }

                if let summary {
                    migrationResult(summary)
                }

                HStack(spacing: 12) {
                    if stagedSourceURL != nil {
                        Button {
                            if let stagedSourceURL { Task { await importLegacyData(from: stagedSourceURL) } }
                        } label: {
                            Label("导入已传输的数据", systemImage: "iphone.and.arrow.forward")
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(isImporting)
                    }

                    Button {
                        isChoosingSource = true
                    } label: {
                        Label(tkLocalized(stagedSourceURL == nil && summary == nil ? "选择迁移目录" : "选择其他目录"), systemImage: "folder")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(isImporting)

                    if isImporting {
                        ProgressView()
                            .controlSize(.small)
                        Text("正在校验记录与复制封面…")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(platformPadding)
            .frame(maxWidth: 840, alignment: .leading)
        }
        .navigationTitle("数据迁移")
        .fileImporter(
            isPresented: $isChoosingSource,
            allowedContentTypes: [.folder, .json],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case let .success(urls):
                guard let url = urls.first else { return }
                Task { await importLegacyData(from: url) }
            case let .failure(error):
                errorMessage = error.localizedDescription
            }
        }
        .alert("迁移未完成", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(errorMessage ?? tkLocalized("未知错误"))
        }
        .task { loadPreviousMigrationReport() }
    }

    private var platformPadding: CGFloat {
#if os(iOS)
        20
#else
        36
#endif
    }

    private var stagedSourceURL: URL? {
        guard let url = try? NativeStorageLocations.stagedLegacyImport(),
              FileManager.default.fileExists(atPath: url.appending(path: "db.json").path)
        else { return nil }
        return url
    }

    @ViewBuilder
    private func migrationDetail(_ label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 54, alignment: .trailing)
            Text(value)
        }
    }

    @ViewBuilder
    private func migrationResult(_ summary: LegacyMigrationSummary) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                Label("迁移校验通过", systemImage: "checkmark.seal.fill")
                    .font(.title2.bold())
                    .foregroundStyle(.green)
                Text("\(summary.books) 本藏书 · \(summary.wishlist) 项愿望 · \(summary.profiles) 个档案 · \(summary.readingStates) 条阅读状态 · \(summary.covers) 张封面")
                    .font(.headline)
                Text("报告：\(summary.reportURL.path)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                if summary.warningCount > 0 {
                    Label("报告中包含 \(summary.warningCount) 条兼容性说明。", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(6)
        }
    }

    private func importLegacyData(from sourceURL: URL) async {
        isImporting = true
        defer { isImporting = false }
        let accessed = sourceURL.startAccessingSecurityScopedResource()
        defer { if accessed { sourceURL.stopAccessingSecurityScopedResource() } }

        do {
            let coversURL = try NativeStorageLocations.covers()
            let reportsURL = try NativeStorageLocations.migrationReports()
            let preparation = try await service.prepare(
                sourceURL: sourceURL,
                destinationCoversURL: coversURL
            )
            let repository = LibraryArchiveRepository(context: modelContext)
            let counts = try repository.importArchive(
                preparation.archive,
                sourceHash: preparation.sourceDatabaseSHA256,
                reportURL: nil
            )
            let destinationCounts = LegacyArchiveCounts(
                books: counts.books,
                wishlist: counts.wishlist,
                profiles: counts.profiles,
                readingStates: counts.readingStates,
                priceCacheEntries: counts.priceCacheEntries,
                covers: preparation.coverDigests.count
            )
            let reportURL = try await service.writeReport(
                preparation: preparation,
                destinationCounts: destinationCounts,
                reportsDirectory: reportsURL
            )
            try repository.recordImportReportURL(reportURL)
            summary = LegacyMigrationSummary(
                books: preparation.normalizedCounts.books,
                wishlist: preparation.normalizedCounts.wishlist,
                profiles: preparation.normalizedCounts.profiles,
                readingStates: preparation.normalizedCounts.readingStates,
                covers: preparation.normalizedCounts.covers,
                warningCount: preparation.warnings.count,
                reportURL: reportURL
            )
            NotificationCenter.default.post(name: TomeKeepAppNotification.syncCompleted, object: nil)
            requestTomeKeepSync()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadPreviousMigrationReport() {
        do {
            guard let reportURL = try LibraryArchiveRepository(context: modelContext).lastImportReportURL(),
                  let data = try? Data(contentsOf: reportURL),
                  let report = try? JSONDecoder().decode(LegacyImportReport.self, from: data)
            else { return }
            summary = LegacyMigrationSummary(
                books: report.destinationCounts.books,
                wishlist: report.destinationCounts.wishlist,
                profiles: report.destinationCounts.profiles,
                readingStates: report.destinationCounts.readingStates,
                covers: report.destinationCounts.covers,
                warningCount: report.warnings.count,
                reportURL: reportURL
            )
        } catch {
            errorMessage = tkLocalized("无法读取上次迁移报告。")
        }
    }
}

private struct LegacyMigrationSummary {
    var books: Int
    var wishlist: Int
    var profiles: Int
    var readingStates: Int
    var covers: Int
    var warningCount: Int
    var reportURL: URL
}

private struct BookDraft {
    var title = ""
    var author = ""
    var isbn = ""
    var publisher = ""
    var tagsText = ""
    var coverURL: URL?
    var coverFileName: String?
    var detailURL: URL?

    init(book: Book?) {
        guard let book else { return }
        title = book.title
        author = book.author
        isbn = book.isbn ?? ""
        publisher = book.publisher ?? ""
        tagsText = book.tags.joined(separator: "，")
        coverURL = book.coverURL
        coverFileName = book.coverFileName
        detailURL = book.detailURL
    }

    var tags: [String] {
        tagsText
            .split(whereSeparator: { ",，、".contains($0) })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

private struct BookEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: BookDraft
    @State private var validationMessage: String?
    @State private var isLookingUp = false
    @State private var lookupMessage: String?
    @State private var verificationTarget: WebsiteVerificationTarget?
    @State private var candidates: [BookMetadata] = []
    @State private var isShowingCandidates = false
    @State private var didInspectPasteboard = false
#if os(iOS)
    @State private var isPresentingScanner = false
#endif

    let book: Book?
    let onSave: (BookDraft) -> String?

    init(book: Book?, onSave: @escaping (BookDraft) -> String?) {
        self.book = book
        self.onSave = onSave
        _draft = State(initialValue: BookDraft(book: book))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    if book == nil {
                        Button {
                            Task { await importFromPasteboard() }
                        } label: {
                            Label(tkLocalized("从剪贴板导入"), systemImage: "doc.on.clipboard")
                        }
                        .disabled(isLookingUp)
                    }
                    TextField("书名", text: $draft.title)
                        .textContentType(.name)
                        .accessibilityIdentifier("book.title")
                    TextField("作者", text: $draft.author)
                        .accessibilityIdentifier("book.author")
                    TextField("出版社", text: $draft.publisher)
                        .accessibilityIdentifier("book.publisher")
                    Button("按书名关联豆瓣", systemImage: "link.badge.plus") {
                        Task { await searchDouban() }
                    }
                    .disabled(isLookingUp || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Section {
                    HStack {
                        TextField("ISBN-10 或 ISBN-13", text: $draft.isbn)
#if os(iOS)
                        .keyboardType(.asciiCapable)
                        .textInputAutocapitalization(.characters)
#endif
                        .accessibilityIdentifier("book.isbn")
                        Button {
                            Task { await fillMetadata() }
                        } label: {
                            if isLookingUp { ProgressView().controlSize(.small) }
                            else { Label("查询资料", systemImage: "sparkle.magnifyingglass") }
                        }
                        .disabled(isLookingUp || draft.isbn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
#if os(iOS)
                        Button("扫描 ISBN", systemImage: "barcode.viewfinder") {
                            isPresentingScanner = true
                        }
                        .labelStyle(.iconOnly)
#endif
                    }
                    Text("保存时会校验并统一转换为 ISBN-13。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let lookupMessage {
                        Label(lookupMessage, systemImage: draft.coverURL == nil ? "info.circle" : "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(draft.coverURL == nil ? Color.secondary : Color.green)
                    }
                } header: {
                    Text("ISBN")
                }

                Section("标签") {
                    TextField("用逗号分隔，例如：文学，已签名", text: $draft.tagsText)
                        .accessibilityIdentifier("book.tags")
                }

                if let validationMessage {
                    Section {
                        Label(validationMessage, systemImage: "exclamationmark.circle")
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("book.validation")
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(tkLocalized(book == nil ? "添加书籍" : "编辑书籍"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        validationMessage = onSave(draft)
                        if validationMessage == nil { dismiss() }
                    }
                    .fontWeight(.semibold)
                    .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("book.save")
                }
            }
        }
        .task { await inspectPasteboardOnAdd() }
#if os(iOS)
        .sheet(isPresented: $isPresentingScanner) {
            ISBNScannerView { value in
                draft.isbn = value
                isPresentingScanner = false
                Task { await fillMetadata() }
            }
        }
#endif
        .sheet(item: $verificationTarget, onDismiss: {
            Task { await fillMetadata(showVerification: false) }
        }) { target in
            WebsiteVerificationView(url: target.url)
        }
        .sheet(isPresented: $isShowingCandidates) {
            MetadataCandidatePicker(candidates: candidates) { apply($0) }
        }
    }

    @MainActor
    private func inspectPasteboardOnAdd() async {
        guard book == nil, !didInspectPasteboard else { return }
        didInspectPasteboard = true
#if os(macOS)
        guard let text = pasteboardString(),
              case .doubanURL = parseClipboardBookSeed(text)
        else { return }
        await importClipboardText(text)
#endif
    }

    @MainActor
    private func importFromPasteboard() async {
        guard let text = pasteboardString() else {
            lookupMessage = tkLocalized("剪贴板为空。")
            return
        }
        await importClipboardText(text)
    }

    @MainActor
    private func importClipboardText(_ text: String) async {
        guard let seed = parseClipboardBookSeed(text) else {
            lookupMessage = tkLocalized("剪贴板为空。")
            return
        }
        switch seed {
        case .doubanURL(let url):
            isLookingUp = true
            lookupMessage = tkLocalized("正在从剪贴板导入…")
            defer { isLookingUp = false }
            do {
                let result = try await MetadataLookupService().lookupDoubanURL(url)
                apply(result.metadata)
                lookupMessage = tkLocalized("已从剪贴板解析豆瓣链接。")
            } catch {
                lookupMessage = tkErrorDescription(error, fallback: "豆瓣链接解析失败，仍可手工录入。")
            }
        case .isbn13(let isbn):
            draft.isbn = isbn
            await fillMetadata()
        case .title(let title):
            draft.title = title
            lookupMessage = tkLocalized("已从剪贴板填入书名。")
        }
    }

    @MainActor
    private func fillMetadata(showVerification: Bool = true) async {
        isLookingUp = true
        lookupMessage = nil
        defer { isLookingUp = false }
        do {
            let result = try await MetadataLookupService().lookupISBN(draft.isbn)
            if let value = result.metadata.title { draft.title = value }
            if let value = result.metadata.author { draft.author = value }
            if let value = result.metadata.publisher { draft.publisher = value }
            if let value = result.metadata.isbn13 { draft.isbn = value }
            draft.coverURL = result.metadata.coverURL
            draft.detailURL = result.metadata.detailURL
            lookupMessage = tkLocalizedFormat("已从 %@ 填充资料", tkLocalized(result.source.label))
        } catch MetadataLookupError.verificationRequired(let url) {
            if showVerification { verificationTarget = WebsiteVerificationTarget(url: url) }
            lookupMessage = showVerification
                ? tkLocalized("请完成网页验证；关闭窗口后会自动重试")
                : tkLocalized("验证尚未生效，可再次打开网页或手工录入")
        } catch {
            lookupMessage = tkErrorDescription(error, fallback: "查询失败，仍可手工录入")
        }
    }

    @MainActor
    private func searchDouban() async {
        isLookingUp = true
        lookupMessage = nil
        defer { isLookingUp = false }
        do {
            candidates = try await MetadataLookupService().searchDouban(title: draft.title, author: draft.author.nilIfBlank)
            isShowingCandidates = true
        } catch {
            lookupMessage = tkErrorDescription(error, fallback: "豆瓣搜索失败，仍可手工录入")
        }
    }

    private func apply(_ metadata: BookMetadata) {
        if let value = metadata.title { draft.title = value }
        if let value = metadata.author { draft.author = value }
        if let value = metadata.publisher { draft.publisher = value }
        if let value = metadata.isbn13 { draft.isbn = value }
        draft.coverURL = metadata.coverURL
        draft.detailURL = metadata.detailURL
        lookupMessage = tkLocalized("已关联豆瓣候选，可继续编辑")
    }
}

private struct MetadataCandidatePicker: View {
    @Environment(\.dismiss) private var dismiss
    let candidates: [BookMetadata]
    let onSelect: (BookMetadata) -> Void

    var body: some View {
        NavigationStack {
            List(Array(candidates.enumerated()), id: \.offset) { _, metadata in
                Button {
                    onSelect(metadata)
                    dismiss()
                } label: {
                    HStack(spacing: 14) {
                        AsyncImage(url: metadata.coverURL) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Image(systemName: "book.closed").foregroundStyle(.secondary)
                        }
                        .frame(width: 48, height: 68)
                        .background(.quaternary)
                        .clipShape(.rect(cornerRadius: 5))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(metadata.title ?? tkLocalized("未命名")).font(.headline)
                            if let author = metadata.author { Text(author).foregroundStyle(.secondary) }
                            if let publisher = metadata.publisher { Text(publisher).font(.caption).foregroundStyle(.tertiary) }
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            .navigationTitle("选择豆瓣条目")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
#if os(macOS)
        .frame(minWidth: 620, minHeight: 460)
#endif
    }
}

private extension MetadataSource {
    var label: String {
        switch self {
        case .douban: "豆瓣"
        case .openLibrary: "OpenLibrary"
        case .isbnSearch: "isbnsearch"
        }
    }
}

private struct WebsiteVerificationTarget: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private func encodeStoredTags(_ tags: Set<String>) -> String {
    tags.sorted().joined(separator: "\u{1F}")
}

private func decodeStoredTags(_ value: String) -> Set<String> {
    Set(value.split(separator: "\u{1F}").map(String.init).filter { !$0.isEmpty })
}
