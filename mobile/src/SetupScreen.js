import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { C } from "./theme";

export default function SetupScreen({ initial, onConnect }) {
  const [mode, setMode] = useState(initial?.mode || "cloud");
  const [brokerUrl, setBrokerUrl] = useState(initial?.brokerUrl || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [password, setPassword] = useState(initial?.password || "");
  const [pairCode, setPairCode] = useState(initial?.pairCode || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [token, setToken] = useState(initial?.token || "");

  const go = () => {
    if (mode === "cloud") {
      if (!brokerUrl.trim() || !email.trim() || !password) return;
      onConnect({ mode: "cloud", brokerUrl: brokerUrl.trim(), email: email.trim(), password, pairCode: pairCode.trim().toUpperCase() });
    } else {
      if (!url.trim() || !token.trim()) return;
      onConnect({ mode: "lan", url: url.trim(), token: token.trim() });
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.h1}>CodexApp</Text>
          <Text style={s.sub}>远程控制电脑上的 Codex</Text>

          <View style={s.tabs}>
            <Pressable style={[s.tab, mode === "cloud" && s.tabOn]} onPress={() => setMode("cloud")}>
              <Text style={[s.tabText, mode === "cloud" && s.tabTextOn]}>云账号（随处可用）</Text>
            </Pressable>
            <Pressable style={[s.tab, mode === "lan" && s.tabOn]} onPress={() => setMode("lan")}>
              <Text style={[s.tabText, mode === "lan" && s.tabTextOn]}>局域网直连</Text>
            </Pressable>
          </View>

          {mode === "cloud" ? (
            <>
              <Text style={s.label}>Broker 地址</Text>
              <TextInput style={s.input} value={brokerUrl} onChangeText={setBrokerUrl} placeholder="https://broker.yourdomain.com" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <Text style={s.label}>账号邮箱</Text>
              <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
              <Text style={s.label}>密码</Text>
              <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="账号密码" placeholderTextColor={C.muted} secureTextEntry />
              <Text style={s.label}>配对码（电脑 Agent 显示，仅首次需要）</Text>
              <TextInput style={s.input} value={pairCode} onChangeText={setPairCode} placeholder="例 FVBRQU" placeholderTextColor={C.muted} autoCapitalize="characters" autoCorrect={false} />
              <Text style={s.hint}>配对码把你的手机和这台电脑绑定，防止中间人。内容端到端加密，服务器看不到。</Text>
            </>
          ) : (
            <>
              <Text style={s.label}>中继地址</Text>
              <TextInput style={s.input} value={url} onChangeText={setUrl} placeholder="http://192.168.x.x:4123" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <Text style={s.label}>访问 Token</Text>
              <TextInput style={s.input} value={token} onChangeText={setToken} placeholder="粘贴电脑终端显示的 Token" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} />
              <Text style={s.hint}>同一 WiFi 直连，电脑跑 `npm start` 会打印地址和 Token。</Text>
            </>
          )}

          <Pressable style={s.btn} onPress={go}><Text style={s.btnText}>连接</Text></Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 22 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 22 },
  h1: { color: C.text, fontSize: 30, fontWeight: "800" },
  sub: { color: C.muted, marginTop: 4, marginBottom: 14 },
  tabs: { flexDirection: "row", backgroundColor: C.bg2, borderRadius: 10, padding: 4, marginBottom: 6 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  tabOn: { backgroundColor: C.card2 },
  tabText: { color: C.muted, fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: C.text },
  label: { color: C.muted, fontSize: 13, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.bg2, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 13, fontSize: 16 },
  hint: { color: C.muted, fontSize: 12, marginTop: 10 },
  btn: { backgroundColor: C.accent, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 18 },
  btnText: { color: "#042", fontWeight: "800", fontSize: 17 },
});
