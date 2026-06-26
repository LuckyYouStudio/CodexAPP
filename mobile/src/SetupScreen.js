import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { C } from "./theme";

export default function SetupScreen({ initialUrl, onConnect }) {
  const [url, setUrl] = useState(initialUrl || "");
  const [token, setToken] = useState("");

  const go = () => {
    const u = url.trim();
    const t = token.trim();
    if (u && t) onConnect(u, t);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
      <View style={s.card}>
        <Text style={s.h1}>CodexApp</Text>
        <Text style={s.sub}>远程控制电脑上的 Codex</Text>

        <Text style={s.label}>中继地址</Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.x.x:4123"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={s.label}>访问 Token</Text>
        <TextInput
          style={s.input}
          value={token}
          onChangeText={setToken}
          placeholder="粘贴电脑终端显示的 Token"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable style={s.btn} onPress={go}>
          <Text style={s.btnText}>连接</Text>
        </Pressable>
        <Text style={s.hint}>Token 在电脑端启动中继时打印（`npm start`）。</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: 22 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 22 },
  h1: { color: C.text, fontSize: 30, fontWeight: "800" },
  sub: { color: C.muted, marginTop: 4, marginBottom: 8 },
  label: { color: C.muted, fontSize: 13, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.bg2, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 13, fontSize: 16 },
  btn: { backgroundColor: C.accent, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 18 },
  btnText: { color: "#042", fontWeight: "800", fontSize: 17 },
  hint: { color: C.muted, fontSize: 12, marginTop: 10 },
});
