/**
 * Edge flood-fill: alpha=0 for white background connected to borders (8-bit RGBA PNG).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(__dirname, '..', 'src', 'assets', 'zhaoxun-logo.png');
const backupPath = path.join(__dirname, '..', 'src', 'assets', 'zhaoxun-logo-opaque-backup.png');

function crc32Chunk(typeStr, data) {
  const type = Buffer.from(typeStr, 'ascii');
  const combined = Buffer.concat([type, data]);
  let c = 0xffffffff;
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let x = n;
    for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
    crcTable[n] = x >>> 0;
  }
  for (let i = 0; i < combined.length; i++) c = crcTable[(c ^ combined[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const out = Buffer.alloc(8 + len + 4);
  out.writeUInt32BE(len, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32Chunk(type, data), 8 + len);
  return out;
}

function readPngRgba(buf) {
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('Not a PNG');
  let o = 8;
  let width = 0;
  let height = 0;
  const idatChunks = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) {
        throw new Error(`Expected 8-bit RGBA PNG, got depth=${data[8]} colorType=${data[9]}`);
      }
    } else if (type === 'IDAT') idatChunks.push(data);
    else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const scan = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = Buffer.alloc(stride);
    if (filter === 0) scan.copy(cur);
    else if (filter === 1) {
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        cur[i] = (scan[i] + left) & 255;
      }
    } else if (filter === 2) {
      for (let i = 0; i < stride; i++) cur[i] = (scan[i] + prev[i]) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev[i];
        cur[i] = (scan[i] + ((left + up) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev[i];
        const upLeft = i >= bpp ? prev[i - bpp] : 0;
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        let pr = left;
        if (pb < pa) pr = up;
        if (pc < Math.min(pa, pb)) pr = upLeft;
        cur[i] = (scan[i] + pr) & 255;
      }
    } else throw new Error(`Unsupported PNG filter ${filter}`);
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, rgba: out };
}

function isBg(rgba, idx) {
  return rgba[idx] >= 242 && rgba[idx + 1] >= 242 && rgba[idx + 2] >= 242;
}

function floodTransparent(rgba, width, height) {
  const visited = new Uint8Array(width * height);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pi = y * width + x;
    if (visited[pi]) return;
    const idx = pi * 4;
    if (!isBg(rgba, idx)) return;
    visited[pi] = 1;
    q.push(x, y);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (q.length) {
    const x = q.shift();
    const y = q.shift();
    const idx = (y * width + x) * 4;
    rgba[idx + 3] = 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
}

function writePngRgba(width, height, rgba) {
  const bpp = 4;
  const stride = width * bpp;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const scan = rgba.subarray(y * stride, y * stride + stride);
    const line = Buffer.alloc(1 + stride);
    line[0] = 0;
    scan.copy(line, 1);
    rows.push(line);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: zlib.constants.Z_BEST_SPEED });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

const buf = fs.readFileSync(inputPath);
fs.copyFileSync(inputPath, backupPath);
const { width, height, rgba } = readPngRgba(buf);
floodTransparent(rgba, width, height);
fs.writeFileSync(inputPath, writePngRgba(width, height, rgba));
console.log('OK:', inputPath);
