import Foundation
import UserNotifications

/// Owns the WebSocket link to the relay and all observable UI state.
final class RelayStore: NSObject, ObservableObject {
    @Published var conn: ConnState = .disconnected
    @Published var state = AppState()
    @Published var feed: [FeedEvent] = []
    @Published var approvals: [Approval] = []
    @Published var hasCreds = false

    private lazy var session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?
    private var baseURL = ""
    private var token = ""
    private var shouldRun = false
    private var backoff: Double = 1.0
    private var liveAssistantId: String?

    override init() {
        super.init()
        hasCreds = UserDefaults.standard.string(forKey: "token") != nil
    }

    var savedURL: String { UserDefaults.standard.string(forKey: "url") ?? "" }

    // MARK: connection

    func autoConnect() {
        if let u = UserDefaults.standard.string(forKey: "url"),
           let t = UserDefaults.standard.string(forKey: "token") {
            connect(url: u, token: t)
        }
    }

    func saveAndConnect(url: String, token: String) {
        let u = trimmedURL(url)
        let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(u, forKey: "url")
        UserDefaults.standard.set(t, forKey: "token")
        DispatchQueue.main.async { self.hasCreds = true }
        connect(url: u, token: t)
    }

    func forget() {
        shouldRun = false
        task?.cancel(with: .goingAway, reason: nil)
        UserDefaults.standard.removeObject(forKey: "url")
        UserDefaults.standard.removeObject(forKey: "token")
        DispatchQueue.main.async {
            self.hasCreds = false
            self.feed = []
            self.approvals = []
            self.state = AppState()
        }
    }

    private func connect(url: String, token: String) {
        baseURL = trimmedURL(url)
        self.token = token
        shouldRun = true
        backoff = 1.0
        open()
    }

    private func open() {
        guard shouldRun, let url = URL(string: wsURL()) else { return }
        setConn(.connecting)
        let t = session.webSocketTask(with: url)
        task = t
        t.resume()
        receive()
    }

    private func wsURL() -> String {
        var b = baseURL
        if b.hasPrefix("https") { b = "wss" + b.dropFirst(5) }
        else if b.hasPrefix("http") { b = "ws" + b.dropFirst(4) }
        return "\(b)/ws?token=\(token)"
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                self.setConn(.disconnected)
                self.scheduleReconnect()
            case .success(let msg):
                switch msg {
                case .string(let s): self.handle(s)
                case .data(let d): if let s = String(data: d, encoding: .utf8) { self.handle(s) }
                @unknown default: break
                }
                if self.conn != .connected { self.setConn(.connected); self.backoff = 1.0 }
                self.receive()
            }
        }
    }

    private func scheduleReconnect() {
        guard shouldRun else { return }
        let delay = backoff
        backoff = min(backoff * 1.6, 15.0)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.open() }
    }

    private func setConn(_ c: ConnState) {
        DispatchQueue.main.async { self.conn = c }
    }

    // MARK: actions (client -> server)

    func sendPrompt(_ text: String) { send(["type": "prompt", "text": text]) }
    func steer(_ text: String) { send(["type": "steer", "text": text]) }
    func interrupt() { send(["type": "interrupt"]) }
    func newThread(_ cwd: String?) {
        var m: [String: Any] = ["type": "newThread"]
        if let c = cwd, !c.isEmpty { m["cwd"] = c }
        send(m)
    }
    func setConfig(approvalPolicy: String?, sandbox: String?, cwd: String?) {
        var m: [String: Any] = ["type": "setConfig"]
        if let a = approvalPolicy { m["approvalPolicy"] = a }
        if let s = sandbox { m["sandbox"] = s }
        if let c = cwd, !c.isEmpty { m["cwd"] = c }
        send(m)
    }
    func resolveApproval(_ key: String, _ optionId: String) {
        send(["type": "approval", "key": key, "optionId": optionId])
        DispatchQueue.main.async { self.approvals.removeAll { $0.key == key } }
    }

    private func send(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let s = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }

    // MARK: inbound (server -> client)

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        DispatchQueue.main.async { self.apply(m) }
    }

    private func apply(_ m: [String: Any]) {
        switch m["type"] as? String {
        case "hello":
            applyState(m["state"] as? [String: Any])
            feed = parseEvents(m["recentEvents"] as? [[String: Any]])
            approvals = parseApprovals(m["pendingApprovals"] as? [[String: Any]])
            liveAssistantId = nil
        case "state":
            applyState(m["state"] as? [String: Any])
        case "event":
            if let e = parseEvent(m["event"] as? [String: Any]) { addEvent(e) }
        case "assistantDelta":
            appendAssistant(m["text"] as? String ?? "")
        case "approval":
            if let a = parseApproval(m["approval"] as? [String: Any]) {
                approvals.insert(a, at: 0)
                Self.notifyApproval(a)
            }
        case "approvalResolved":
            if let key = m["key"] as? String { approvals.removeAll { $0.key == key } }
        case "error":
            addEvent(FeedEvent(id: UUID().uuidString, ts: now(), kind: "error", text: m["message"] as? String ?? ""))
        default:
            break
        }
    }

    private func addEvent(_ e: FeedEvent) {
        if e.kind == "item:agentMessage", let id = liveAssistantId,
           let idx = feed.firstIndex(where: { $0.id == id }) {
            feed[idx].text = e.text
            liveAssistantId = nil
            return
        }
        feed.append(e)
        if feed.count > 400 { feed.removeFirst(feed.count - 400) }
    }

    private func appendAssistant(_ delta: String) {
        if let id = liveAssistantId, let idx = feed.firstIndex(where: { $0.id == id }) {
            feed[idx].text += delta
        } else {
            let e = FeedEvent(id: UUID().uuidString, ts: now(), kind: "item:agentMessage", text: delta)
            liveAssistantId = e.id
            feed.append(e)
        }
    }

    private func applyState(_ s: [String: Any]?) {
        guard let s else { return }
        state = AppState(
            codexConnected: s["codexConnected"] as? Bool ?? false,
            codexVersion: s["codexVersion"] as? String,
            threadId: s["threadId"] as? String,
            turnId: s["turnId"] as? String,
            cwd: s["cwd"] as? String ?? "—",
            status: s["status"] as? String ?? "idle",
            model: s["model"] as? String,
            approvalPolicy: s["approvalPolicy"] as? String ?? "",
            sandbox: s["sandbox"] as? String ?? ""
        )
    }

    private func parseEvents(_ arr: [[String: Any]]?) -> [FeedEvent] {
        (arr ?? []).compactMap { parseEvent($0) }
    }
    private func parseEvent(_ e: [String: Any]?) -> FeedEvent? {
        guard let e else { return nil }
        return FeedEvent(
            id: e["id"] as? String ?? UUID().uuidString,
            ts: (e["ts"] as? NSNumber)?.doubleValue ?? now(),
            kind: e["kind"] as? String ?? "",
            text: e["text"] as? String ?? ""
        )
    }
    private func parseApprovals(_ arr: [[String: Any]]?) -> [Approval] {
        (arr ?? []).compactMap { parseApproval($0) }
    }
    private func parseApproval(_ a: [String: Any]?) -> Approval? {
        guard let a else { return nil }
        let opts = (a["options"] as? [[String: Any]] ?? []).map {
            ApprovalOption(id: $0["id"] as? String ?? "",
                           label: $0["label"] as? String ?? "",
                           style: $0["style"] as? String ?? "secondary")
        }
        return Approval(
            key: a["key"] as? String ?? UUID().uuidString,
            kind: a["kind"] as? String ?? "",
            title: a["title"] as? String ?? "",
            command: a["command"] as? String ?? "",
            cwd: a["cwd"] as? String,
            reason: a["reason"] as? String,
            note: a["note"] as? String,
            options: opts
        )
    }

    private func now() -> Double { Date().timeIntervalSince1970 * 1000 }
    private func trimmedURL(_ s: String) -> String {
        var u = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        return u
    }

    // MARK: notifications

    static func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }
    static func notifyApproval(_ a: Approval) {
        let c = UNMutableNotificationContent()
        c.title = "Codex 需要审批：\(a.title)"
        c.body = a.command
        c.sound = .default
        let req = UNNotificationRequest(identifier: a.key, content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
