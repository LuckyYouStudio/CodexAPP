// Browser E2E — same NaCl box scheme + base64 wire format as the agent/mobile,
// so they interoperate. Uses window.nacl/naclUtil from vendor/nacl.js, and the
// browser's crypto.getRandomValues (secure context) as tweetnacl's PRNG.
(function () {
  const nacl = window.nacl, util = window.naclUtil;
  const b64 = (u8) => util.encodeBase64(u8);
  const unb64 = (s) => util.decodeBase64(s);

  window.E2E = {
    newKeyPair() {
      const kp = nacl.box.keyPair();
      return { publicKey: b64(kp.publicKey), secretKey: b64(kp.secretKey) };
    },
    seal(obj, theirPub, mySecret) {
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const boxed = nacl.box(util.decodeUTF8(JSON.stringify(obj)), nonce, unb64(theirPub), unb64(mySecret));
      return { nonce: b64(nonce), box: b64(boxed) };
    },
    open(env, theirPub, mySecret) {
      try {
        const o = nacl.box.open(unb64(env.box), unb64(env.nonce), unb64(theirPub), unb64(mySecret));
        return o ? JSON.parse(util.encodeUTF8(o)) : null;
      } catch { return null; }
    },
    fingerprint(pub) {
      const h = nacl.hash(unb64(pub));
      return Array.from(h.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    },
    sas(code, agentPub, phonePub) {
      const c = util.decodeUTF8(String(code)), a = unb64(agentPub), p = unb64(phonePub);
      const data = new Uint8Array(c.length + a.length + p.length + c.length);
      let o = 0;
      for (const part of [c, a, p, c]) { data.set(part, o); o += part.length; }
      const h = nacl.hash(data);
      return Array.from(h.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    },
  };
})();
