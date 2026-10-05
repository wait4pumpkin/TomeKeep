import SwiftUI
import SwiftData
import TomeKeepDomain
import TomeKeepPersistence

func compactTopControls(scrollOffset: CGFloat, wasCompact: Bool) -> Bool {
    // Separate thresholds keep the reduced header height from causing a feedback loop.
    wasCompact ? scrollOffset > 16 : scrollOffset > 80
}

func wishlistSortWithoutPriority(_ rawValue: String) -> String {
    rawValue == "priority" ? "recentlyAdded" : rawValue
}

func shouldBreatheReadingProgress(reduceMotion: Bool, isActive: Bool) -> Bool {
    !reduceMotion && isActive
}

struct ReadingProgressBreathing: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var pulse = false

    private var animates: Bool {
        shouldBreatheReadingProgress(reduceMotion: reduceMotion, isActive: scenePhase == .active)
    }

    func body(content: Content) -> some View {
        content
            .opacity(pulse ? 0.78 : 1)
            .task(id: animates) {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { pulse = false }
                guard animates else { return }
                // Brightness only: never animate the reading value or layout.
                withAnimation(.timingCurve(0.77, 0, 0.175, 1, duration: 1.6).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
    }
}

#if os(iOS)
struct IOSScrollDensityObserver: ViewModifier {
    @Binding var isCompact: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollGeometryChange(for: CGFloat.self) { geometry in
                max(0, geometry.contentOffset.y + geometry.contentInsets.top)
            } action: { _, offset in
                isCompact = compactTopControls(scrollOffset: offset, wasCompact: isCompact)
            }
        } else {
            content
        }
    }
}

struct IOSLibraryControlButton: View {
    let title: String
    let symbol: String
    var selected = false
    var count = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
                .foregroundStyle(selected ? Color.accentColor : Color.primary)
                .background(selected ? Color.accentColor.opacity(0.1) : Color.clear, in: .rect(cornerRadius: 10))
                .overlay(alignment: .topTrailing) {
                    if count > 0 {
                        Text("\(count)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(3)
                            .background(Color.accentColor, in: .circle)
                            .accessibilityHidden(true)
                    }
                }
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(count > 0 ? tkLocalizedFormat("%lld 个标签", count) : "")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ReadingProfileMenu: View {
    @Environment(\.modelContext) private var context
    let activeProfile: UserProfile
    @State private var profiles: [UserProfile] = []
    @State private var errorMessage: String?

    var body: some View {
        Menu {
            ForEach(profiles) { profile in
                Button {
                    do {
                        try ProfileRepository(context: context).setActiveProfile(id: profile.id)
                        NotificationCenter.default.post(name: TomeKeepAppNotification.activeProfileChanged, object: nil)
                    } catch {
                        errorMessage = tkLocalized("无法切换阅读档案。")
                    }
                } label: {
                    if profile.id == activeProfile.id {
                        Label(profile.name, systemImage: "checkmark")
                    } else {
                        Text(profile.name)
                    }
                }
            }
        } label: {
            Label(activeProfile.name, systemImage: "person.crop.circle")
                .lineLimit(1)
                .padding(.vertical, 6)
                .contentShape(.rect)
        }
        .accessibilityLabel(tkLocalized("切换阅读档案"))
        .accessibilityValue(activeProfile.name)
        .task { reload() }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in reload() }
        .alert(tkLocalized("无法完成操作"), isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) { Button(tkLocalized("好"), role: .cancel) {} } message: {
            Text(errorMessage ?? "")
        }
    }

    private func reload() {
        do { profiles = try ProfileRepository(context: context).profiles() }
        catch { errorMessage = tkLocalized("无法读取档案。") }
    }
}
#endif

struct SyncActivityIndicator: View {
    @Environment(NativeSyncCoordinator.self) private var coordinator

    var body: some View {
        Circle()
            .fill(coordinator.lastError != nil ? Color.orange : (coordinator.isSyncing ? Color.accentColor : Color.secondary))
            .frame(width: 7, height: 7)
            .accessibilityLabel(tkLocalized(coordinator.lastError != nil ? "同步失败" : (coordinator.isSyncing ? "同步中" : "同步空闲")))
    }
}
