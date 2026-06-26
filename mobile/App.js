import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { C } from "./src/theme";
import { loadCreds, saveCreds, clearToken } from "./src/storage";
import { useRelay } from "./src/useRelay";
import SetupScreen from "./src/SetupScreen";
import MainScreen from "./src/MainScreen";

// MainScreen mounts the relay connection; isolated so the hook re-runs cleanly
// when creds change (connect/disconnect happens via useRelay's effect).
function Connected({ creds, onForget }) {
  const relay = useRelay(creds);
  return <MainScreen relay={relay} onForget={onForget} />;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [creds, setCreds] = useState({ url: "", token: "" });

  useEffect(() => {
    loadCreds().then((c) => { setCreds(c); setReady(true); });
  }, []);

  const onConnect = async (url, token) => {
    await saveCreds(url, token);
    setCreds({ url, token });
  };

  const onForget = async () => {
    await clearToken();
    setCreds((c) => ({ url: c.url, token: "" }));
  };

  if (!ready) {
    return (
      <View style={s.loading}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={s.app}>
      <StatusBar style="light" />
      {creds.token
        ? <Connected creds={creds} onForget={onForget} />
        : <SetupScreen initialUrl={creds.url} onConnect={onConnect} />}
    </View>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  loading: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
});
