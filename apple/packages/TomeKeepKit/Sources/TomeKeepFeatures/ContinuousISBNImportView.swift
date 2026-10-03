#if os(iOS)
import SwiftData
import SwiftUI
import TomeKeepDomain
import TomeKeepMetadata
import TomeKeepPersistence
import UIKit

private enum ContinuousImportState: Equatable {
    case waiting
    case lookingUp
    case imported
    case importedWithoutMetadata
    case duplicate
    case failed

    var symbol: String {
        switch self {
        case .waiting: "clock"
        case .lookingUp: "arrow.triangle.2.circlepath"
        case .imported: "checkmark.circle.fill"
        case .importedWithoutMetadata: "checkmark.circle"
        case .duplicate: "rectangle.on.rectangle.slash"
        case .failed: "exclamationmark.triangle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .waiting, .lookingUp: .secondary
        case .imported: .green
        case .importedWithoutMetadata: .orange
        case .duplicate: .secondary
        case .failed: .red
        }
    }
}

private struct ContinuousImportRecord: Identifiable, Equatable {
    let id = UUID()
    let isbn: String
    var title: String?
    var detail: String
    var state: ContinuousImportState
}

struct ContinuousISBNImportView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var permissionDenied = false
    @State private var detectedBounds: CGRect?
    @State private var records: [ContinuousImportRecord] = []
    @State private var queue: [UUID] = []
    @State private var existingISBNs: Set<String> = []
    @State private var isProcessing = false
    @State private var acceptsScans = true
    @State private var finishRequested = false

    let onFinished: () -> Void

    private let metadataService = MetadataLookupService()
    private let coverService = CoverCacheService()

    var body: some View {
        NavigationStack {
            ZStack {
                ISBNScannerCamera(
                    continuous: true,
                    onScanned: accept,
                    onDetectedBoundsChanged: { detectedBounds = $0 },
                    onPermissionDenied: { permissionDenied = true }
                )
                .ignoresSafeArea()

                ScannerTargetOverlay(detectedBounds: detectedBounds)

                VStack(spacing: 12) {
                    summaryPill
                    Spacer()
                    instructionPill
                    recentResults
                }
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 12)
            }
            .navigationTitle(Text(verbatim: tkLocalized("连续扫描")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(tkLocalized(finishRequested ? "正在完成…" : "完成")) { requestFinish() }
                        .fontWeight(.semibold)
                        .disabled(finishRequested)
                }
            }
        }
        .interactiveDismissDisabled(isProcessing)
        .onAppear(perform: loadExistingISBNs)
        .alert(tkLocalized("无法使用相机"), isPresented: $permissionDenied) {
            Button(tkLocalized("好"), role: .cancel) { finish() }
        } message: {
            Text(verbatim: tkLocalized("请在“设置”中允许 TomeKeep 使用相机，或返回书库手工录入 ISBN。"))
        }
    }

    private var summaryPill: some View {
        HStack(spacing: 12) {
            Label(tkLocalizedFormat("已识别 %lld", records.count), systemImage: "barcode.viewfinder")
            if isProcessing {
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
                Text(verbatim: tkLocalized("正在补全资料"))
            } else if importedCount > 0 {
                Label(tkLocalizedFormat("已录入 %lld", importedCount), systemImage: "checkmark")
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.black.opacity(0.62), in: .capsule)
        .accessibilityElement(children: .combine)
    }

    private var instructionPill: some View {
        Text(verbatim: tkLocalized(acceptsScans ? "对准条码；识别后可立即扫描下一本" : "正在完成剩余录入，请稍候"))
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(.black.opacity(0.62), in: .capsule)
    }

    @ViewBuilder
    private var recentResults: some View {
        if !records.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(records.suffix(3).reversed())) { record in
                    HStack(spacing: 10) {
                        Image(systemName: record.state.symbol)
                            .foregroundStyle(record.state.tint)
                            .symbolEffect(.pulse, isActive: record.state == .lookingUp && !reduceMotion)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.title ?? record.isbn)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            Text(record.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    if record.id != records.suffix(3).first?.id { Divider().padding(.leading, 44) }
                }
            }
            .background(.regularMaterial, in: .rect(cornerRadius: 16))
            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
        }
    }

    private var importedCount: Int {
        records.count { $0.state == .imported || $0.state == .importedWithoutMetadata }
    }

    private func loadExistingISBNs() {
        let books = (try? BookRepository(context: modelContext).books()) ?? []
        existingISBNs = Set(books.compactMap(\.isbn))
    }

    private func accept(_ isbn: String) {
        guard acceptsScans else { return }
        if existingISBNs.contains(isbn) {
            records.append(ContinuousImportRecord(
                isbn: isbn,
                title: nil,
                detail: tkLocalized("书库中已经存在"),
                state: .duplicate
            ))
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }

        existingISBNs.insert(isbn)
        let record = ContinuousImportRecord(
            isbn: isbn,
            title: nil,
            detail: tkLocalized("等待查询资料"),
            state: .waiting
        )
        records.append(record)
        queue.append(record.id)
        guard !isProcessing else { return }
        isProcessing = true
        Task { await drainQueue() }
    }

    @MainActor
    private func drainQueue() async {
        while let recordID = queue.first {
            queue.removeFirst()
            guard let index = records.firstIndex(where: { $0.id == recordID }) else { continue }
            records[index].state = .lookingUp
            records[index].detail = tkLocalized("正在查询豆瓣等资料来源")
            await importRecord(id: recordID)
        }
        isProcessing = false
        if finishRequested { finish() }
    }

    @MainActor
    private func importRecord(id: UUID) async {
        guard let initialIndex = records.firstIndex(where: { $0.id == id }) else { return }
        let isbn = records[initialIndex].isbn
        var metadata: BookMetadata?
        var metadataUnavailable = false
        do {
            metadata = try await metadataService.lookupISBN(isbn).metadata
        } catch {
            metadataUnavailable = true
        }

        let title = metadata?.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let author = metadata?.author?.trimmingCharacters(in: .whitespacesAndNewlines)
        let instant = Date.now
        let book = Book(
            id: UUID().uuidString.lowercased(),
            title: title.flatMap { $0.isEmpty ? nil : $0 } ?? "ISBN \(isbn)",
            author: author.flatMap { $0.isEmpty ? nil : $0 } ?? "",
            isbn: metadata?.isbn13 ?? isbn,
            publisher: metadata?.publisher,
            coverURL: metadata?.coverURL,
            detailURL: metadata?.detailURL,
            addedAt: instant,
            updatedAt: instant
        )

        do {
            try BookRepository(context: modelContext).add(book)
            updateRecord(id: id) { record in
                record.title = book.title
                record.state = metadataUnavailable ? .importedWithoutMetadata : .imported
                record.detail = tkLocalized(metadataUnavailable ? "已保存 ISBN，可稍后编辑补全" : "已录入书库")
            }
            if let coverURL = book.coverURL {
                cacheCover(for: book, from: coverURL)
            }
            requestTomeKeepSync()
        } catch BookRepositoryError.duplicateISBN {
            updateRecord(id: id) {
                $0.state = .duplicate
                $0.detail = tkLocalized("书库中已经存在")
            }
        } catch {
            existingISBNs.remove(isbn)
            updateRecord(id: id) {
                $0.state = .failed
                $0.detail = tkLocalized("保存失败，可重新扫描")
            }
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    private func updateRecord(id: UUID, update: (inout ContinuousImportRecord) -> Void) {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        update(&records[index])
    }

    private func cacheCover(for book: Book, from url: URL) {
        Task {
            guard let fileName = try? await coverService.cache(remoteURL: url, recordID: book.id) else { return }
            var updated = book
            updated.coverFileName = fileName
            updated.updatedAt = .now
            try? BookRepository(context: modelContext).update(updated)
            requestTomeKeepSync()
        }
    }

    private func requestFinish() {
        acceptsScans = false
        finishRequested = true
        if !isProcessing { finish() }
    }

    private func finish() {
        onFinished()
        dismiss()
    }
}
#endif
