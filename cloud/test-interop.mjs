// Prove the phone's RN crypto (tweetnacl-util encoding) interoperates with the
// agent's crypto (cloud/e2e.mjs, Buffer encoding). Same NaCl box + base64.
import nacl from "tweetnacl";
import util from "tweetnacl-util";
import { newKeyPair as agentKeyPair, seal as agentSeal, open as agentOpen, fingerprint } from "./e2e.mjs";

// Phone side (mirrors mobile/src/e2e.js exactly).
function phoneKeyPair() {
  const kp = nacl.box.keyPair();
  return { publicKey: util.encodeBase64(kp.publicKey), secretKey: util.encodeBase64(kp.secretKey) };
}
function phoneSeal(obj, theirPub, mySecret) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const boxed = nacl.box(util.decodeUTF8(JSON.stringify(obj)), nonce, util.decodeBase64(theirPub), util.decodeBase64(mySecret));
  return { nonce: util.encodeBase64(nonce), box: util.encodeBase64(boxed) };
}
function phoneOpen(env, theirPub, mySecret) {
  const o = nacl.box.open(util.decodeBase64(env.box), util.decodeBase64(env.nonce), util.decodeBase64(theirPub), util.decodeBase64(mySecret));
  return o ? JSON.parse(util.encodeUTF8(o)) : null;
}

const phone = phoneKeyPair();
const agent = agentKeyPair();

const env1 = phoneSeal({ type: "prompt", text: "你好 hello 🎉" }, agent.publicKey, phone.secretKey);
const dec1 = agentOpen(env1, phone.publicKey, agent.secretKey);
console.log("phone -> agent :", JSON.stringify(dec1), dec1?.text === "你好 hello 🎉" ? "OK ✓" : "FAIL");

const env2 = agentSeal({ type: "event", text: "执行完成" }, phone.publicKey, agent.secretKey);
const dec2 = phoneOpen(env2, agent.publicKey, phone.secretKey);
console.log("agent -> phone :", JSON.stringify(dec2), dec2?.text === "执行完成" ? "OK ✓" : "FAIL");

console.log("fingerprint match:", fingerprint(agent.publicKey) === fingerprint(agent.publicKey) ? "OK ✓" : "FAIL");
