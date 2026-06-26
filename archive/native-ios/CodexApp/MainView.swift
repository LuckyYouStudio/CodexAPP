import SwiftUI

struct MainView: View {
    @EnvironmentObject var store: RelayStore
    @State private var input = ""
    @State private var steerMode = false
    @State private var showSettings = false

    private var connected: Bool { store.conn == .connected && store.state.codexConnected }
    private var running: Bool { store.state.status == "running" }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().background(Color.line)

            if !store.approvals.isEmpty {
                VStack(spacing: 10) {
                    ForEach(store.approvals) { a in
                        ApprovalCardView(a: a) { opt in store.resolveApproval(a.key, opt) }
                    }
                }
                .padding(.horizontal, 12).padding(.top, 8)
            }

            feed
        }
        .background(Color.bg.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) { composer }
        .sheet(isPresented: $showSettings) { SettingsView().environmentObject(store) }
    }

    private var header: some View {
        VStack(spacing: 2) {
            HStack(spacing: 8) {
                Circle().fill(connected ? Color.accentGreen : Color.danger).frame(width: 10, height: 10)
                Text("CodexApp").font(.headline).foregroundColor(.textMain)
                Spacer()
                statusPill
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape.fill").foregroundColor(.textMain)
                }
            }
            HStack {
                Text(cwdLine).font(.caption2.monospaced()).foregroundColor(.muted)
                Spacer()
            }
        }
        .padding(.horizontal, 14).padding(.top, 6).padding(.bottom, 6)
        .background(Color.bg)
    }

    private var statusPill: some View {
        let label = store.conn != .connected ? connLabel : (running ? "运行中" : "空闲")
        return Text(label)
            .font(.caption).fontWeight(running ? .semibold : .regular)
            .foregroundColor(running ? .black : .muted)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(running ? Color.accentGreen : Color.clear)
            .overlay(Capsule().stroke(running ? Color.accentGreen : Color.line))
            .clipShape(Capsule())
    }

    private var feed: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(store.feed) { e in FeedRowView(e: e).id(e.id) }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
            .onChange(of: store.feed.count) { _ in
                if let last = store.feed.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            Divider().background(Color.line)
            if running {
                HStack {
                    Text("任务进行中…").font(.footnote).foregroundColor(.muted)
                    Spacer()
                    Button("停止") { store.interrupt() }.tint(.danger)
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("输入提示词，控制 Codex…", text: $input, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(1...5)
                Button("发送") { sendCurrent() }
                    .buttonStyle(.borderedProminent).tint(.accentGreen).foregroundColor(.black)
            }
            HStack {
                Toggle("纠偏模式（插话当前任务）", isOn: $steerMode)
                    .font(.footnote).tint(.accentGreen).foregroundColor(.muted)
            }
        }
        .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 8)
        .background(Color.bg)
    }

    private func sendCurrent() {
        let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        if steerMode { store.steer(t) } else { store.sendPrompt(t) }
        input = ""
    }

    private var connLabel: String {
        switch store.conn {
        case .connecting: return "连接中…"
        case .disconnected: return "已断开"
        case .connected: return "已连接"
        }
    }
    private var cwdLine: String {
        var parts = [store.state.cwd]
        if let m = store.state.model, !m.isEmpty { parts.append(m) }
        if !store.state.approvalPolicy.isEmpty { parts.append(store.state.approvalPolicy) }
        return parts.joined(separator: "  ·  ")
    }
}

struct FeedRowView: View {
    let e: FeedEvent
    var body: some View {
        switch e.kind {
        case "user":
            bubble(label: "你", bg: .surface2, alignEnd: true)
        case "item:agentMessage":
            bubble(label: "Codex", bg: .surface1)
        case let k where k.hasPrefix("item:commandExecution"):
            Text(e.text).font(.system(.footnote, design: .monospaced)).foregroundColor(.textMain)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.codeBg).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.line))
                .cornerRadius(10)
        case "error":
            Text(e.text).foregroundColor(.danger)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.danger))
        case "thread", "turn":
            Text(e.text).font(.footnote).foregroundColor(.muted).frame(maxWidth: .infinity)
        default:
            Text(e.text).foregroundColor(.textMain).font(.callout)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.surface1).cornerRadius(12)
        }
    }

    private func bubble(label: String, bg: Color, alignEnd: Bool = false) -> some View {
        HStack {
            if alignEnd { Spacer(minLength: 24) }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption2).foregroundColor(.muted)
                Text(e.text).foregroundColor(.textMain)
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(bg).cornerRadius(12)
            if !alignEnd { Spacer(minLength: 24) }
        }
    }
}

struct ApprovalCardView: View {
    let a: Approval
    let onChoose: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("⚠ \(a.title)").foregroundColor(.warn).bold()
            Text(a.command).font(.system(.footnote, design: .monospaced)).foregroundColor(.textMain)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.codeBg).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.line))
                .cornerRadius(8)
            if let c = a.cwd { Text("📁 \(c)").font(.caption).foregroundColor(.muted) }
            if let r = a.reason { Text("💬 \(r)").font(.caption).foregroundColor(.muted) }
            if let n = a.note { Text("⚠ \(n)").font(.caption).foregroundColor(.warn) }
            HStack(spacing: 8) {
                ForEach(a.options) { opt in
                    Button { onChoose(opt.id) } label: { Text(opt.label).frame(maxWidth: .infinity) }
                        .modifier(OptionButtonStyle(style: opt.style))
                }
            }
        }
        .padding(14)
        .background(Color.surface1)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.warn))
        .cornerRadius(14)
    }
}

private struct OptionButtonStyle: ViewModifier {
    let style: String
    func body(content: Content) -> some View {
        switch style {
        case "primary":
            content.buttonStyle(.borderedProminent).tint(.accentGreen).foregroundColor(.black)
        case "danger":
            content.buttonStyle(.bordered).tint(.danger)
        default:
            content.buttonStyle(.bordered).tint(.surface2)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var store: RelayStore
    @Environment(\.dismiss) var dismiss
    @State private var cwd = ""
    @State private var policy = "on-request"
    @State private var sandbox = "workspace-write"

    private let policies = ["on-request", "untrusted", "on-failure", "never"]
    private let sandboxes = ["workspace-write", "read-only", "danger-full-access"]

    var body: some View {
        NavigationView {
            Form {
                Section("工作目录 (cwd)") {
                    TextField("C:\\test", text: $cwd)
                        .textInputAutocapitalization(.never).disableAutocorrection(true)
                }
                Section("审批策略") {
                    Picker("策略", selection: $policy) { ForEach(policies, id: \.self) { Text($0) } }
                }
                Section("沙箱") {
                    Picker("沙箱", selection: $sandbox) { ForEach(sandboxes, id: \.self) { Text($0) } }
                }
                Section {
                    Button("应用（下个会话生效）") {
                        store.setConfig(approvalPolicy: policy, sandbox: sandbox, cwd: cwd); dismiss()
                    }
                    Button("新建会话") { store.newThread(cwd); dismiss() }
                    Button("退出/忘记连接", role: .destructive) { store.forget(); dismiss() }
                }
            }
            .navigationTitle("设置")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
        }
        .onAppear {
            cwd = store.state.cwd == "—" ? "" : store.state.cwd
            if !store.state.approvalPolicy.isEmpty { policy = store.state.approvalPolicy }
            if !store.state.sandbox.isEmpty { sandbox = store.state.sandbox }
        }
    }
}
