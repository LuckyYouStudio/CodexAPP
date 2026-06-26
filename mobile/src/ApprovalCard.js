import { View, Text, Pressable, StyleSheet } from "react-native";
import { C } from "./theme";

function btnStyle(style) {
  if (style === "primary") return { bg: C.accent, fg: "#042", border: C.accent };
  if (style === "danger") return { bg: "transparent", fg: C.danger, border: C.danger };
  return { bg: C.card2, fg: C.text, border: C.line };
}

export default function ApprovalCard({ approval, onDecide }) {
  const a = approval;
  const meta = [];
  if (a.cwd) meta.push("📁 " + a.cwd);
  if (a.reason) meta.push("💬 " + a.reason);
  if (a.note) meta.push("⚠ " + a.note);

  return (
    <View style={s.card}>
      <Text style={s.title}>⚠ {a.title}</Text>
      <Text style={s.cmd}>{a.command}</Text>
      {meta.length > 0 && <Text style={s.meta}>{meta.join("\n")}</Text>}
      <View style={s.actions}>
        {(a.options || []).map((opt) => {
          const st = btnStyle(opt.style);
          return (
            <Pressable
              key={opt.id}
              style={[s.btn, { backgroundColor: st.bg, borderColor: st.border }]}
              onPress={() => onDecide(a.key, opt.id)}
            >
              <Text style={[s.btnText, { color: st.fg }]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderColor: C.warn, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  title: { color: C.warn, fontWeight: "800", marginBottom: 6 },
  cmd: { color: C.text, fontFamily: Platform_mono(), backgroundColor: "#0d1526", borderColor: C.line, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13 },
  meta: { color: C.muted, fontSize: 12, marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  btnText: { fontWeight: "700" },
});

function Platform_mono() {
  const { Platform } = require("react-native");
  return Platform.OS === "ios" ? "Menlo" : "monospace";
}
