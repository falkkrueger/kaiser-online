// Minimal PNG writer for palette framebuffers (debug/screenshots).
import zlib from 'node:zlib';
import { PALETTE } from './palette.js';
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
export function toPNG(fb, w, h, scale = 1) {
  const raw = Buffer.alloc((w * scale * 3 + 1) * h * scale);
  let o = 0;
  for (let y = 0; y < h * scale; y++) { raw[o++] = 0; for (let x = 0; x < w * scale; x++) { const c = PALETTE[fb[((y / scale) | 0) * w + ((x / scale) | 0)] & 15]; raw[o++] = c >> 16; raw[o++] = (c >> 8) & 255; raw[o++] = c & 255; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w * scale, 0); ih.writeUInt32BE(h * scale, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
