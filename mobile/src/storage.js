// Persist the connection profile + the phone's E2E keypair.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { newKeyPair } from "./e2e";

const K_PROFILE = "codexapp.profile";
const K_KEYS = "codexapp.keys";

const EMPTY = { mode: "cloud", url: "", token: "", brokerUrl: "", email: "", password: "", pairCode: "" };

export async function loadProfile() {
  const raw = await AsyncStorage.getItem(K_PROFILE);
  if (raw) { try { return { ...EMPTY, ...JSON.parse(raw) }; } catch {} }
  return { ...EMPTY };
}
export async function saveProfile(p) { await AsyncStorage.setItem(K_PROFILE, JSON.stringify(p)); }
export async function clearProfile() { await AsyncStorage.removeItem(K_PROFILE); }

export function profileReady(p) {
  if (!p) return false;
  if (p.mode === "lan") return !!(p.url && p.token);
  return !!(p.brokerUrl && p.email && p.password);
}

// Stable E2E identity for this device (persisted so the pairing fingerprint
// doesn't change between launches).
export async function loadKeyPair() {
  const raw = await AsyncStorage.getItem(K_KEYS);
  if (raw) { try { return JSON.parse(raw); } catch {} }
  const kp = newKeyPair();
  await AsyncStorage.setItem(K_KEYS, JSON.stringify(kp));
  return kp;
}
