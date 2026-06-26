import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Platform } from "react-native";
import { C } from "./theme";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

export default function DiffModal({ visible, diff, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.h2}>本次改动 (diff)</Text>
          <ScrollView style={s.diffWrap} horizontal>
            <ScrollView>
              <Text style={s.diff}>{diff || "(无改动)"}</Text>
            </ScrollView>
          </ScrollView>
          <Pressable style={s.btn} onPress={onClose}><Text style={s.btnText}>关闭</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "88%" },
  h2: { color: C.text, fontSize: 20, fontWeight: "800", marginBottom: 8 },
  diffWrap: { backgroundColor: "#0d1526", borderColor: C.line, borderWidth: 1, borderRadius: 8, padding: 10, maxHeight: "74%" },
  diff: { color: C.text, fontFamily: MONO, fontSize: 12, lineHeight: 17 },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: C.line, marginTop: 10, backgroundColor: C.card2 },
  btnText: { color: C.text, fontWeight: "700", fontSize: 15 },
});
