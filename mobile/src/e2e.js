// End-to-end encryption for the phone (React Native).
// Same NaCl box scheme + base64 wire format as the PC agent (cloud/e2e.mjs),
// so the two interoperate. tweetnacl has no PRNG in RN, so we wire expo-crypto.
import nacl from "tweetnacl";
import util from "tweetnacl-util";
import * as Crypto from "expo-crypto";

nacl.setPRNG((x, n) => {
  const bytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i++) x[i] = bytes[i];
});

export function newKeyPair() {
  const kp = nacl.box.keyPair();
  return { publicKey: util.encodeBase64(kp.publicKey), secretKey: util.encodeBase64(kp.secretKey) };
}

export function seal(obj, theirPub, mySecret) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msg = util.decodeUTF8(JSON.stringify(obj));
  const boxed = nacl.box(msg, nonce, util.decodeBase64(theirPub), util.decodeBase64(mySecret));
  return { nonce: util.encodeBase64(nonce), box: util.encodeBase64(boxed) };
}

export function open(env, theirPub, mySecret) {
  try {
    const opened = nacl.box.open(util.decodeBase64(env.box), util.decodeBase64(env.nonce), util.decodeBase64(theirPub), util.decodeBase64(mySecret));
    if (!opened) return null;
    return JSON.parse(util.encodeUTF8(opened));
  } catch {
    return null;
  }
}

export function fingerprint(pubB64) {
  const h = nacl.hash(util.decodeBase64(pubB64));
  return Array.from(h.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Short Authentication String binding the pairing code to BOTH public keys.
// Must match cloud/e2e.mjs byte-for-byte so phone and agent agree.
export function sas(code, agentPub, phonePub) {
  const c = util.decodeUTF8(String(code));
  const a = util.decodeBase64(agentPub), p = util.decodeBase64(phonePub);
  const data = new Uint8Array(c.length + a.length + p.length + c.length);
  let o = 0;
  for (const part of [c, a, p, c]) { data.set(part, o); o += part.length; }
  const h = nacl.hash(data);
  return Array.from(h.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
