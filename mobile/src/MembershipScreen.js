// Cloud membership gate + redeem UI. Two presentations from one component:
//   - blocked  (no onClose): full screen, shown by App when conn==="needMembership"
//   - renew    (onClose set): a modal opened from Settings to extend membership
import { useState } from "react";
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform,
} from "react-native";
import { C } from "./theme";
import { fmtMember } from "./membership";

export default function MembershipScreen({ relay, onForget, onClose }) {
  const renew = !!onClose;
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const doRedeem = async () => {
    const c = code.trim().toUpperCase();
    if (!c) { setMsg("请输入兑换码"); return; }
    setBusy(true); setMsg("兑换中…");
    const r = await relay.redeem(c);
    setBusy(false);
    if (!r.ok) { setMsg("兑换失败：" + r.error); return; }
    setCode("");
    setMsg("✅ 已开通：" + fmtMember(r.membershipUntil));
    if (renew) setTimeout(onClose, 900); // blocked case auto-routes to MainScreen on reconnect
  };

  const body = (
    <View style={s.card}>
      <Text style={s.h1}>开通云端会员</Text>
      <Text style={s.sub}>局域网直连模式永久免费；云端（随处可用）需要会员。</Text>
      <Text style={s.status}>当前：{fmtMember(relay.membershipUntil)}</Text>

      <Text style={s.label}>兑换码</Text>
      <TextInput
        style={s.input} value={code} onChangeText={setCode}
        placeholder="CDX-XXXX-XXXX-XXXX" placeholderTextColor={C.muted}
        autoCapitalize="characters" autoCorrect={false}
      />
      <Pressable style={[s.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={doRedeem}>
        <Text style={s.btnText}>兑换并开通</Text>
      </Pressable>
      {!!msg && <Text style={s.msg}>{msg}</Text>}

      {renew ? (
        <Pressable style={s.ghost} onPress={onClose}><Text style={[s.ghostText, { color: C.muted }]}>关闭</Text></Pressable>
      ) : (
        <Pressable style={s.ghost} onPress={onForget}><Text style={[s.ghostText, { color: C.danger }]}>退出 / 改用局域网（免费）</Text></Pressable>
      )}
    </View>
  );

  if (renew) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <View style={s.backdrop}>{body}</View>
      </Modal>
    );
  }
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">{body}</ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 22 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 22 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 22 },
  h1: { color: C.text, fontSize: 26, fontWeight: "800" },
  sub: { color: C.muted, marginTop: 4 },
  status: { color: C.text, marginTop: 12, fontSize: 14 },
  label: { color: C.muted, fontSize: 13, marginTop: 14, marginBottom: 4 },
  input: { backgroundColor: C.bg2, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 13, fontSize: 16, letterSpacing: 1 },
  btn: { backgroundColor: C.accent, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 16 },
  btnText: { color: "#042", fontWeight: "800", fontSize: 17 },
  msg: { color: C.muted, fontSize: 13, marginTop: 12, textAlign: "center" },
  ghost: { padding: 13, alignItems: "center", marginTop: 8 },
  ghostText: { fontWeight: "700", fontSize: 15 },
});
