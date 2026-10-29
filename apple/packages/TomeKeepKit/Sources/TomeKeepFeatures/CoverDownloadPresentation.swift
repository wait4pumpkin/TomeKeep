import SwiftUI
import TomeKeepSync

private struct CoverViewportBoundsKey: EnvironmentKey {
    static let defaultValue: CGRect = .zero
}

private extension EnvironmentValues {
    var coverViewportBounds: CGRect {
        get { self[CoverViewportBoundsKey.self] }
        set { self[CoverViewportBoundsKey.self] = newValue }
    }
}

/// Uses the content area, excluding the toolbar/tab bar, rather than lazy prefetch appearances.
struct CoverDownloadViewport: ViewModifier {
    func body(content: Content) -> some View {
        GeometryReader { proxy in
            content.environment(\.coverViewportBounds, proxy.frame(in: .global))
        }
    }
}

struct CoverDownloadListOrder: ViewModifier {
    @Environment(NativeSyncCoordinator.self) private var sync
    let collection: CoverCollection
    let ids: [String]

    func body(content: Content) -> some View {
        content.onChange(of: ids, initial: true) { _, ids in
            sync.coverPriority.setOrder(ids, for: collection)
        }
    }
}

struct CoverDownloadVisibility: ViewModifier {
    @Environment(NativeSyncCoordinator.self) private var sync
    @Environment(\.coverViewportBounds) private var viewport
    let collection: CoverCollection
    let id: String

    func body(content: Content) -> some View {
        content.onGeometryChange(for: Bool.self) { [viewport] proxy in
            let frame = proxy.frame(in: .global)
            return !viewport.isEmpty && !frame.isEmpty && frame.intersects(viewport)
        } action: { visible in
            sync.coverPriority.setVisible(visible, id: id, in: collection)
        }
        .onDisappear { sync.coverPriority.setVisible(false, id: id, in: collection) }
    }
}
