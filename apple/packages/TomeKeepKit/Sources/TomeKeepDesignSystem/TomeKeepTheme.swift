import SwiftUI
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

public enum TomeKeepTheme {
    public static let coverCornerRadius: CGFloat = 10
    public static let contentSpacing: CGFloat = 16
}

public struct TomeKeepCoverPlaceholder: View {
    public init() {}

    public var body: some View {
        RoundedRectangle(cornerRadius: TomeKeepTheme.coverCornerRadius)
            .fill(.quaternary)
            .overlay {
                Image(systemName: "book.closed")
                    .font(.title)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .accessibilityLabel("暂无封面")
    }
}

public struct TomeKeepBookCover: View {
    private let fileURL: URL?
    @State private var image: Image?
#if os(macOS)
    @MainActor private static let imageCache: NSCache<NSURL, NSImage> = {
        let cache = NSCache<NSURL, NSImage>()
        cache.countLimit = 180
        return cache
    }()
#endif

    public init(fileURL: URL?) {
        self.fileURL = fileURL
    }

    public var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: TomeKeepTheme.coverCornerRadius)
                .fill(.quaternary.opacity(0.55))
            if let image {
                image
                    .resizable()
                    .scaledToFit()
                    .padding(2)
                    .accessibilityLabel("书籍封面")
            } else {
                TomeKeepCoverPlaceholder()
            }
        }
        .clipShape(.rect(cornerRadius: TomeKeepTheme.coverCornerRadius))
        .task(id: fileURL) {
            image = fileURL.flatMap(Self.loadImage)
        }
    }

    @MainActor
    private static func loadImage(from url: URL) -> Image? {
#if os(macOS)
        if let cached = imageCache.object(forKey: url as NSURL) {
            return Image(nsImage: cached)
        }
        guard let nativeImage = NSImage(contentsOf: url) else { return nil }
        imageCache.setObject(nativeImage, forKey: url as NSURL)
        return Image(nsImage: nativeImage)
#elseif os(iOS)
        guard let nativeImage = UIImage(contentsOfFile: url.path) else { return nil }
        return Image(uiImage: nativeImage)
#else
        return nil
#endif
    }
}
