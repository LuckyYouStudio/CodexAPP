// End-to-end encryption between the phone and the PC agent (NaCl box:
// Curve25519 + XSalsa20-Poly1305). The cloud broker only ever sees the
// ciphertext envelopes produced here — it cannot read the messages.
import nacl from "tweetnacl";
import fs from "node:fs";

const b64 = (u8) => Buffer.from(u8).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

export function newKeyPair() {
  const kp = nacl.box.keyPair();
  return { publicKey: b64(kp.publicKey), secretKey: b64(kp.secretKey) };
}

export function loadOrCreateKeyPair(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const kp = newKeyPair();
  fs.writeFileSync(file, JSON.stringify(kp));
  return kp;
}

// Encrypt a JS object for `theirPub`, signed by `mySecret`.
export function seal(obj, theirPub, mySecret) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msg = new TextEncoder().encode(JSON.stringify(obj));
  const boxed = nacl.box(msg, nonce, unb64(theirPub), unb64(mySecret));
  return { nonce: b64(nonce), box: b64(boxed) };
}

// Decrypt an envelope from `theirPub`. Returns null if auth fails.
export function open(env, theirPub, mySecret) {
  try {
    const opened = nacl.box.open(unb64(env.box), unb64(env.nonce), unb64(theirPub), unb64(mySecret));
    if (!opened) return null;
    return JSON.parse(new TextDecoder().decode(opened));
  } catch {
    return null;
  }
}

// Short human-comparable fingerprint of a public key (for pairing verification).
export function fingerprint(pubB64) {
  const h = nacl.hash(unb64(pubB64)); // sha512
  return Array.from(h.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Short Authentication String binding the pairing code to BOTH public keys.
// A broker that swaps keys (MITM) can't produce a matching SAS without the code.
// Both sides must pass (agentPub, phonePub) in the same order using their own view.
export function sas(code, agentPub, phonePub) {
  const c = new TextEncoder().encode(String(code));
  const a = unb64(agentPub), p = unb64(phonePub);
  const data = new Uint8Array(c.length + a.length + p.length + c.length);
  let o = 0;
  for (const part of [c, a, p, c]) { data.set(part, o); o += part.length; }
  const h = nacl.hash(data);
  return Array.from(h.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
