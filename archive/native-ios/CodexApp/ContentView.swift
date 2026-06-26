import SwiftUI

struct ContentView: View {
    @EnvironmentObject var store: RelayStore
    var body: some View {
        if store.hasCreds { MainView() } else { SetupView() }
    }
}

struct SetupView: View {
    @EnvironmentObject var store: RelayStore
    @State private var url = ""
    @State private var token = ""

    var body: some View {
        ZStack {
            Color.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                Text("CodexApp").font(.largeTitle.bold()).foregroundColor(.textMain)
                Text("远程控制电脑上的 Codex").foregroundColor(.muted)

                Text("中继地址").font(.caption).foregroundColor(.muted)
                TextField("http://192.168.x.x:4123", text: $url)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .disableAutocorrection(true)

                Text("访问 Token").font(.caption).foregroundColor(.muted)
                TextField("粘贴电脑终端显示的 Token", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)

                Button {
                    if !url.isEmpty && !token.isEmpty { store.saveAndConnect(url: url, token: token) }
                } label: {
                    Text("连接").font(.headline).frame(maxWidth: .infinity).padding()
                        .background(Color.accentGreen).foregroundColor(.black).cornerRadius(10)
                }
                Text("Token 在电脑端启动中继时打印。").font(.footnote).foregroundColor(.muted)
            }
            .padding(24)
        }
        .onAppear { if url.isEmpty { url = store.savedURL.isEmpty ? "http://" : store.savedURL } }
    }
}
