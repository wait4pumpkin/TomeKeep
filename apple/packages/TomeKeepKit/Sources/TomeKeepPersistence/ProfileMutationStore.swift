import Foundation

public enum ProfileMutationKind: String, Codable, Sendable {
    case upsert
    case delete
}

public struct ProfileMutation: Identifiable, Codable, Equatable, Sendable {
    public var id: String { profileID }
    public var profileID: String
    public var kind: ProfileMutationKind
    public var name: String?
    public var accountID: String?
    public var updatedAt: Date

    public init(
        profileID: String,
        kind: ProfileMutationKind,
        name: String?,
        accountID: String?,
        updatedAt: Date
    ) {
        self.profileID = profileID
        self.kind = kind
        self.name = name
        self.accountID = accountID
        self.updatedAt = updatedAt
    }
}

public enum ProfileAccountContext {
    private static let key = "tomekeep.currentAccountID"

    public static var currentID: String? {
        get { UserDefaults.standard.string(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}

/// A tiny durable outbox kept outside the SwiftData schema so profile delete
/// tombstones can be added without risking the already-imported V1 store.
/// Entries are account-scoped as soon as a session is known.
public struct ProfileMutationStore: Sendable {
    private let fileURL: URL

    public init(fileURL: URL? = nil) throws {
        self.fileURL = try fileURL ?? NativeStorageLocations.root().appending(path: "ProfileMutations.json")
    }

    public func record(
        profileID: String,
        kind: ProfileMutationKind,
        name: String?,
        accountID: String? = ProfileAccountContext.currentID,
        at instant: Date = .now
    ) throws {
        var mutations = try load()
        mutations.removeAll { $0.profileID == profileID && $0.accountID == accountID }
        mutations.append(ProfileMutation(
            profileID: profileID,
            kind: kind,
            name: name,
            accountID: accountID,
            updatedAt: instant
        ))
        try save(mutations)
    }

    public func pending(accountID: String) throws -> [ProfileMutation] {
        var mutations = try load()
        var changed = false
        for index in mutations.indices where mutations[index].accountID == nil {
            mutations[index].accountID = accountID
            changed = true
        }
        if changed { try save(mutations) }
        return mutations.filter { $0.accountID == accountID }.sorted { $0.updatedAt < $1.updatedAt }
    }

    public func remove(profileID: String, accountID: String) throws {
        var mutations = try load()
        mutations.removeAll { $0.profileID == profileID && $0.accountID == accountID }
        try save(mutations)
    }

    private func load() throws -> [ProfileMutation] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        return try JSONDecoder().decode([ProfileMutation].self, from: Data(contentsOf: fileURL))
    }

    private func save(_ mutations: [ProfileMutation]) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder().encode(mutations).write(to: fileURL, options: [.atomic])
    }
}
