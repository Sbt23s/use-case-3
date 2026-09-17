/**
 * Generates a PNG containing readable text, used to verify that OCR genuinely
 * extracts text from an image. Pure Node - no image library required.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const FONT = {
 'P':['11110','10001','10001','11110','10000','10000','10000'],
 'A':['01110','10001','10001','11111','10001','10001','10001'],
 'T':['11111','00100','00100','00100','00100','00100','00100'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],
 'N':['10001','11001','10101','10011','10001','10001','10001'],
 'O':['01110','10001','10001','10001','10001','10001','01110'],
 'L':['10000','10000','10000','10000','10000','10000','11111'],
 'D':['11110','10001','10001','10001','10001','10001','11110'],
 'S':['01111','10000','10000','01110','00001','00001','11110'],
 'R':['11110','10001','10001','11110','10100','10010','10001'],
 'V':['10001','10001','10001','10001','10001','01010','00100'],
 'U':['10001','10001','10001','10001','10001','10001','01110'],
 'M':['10001','11011','10101','10101','10001','10001','10001'],
 'B':['11110','10001','10001','11110','10001','10001','11110'],
 'Y':['10001','10001','01010','00100','00100','00100','00100'],
 'C':['01110','10001','10000','10000','10000','10001','01110'],
 'I':['11111','00100','00100','00100','00100','00100','11111'],
 'G':['01110','10001','10000','10111','10001','10001','01110'],
 'H':['10001','10001','10001','11111','10001','10001','10001'],
 'F':['11111','10000','10000','11110','10000','10000','10000'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '0':['01110','10001','10011','10101','11001','10001','01110'],
 '-':['00000','00000','00000','11111','00000','00000','00000'],
 ' ':['00000','00000','00000','00000','00000','00000','00000'],
};
const LINES = ['SURVEY 123-4','DEMO RECORD'];
const SCALE = 8, CW = 6, CH = 9, PAD = 28;
const cols = Math.max(...LINES.map((l) => l.length));
const W = cols * CW * SCALE + PAD * 2;
const H = LINES.length * CH * SCALE + PAD * 2;
const px = Buffer.alloc(W * H * 3, 255);
const set = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3; px[o] = 0; px[o + 1] = 0; px[o + 2] = 0;
};
LINES.forEach((line, li) => {
  [...line].forEach((ch, ci) => {
    const g = FONT[ch]; if (!g) return;
    g.forEach((row, ry) => [...row].forEach((bit, rx) => {
      if (bit !== '1') return;
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++)
        set(PAD + (ci * CW + rx) * SCALE + dx, PAD + (li * CH + ry) * SCALE + dy);
    }));
  });
});
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const crcTable = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc);
  return Buffer.concat([len, td, cb]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]);
const out = new URL('./patta.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(out, png);
console.log('wrote', out, `${W}x${H}`, `${png.length} bytes`);
