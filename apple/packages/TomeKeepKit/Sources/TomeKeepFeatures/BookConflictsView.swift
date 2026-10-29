import SwiftUI
import SwiftData
import TomeKeepDomain
import TomeKeepPersistence
import TomeKeepDesignSystem

struct BookConflictsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @State private var entries: [BookIdentityConflict] = []
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            if entries.isEmpty && error == nil {
                ContentUnavailableView(tkLocalized("没有待处理的书籍冲突"), systemImage: "checkmark.circle")
            }
            ForEach(entries) { entry in
                NavigationLink {
                    BookConflictDetailView(entry: entry)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.canonical.title).font(.headline)
                        Text(entry.canonical.isbn ?? "").font(.caption).foregroundStyle(.secondary)
                        if let message = entry.message { Text(tkLocalized(message)).font(.caption).foregroundStyle(.orange) }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle(tkLocalized("书籍冲突"))
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(tkLocalized("完成")) { dismiss() }
            }
        }
        .task { reload() }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.syncCompleted)) { _ in reload() }
        .onReceive(NotificationCenter.default.publisher(for: TomeKeepAppNotification.localCoversChanged)) { _ in reload() }
    }

    private func reload() {
        do {
            guard let accountID = ProfileAccountContext.currentID else { entries = []; return }
            entries = try BookConflictStore(accountID: accountID).entries().filter { !$0.completed }
        } catch { self.error = tkLocalized("无法读取书籍冲突记录。") }
    }
}

private struct BookConflictDetailView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    let entry: BookIdentityConflict
    @State private var choices: Set<String> = []
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Text(entry.canonical.title).font(.headline)
                Text(entry.canonical.isbn ?? "").foregroundStyle(.secondary)
                if let message = entry.message { Text(tkLocalized(message)).foregroundStyle(.orange) }
            }
            ForEach(entry.conflictingFields, id: \.self) { field in
                Section(fieldLabel(field)) {
                    if field == "cover" {
                        HStack {
                            cover(entry.local, label: tkLocalized("本机"))
                            cover(entry.canonical, label: tkLocalized("云端"))
                        }
                    } else {
                        LabeledContent(tkLocalized("本机"), value: value(field, from: entry.local, states: entry.localReading))
                        LabeledContent(tkLocalized("云端"), value: value(field, from: entry.canonical, states: entry.canonicalReading))
                    }
                    Picker(tkLocalized("保留内容"), selection: Binding(
                        get: { choices.contains(field) },
                        set: { if $0 { choices.insert(field) } else { choices.remove(field) } }
                    )) {
                        Text(tkLocalized("云端")).tag(false)
                        Text(tkLocalized("本机")).tag(true)
                    }
                    .pickerStyle(.segmented)
                }
            }
            Section(tkLocalized("标签")) { Text(entry.mergedBook().tags.joined(separator: " · ")) }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        .navigationTitle(tkLocalized("合并书籍"))
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(tkLocalized("确认合并")) { save() }
                    .disabled(entry.revision < 1 || entry.message == "两条记录均已存在于服务器，需要人工处理。")
            }
        }
        .task { choices = entry.localChoices ?? [] }
    }

    private func cover(_ book: Book, label: String) -> some View {
        let cached = try? LocalSyncRepository(context: context).book(id: book.id)
        let fileName = book.coverFileName ?? cached?.coverFileName
        let directory = try? NativeStorageLocations.covers()
        return VStack {
            TomeKeepBookCover(fileURL: fileName.flatMap { directory?.appending(path: $0) })
                .frame(maxWidth: .infinity).frame(height: 120)
            Text(label).font(.caption)
        }
    }

    private func fieldLabel(_ field: String) -> String {
        if field.hasPrefix("reading:") {
            let id = String(field.dropFirst("reading:".count))
            let name = (try? ProfileRepository(context: context).profiles().first { $0.id == id }?.name) ?? tkLocalized("阅读档案")
            return tkLocalized("阅读状态") + " · " + name
        }
        return tkLocalized(["title": "书名", "author": "作者", "publisher": "出版社", "detailURL": "打开关联页面", "cover": "封面", "rating": "评分"][field] ?? field)
    }

    private func value(_ field: String, from book: Book, states: [ReadingState]) -> String {
        switch field {
        case "title": return book.title
        case "author": return book.author
        case "publisher": return book.publisher ?? ""
        case "detailURL": return book.detailURL?.absoluteString ?? ""
        case "rating": return book.rating.map(String.init(describing:)) ?? ""
        default:
            let state = states.first { $0.profileID == String(field.dropFirst("reading:".count)) }
            let status = tkLocalized(state?.status == .read ? "已读" : state?.status == .reading ? "在读" : "未读")
            return [status, state?.completedAt?.formatted(date: .abbreviated, time: .omitted)].compactMap { $0 }.joined(separator: " · ")
        }
    }

    private func save() {
        do {
            guard let id = ProfileAccountContext.currentID else { return }
            try BookConflictStore(accountID: id).choose(id: entry.id, expected: entry, localFields: choices)
            requestTomeKeepSync()
            dismiss()
        } catch { self.error = tkLocalized("无法保存合并选择。") }
    }
}
