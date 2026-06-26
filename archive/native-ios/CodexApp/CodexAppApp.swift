import SwiftUI

@main
struct CodexAppApp: App {
    @StateObject private var store = RelayStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onAppear {
                    RelayStore.requestNotifications()
                    store.autoConnect()
                }
        }
    }
}
