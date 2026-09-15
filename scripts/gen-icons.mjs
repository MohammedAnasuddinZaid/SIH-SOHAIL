// Generates public/icons/icon-192.png and icon-512.png (plus writes icon.svg
// as the lossless source) with zero dependencies. Renders the ZELUX mark:
// an orange rounded tile with three white ascending bars (rep counter).

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const BARS = [
  { x: 0.2, y: 0.52, w: 0.14, h: 0.3 },
  { x: 0.43, y: 0.38, w: 0.14, h: 0.44 },
  { x: 0.66, y: 0.24, w: 0.14, h: 0.58 },
];

function drawImage(size, supersample) {
  const S = supersample;
  const N = size * S;
  const px = new Float64Array(N * N * 4);

  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    const sa = a / 255;
    const da = px[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) return;
    px[i] = (r * sa + px[i] * da * (1 - sa)) / outA;
    px[i + 1] = (g * sa + px[i + 1] * da * (1 - sa)) / outA;
    px[i + 2] = (b * sa + px[i + 2] * da * (1 - sa)) / outA;
    px[i + 3] = outA * 255;
  };

  const fillRoundRect = (x0, y0, w, h, rad, r, g, b, a) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cx = Math.max(rad, Math.min(w - rad - 1, x));
        const cy = Math.max(rad, Math.min(h - rad - 1, y));
        const dx = x - cx;
        const dy = y - cy;
        const inside = dx * dx + dy * dy <= rad * rad || x <= rad || y <= rad || x >= w - rad - 1 || y >= h - rad - 1;
        if (inside) put(x0 + x, y0 + y, r, g, b, a);
      }
    }
  };

  // Tile
  const corner = Math.round(0.225 * N);
  fillRoundRect(0, 0, N, N, corner, 240, 90, 18, 255);

  // Ascending bars
  for (const b of BARS) {
    const bx = Math.round(b.x * N);
    const by = Math.round(b.y * N);
    const bw = Math.round(b.w * N);
    const bh = Math.round(b.h * N);
    fillRoundRect(bx, by, bw, bh, Math.round(bw / 2), 255, 255, 255, 255);
  }

  // Downsample
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = ((y * S + sy) * N + (x * S + sx)) * 4;
          const alpha = px[i + 3] / 255;
          r += px[i] * alpha;
          g += px[i + 1] * alpha;
          b += px[i + 2] * alpha;
          a += alpha;
        }
      }
      const n = S * S;
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = Math.min(255, Math.round((a / n) * 255));
    }
  }
  return out;
}

// ── PNG encoding ──
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const row = size * 4;
  const raw = Buffer.alloc((row + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (row + 1)] = 0; // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const rgba = drawImage(size, 3);
  writeFileSync(join(outDir, `icon-${size}.png`), encodePNG(size, rgba));
  console.log(`wrote icon-${size}.png (${size}x${size})`);
}

// SVG source, same mark
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#f05a12"/>
  <rect x="13" y="29" width="9" height="22" rx="4.5" fill="#ffffff"/>
  <rect x="27.5" y="21" width="9" height="30" rx="4.5" fill="#ffffff"/>
  <rect x="42" y="13" width="9" height="38" rx="4.5" fill="#ffffff"/>
</svg>`;
writeFileSync(join(outDir, "icon.svg"), svg);
console.log("wrote icon.svg");