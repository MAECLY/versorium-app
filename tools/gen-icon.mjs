#!/usr/bin/env node
// Generates a 1024x1024 Versorium source icon: needle + compass rose,
// Needle Teal on Folio paper. Pure node, no dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const cx = S / 2, cy = S / 2;

// palette (DESIGN-VERSORIUM.md)
const paper = [0xf3, 0xec, 0xdd];
const teal = [0x2a, 0x6f, 0x6a];
const ink = [0x2c, 0x26, 0x1c];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const px = Buffer.alloc(S * S * 4);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    let c = paper;
    let a = 255;

    // soft radial vignette on the paper
    const v = Math.min(1, r / (S * 0.72));
    c = mix(paper, mix(paper, ink, 0.06), v);

    // compass rose: thin outer ring + 4 ticks
    if (Math.abs(r - 430) < 5) c = teal;
    else if (r < 430 && r > 424) c = mix(c, teal, 0.25);
    for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const tx = dx * Math.cos(ang) - dy * Math.sin(ang);
      const ty = dx * Math.sin(ang) + dy * Math.cos(ang);
      if (ty > 360 && ty < 424 && Math.abs(tx) < 6) c = teal;
    }

    // needle: thin rhombus rotated 45deg (NE-SW)
    const k = Math.PI / 4;
    const rx = dx * Math.cos(k) + dy * Math.sin(k);
    const ry = -dx * Math.sin(k) + dy * Math.cos(k);
    const len = 300, wid = 44;
    if (Math.abs(rx) / len + Math.abs(ry) / wid <= 1) {
      // north half darker, south half lighter
      c = ry < 0 ? mix(teal, ink, 0.25) : mix(teal, paper, 0.25);
    }
    // center pin
    if (r < 26) c = ink;
    else if (r < 34) c = mix(teal, paper, 0.4);

    const i = (y * S + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
  }
}

// PNG encode
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crcTable = chunk.crcTable ??= (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < t.length + data.length; i++) {
    const b = i < t.length ? t[i] : data[i - t.length];
    crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("./icon-source.png", import.meta.url), png);
console.log("icon-source.png written", png.length, "bytes");
