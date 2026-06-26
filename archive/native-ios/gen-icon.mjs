// Generate the iOS app icon (1024) — green check on dark bg. No deps.
// Run: node ios/gen-icon.mjs
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makePNG(size) {
  const W = size, H = size;
  const buf = Buffer.alloc(W * H * 4);
  const bg = [0x0b, 0x12, 0x20], bg2 = [0x12, 0x2a, 0x22], accent = [0x35, 0xd0, 0x7f];
  const set = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
  };
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const c = [
      Math.round(bg[0] + (bg2[0] - bg[0]) * t),
      Math.round(bg[1] + (bg2[1] - bg[1]) * t),
      Math.round(bg[2] + (bg2[2] - bg[2]) * t),
    ];
    for (let x = 0; x < W; x++) set(x, y, c);
  }
  const stroke = Math.max(2, Math.round(size * 0.075));
  const line = (x0, y0, x1, y1, c) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      for (let dy = -stroke; dy <= stroke; dy++)
        for (let dx = -stroke; dx <= stroke; dx++)
          if (dx * dx + dy * dy <= stroke * stroke) set(Math.round(cx + dx), Math.round(cy + dy), c);
    }
  };
  const p = (fx, fy) => [Math.round(fx * size), Math.round(fy * size)];
  const a = p(0.28, 0.52), b = p(0.44, 0.68), c = p(0.74, 0.33);
  line(a[0], a[1], b[0], b[1], accent);
  line(b[0], b[1], c[0], c[1], accent);

  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = zlib.deflateSync(raw);
  const crcTable = (() => {
    const tb = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
    return tb;
  })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const out = path.join(__dirname, "CodexApp", "Assets.xcassets", "AppIcon.appiconset", "AppIcon.png");
fs.writeFileSync(out, makePNG(1024));
console.log("wrote", out);
