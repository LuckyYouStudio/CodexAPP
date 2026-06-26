// Persist relay URL + token across launches.
import AsyncStorage from "@react-native-async-storage/async-storage";

const K_URL = "codexapp.url";
const K_TOKEN = "codexapp.token";

export async function loadCreds() {
  const [url, token] = await Promise.all([
    AsyncStorage.getItem(K_URL),
    AsyncStorage.getItem(K_TOKEN),
  ]);
  return { url: url || "", token: token || "" };
}

export async function saveCreds(url, token) {
  await Promise.all([
    AsyncStorage.setItem(K_URL, url),
    AsyncStorage.setItem(K_TOKEN, token),
  ]);
}

export async function clearToken() {
  await AsyncStorage.removeItem(K_TOKEN);
}
