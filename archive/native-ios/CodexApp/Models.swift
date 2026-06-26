import Foundation

// Mirrors PROTOCOL.md. Parsed from [String: Any] for simplicity.

enum ConnState { case disconnected, connecting, connected }

struct AppState {
    var codexConnected = false
    var codexVersion: String? = nil
    var threadId: String? = nil
    var turnId: String? = nil
    var cwd = "—"
    var status = "idle"          // "idle" | "running"
    var model: String? = nil
    var approvalPolicy = ""
    var sandbox = ""
}

struct FeedEvent: Identifiable {
    let id: String
    let ts: Double
    let kind: String
    var text: String
}

struct ApprovalOption: Identifiable {
    var id: String
    let label: String
    let style: String            // "primary" | "secondary" | "danger"
}

struct Approval: Identifiable {
    var id: String { key }
    let key: String
    let kind: String
    let title: String
    let command: String
    let cwd: String?
    let reason: String?
    let note: String?
    let options: [ApprovalOption]
}
