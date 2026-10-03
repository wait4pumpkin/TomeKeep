import SwiftUI
import SwiftData
import TomeKeepFeatures
import TomeKeepPersistence

@main
struct TomeKeepIOSApp: App {
    private let modelContainer: ModelContainer

    init() {
        do {
            let storeURL = try NativeStorageLocations.root().appending(path: "TomeKeep.store")
            modelContainer = try PersistenceConfiguration.makeContainer(url: storeURL)
        } catch {
            fatalError("Unable to initialize TomeKeep persistence: \(error.localizedDescription)")
        }
    }

    var body: some Scene {
        WindowGroup {
            NativeMigrationRootView(platform: .iOS)
        }
        .modelContainer(modelContainer)
    }
}
