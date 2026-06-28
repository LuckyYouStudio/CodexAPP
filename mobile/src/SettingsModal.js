import { useEffect, useState } from "react";
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { C } from "./theme";
import { fmtMember } from "./membership";

const POLICIES = ["on-request", "untrusted", "on-failure", "never"];
const SANDBOXES = ["workspace-write", "read-only", "danger-full-access"];

function Chips({ value, options, onPick }) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onPick(o)} style={[s.chip, on && s.chipOn]}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsModal({ visible, config, cloud, membershipUntil, onRedeem, onApply, onNewThread, onEnableNotif, onForget, onClose }) {
  const [cwd, setCwd] = useState("");
  const [policy, setPolicy] = useState("on-request");
  const [sandbox, setSandbox] = useState("workspace-write");

  useEffect(() => {
    if (visible) {
      setCwd(config.cwd || "");
      setPolicy(config.approvalPolicy || "on-request");
      setSandbox(config.sandbox || "workspace-write");
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <ScrollView>
            <Text style={s.h2}>设置</Text>

            <Text style={s.label}>工作目录 (cwd)</Text>
            <TextInput style={s.input} value={cwd} onChangeText={setCwd} autoCapitalize="none" autoCorrect={false} placeholder="C:\\test" placeholderTextColor={C.muted} />

            <Text style={s.label}>审批策略</Text>
            <Chips value={policy} options={POLICIES} onPick={setPolicy} />

            <Text style={s.label}>沙箱</Text>
            <Chips value={sandbox} options={SANDBOXES} onPick={setSandbox} />

            <View style={s.row}>
              <Pressable style={[s.btn, s.primary]} onPress={() => onApply({ cwd: cwd.trim() || undefined, approvalPolicy: policy, sandbox })}>
                <Text style={[s.btnText, { color: "#042" }]}>应用 (下个会话)</Text>
              </Pressable>
              <Pressable style={[s.btn, s.secondary]} onPress={() => onNewThread(cwd.trim() || undefined)}>
                <Text style={s.btnText}>新建会话</Text>
              </Pressable>
            </View>

            <Pressable style={[s.btn, s.secondary, s.full]} onPress={onEnableNotif}>
              <Text style={s.btnText}>开启审批通知</Text>
            </Pressable>
            {cloud && (
              <>
                <Text style={[s.label, { marginTop: 16 }]}>会员：{fmtMember(membershipUntil)}（局域网模式免费）</Text>
                <Pressable style={[s.btn, s.secondary, s.full]} onPress={onRedeem}>
                  <Text style={s.btnText}>兑换 / 续费会员</Text>
                </Pressable>
              </>
            )}
            <Pressable style={[s.btn, s.ghost, s.full]} onPress={onForget}>
              <Text style={[s.btnText, { color: C.danger }]}>退出 / 忘记连接</Text>
            </Pressable>
            <Pressable style={[s.btn, s.ghost, s.full]} onPress={onClose}>
              <Text style={[s.btnText, { color: C.muted }]}>关闭</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "86%" },
  h2: { color: C.text, fontSize: 20, fontWeight: "800", marginBottom: 6 },
  label: { color: C.muted, fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: C.bg2, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: C.bg2 },
  chipOn: { backgroundColor: C.accent2, borderColor: C.accent2 },
  chipText: { color: C.muted, fontSize: 13 },
  chipTextOn: { color: "#021", fontWeight: "700" },
  row: { flexDirection: "row", gap: 8, marginTop: 16 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: C.line },
  primary: { backgroundColor: C.accent, borderColor: C.accent },
  secondary: { backgroundColor: C.card2 },
  ghost: { backgroundColor: "transparent" },
  full: { flex: 0, marginTop: 10 },
  btnText: { color: C.text, fontWeight: "700", fontSize: 15 },
});
