import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { C } from "./theme";

export default function SessionsModal({ visible, threads, onResume, onRefresh, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.h2}>会话 / 项目</Text>
          <Text style={s.hint}>点一条接着写——会切到它的项目目录，继续这段对话。</Text>
          <ScrollView style={{ maxHeight: "70%" }}>
            {(!threads || threads.length === 0) && <Text style={s.hint}>没有会话</Text>}
            {(threads || []).map((t) => (
              <Pressable key={t.id} style={s.item} onPress={() => onResume(t.id)}>
                <Text style={s.name} numberOfLines={1}>{t.name || "(无标题)"}</Text>
                <Text style={s.meta} numberOfLines={1}>{t.cwd || ""}</Text>
                <Text style={s.meta}>
                  {t.updatedAt ? new Date(t.updatedAt * 1000).toLocaleString() : ""}
                  {t.source ? " · " + t.source : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={[s.btn, s.secondary]} onPress={onRefresh}><Text style={s.btnText}>刷新</Text></Pressable>
          <Pressable style={[s.btn, s.ghost]} onPress={onClose}><Text style={[s.btnText, { color: C.muted }]}>关闭</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "88%" },
  h2: { color: C.text, fontSize: 20, fontWeight: "800", marginBottom: 4 },
  hint: { color: C.muted, fontSize: 13, marginBottom: 8 },
  item: { backgroundColor: C.bg2, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  name: { color: C.text, fontWeight: "600", marginBottom: 4 },
  meta: { color: C.muted, fontSize: 12 },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: C.line, marginTop: 8 },
  secondary: { backgroundColor: C.card2 },
  ghost: { backgroundColor: "transparent" },
  btnText: { color: C.text, fontWeight: "700", fontSize: 15 },
});
