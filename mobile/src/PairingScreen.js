// Shown after login when an agent is online but this device isn't paired yet.
// Mirrors the web pairing step: enter the code shown on the PC control panel.
import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { C } from "./theme";

export default function PairingScreen({ relay, onForget }) {
  const [code, setCode] = useState("");
  const online = !!relay.agentFp;

  const submit = () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    relay.pair(c);
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Text style={s.h1}>配对电脑端</Text>
            <Text style={s.sub}>把这台手机和你的电脑绑定一次，之后会自动连，不用再输。</Text>
            <Text style={s.status}>
              {online ? "✅ 电脑端在线，请输入配对码" : "等待电脑端上线…"}
              {relay.agentFp ? "   🔒" + relay.agentFp : ""}
            </Text>

            <Text style={s.label}>配对码</Text>
            <TextInput
              style={s.input} value={code} onChangeText={setCode}
              placeholder="例 FVBRQU" placeholderTextColor={C.muted}
              autoCapitalize="characters" autoCorrect={false}
            />
            <Pressable style={[s.btn, !online && { opacity: 0.6 }]} disabled={!online} onPress={submit}>
              <Text style={s.btnText}>配对</Text>
            </Pressable>
            {!!relay.pairError && <Text style={s.err}>配对失败：{relay.pairError}</Text>}
            <Text style={s.hint}>在电脑客户端「控制面板」(或终端)能看到 6 位配对码，输入它即可。</Text>

            <Pressable style={s.ghost} onPress={onForget}><Text style={[s.ghostText, { color: C.danger }]}>退出登录</Text></Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 22 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 22 },
  h1: { color: C.text, fontSize: 26, fontWeight: "800" },
  sub: { color: C.muted, marginTop: 4 },
  status: { color: C.text, marginTop: 12, fontSize: 14 },
  label: { color: C.muted, fontSize: 13, marginTop: 14, marginBottom: 4 },
  input: { backgroundColor: C.bg2, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 13, fontSize: 16, letterSpacing: 2 },
  btn: { backgroundColor: C.accent, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 16 },
  btnText: { color: "#042", fontWeight: "800", fontSize: 17 },
  err: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: "center" },
  hint: { color: C.muted, fontSize: 12, marginTop: 12 },
  ghost: { padding: 13, alignItems: "center", marginTop: 8 },
  ghostText: { fontWeight: "700", fontSize: 15 },
});
