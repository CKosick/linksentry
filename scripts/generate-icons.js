/**
 * Generate crisp PNG icons for LinkSentry (16x16, 48x48, 128x128)
 * Pure Node.js script using built-in zlib — zero external native dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// CRC32 table for PNG chunk checksums
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  typeBuf.copy(chunk, 4);
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function createPng(width, height, pixelFn) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0; // Deflate compression
  ihdrData[11] = 0; // Filter method
  ihdrData[12] = 0; // No interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw image scanlines: filter byte (0) + 4 bytes per pixel (RGBA)
  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawScanlines[offset++] = 0; // None filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x / width, y / height, width, height);
      rawScanlines[offset++] = r;
      rawScanlines[offset++] = g;
      rawScanlines[offset++] = b;
      rawScanlines[offset++] = a;
    }
  }

  // IDAT chunk (compressed scanlines)
  const compressed = zlib.deflateSync(rawScanlines, { level: 9 });
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Draws LinkSentry icon: Shield with chain link motif
 */
function drawLinkSentry(u, v) {
  // Center coordinates [-1, 1]
  const x = (u - 0.5) * 2;
  const y = (v - 0.5) * 2;

  // Shield boundary: top corners rounded, bottom comes to a shield point
  // Top horizontal: y = -0.8 to -0.6
  // Bottom point at (0, 0.9)
  const inShieldTop = (y >= -0.85 && y <= 0.1 && Math.abs(x) <= 0.85);
  const bottomCurve = 0.1 + (1.0 - Math.abs(x) * 1.05) * 0.8;
  const inShieldBottom = (y > 0.1 && y <= bottomCurve && Math.abs(x) <= 0.85);
  const inShield = inShieldTop || inShieldBottom;

  if (!inShield) {
    return [0, 0, 0, 0]; // Transparent background
  }

  // Border detection for shield
  const edgeDist = Math.min(
    0.85 - Math.abs(x),
    y - (-0.85),
    bottomCurve - y
  );
  const isShieldBorder = edgeDist < 0.1;

  if (isShieldBorder) {
    // Vibrant emerald sentry shield border
    return [16, 185, 129, 255]; // #10b981
  }

  // Shield interior: rich dark slate #0f172a to #1e293b gradient
  const grad = Math.min(1, Math.max(0, (y + 0.8) / 1.6));
  let bgR = Math.round(15 + grad * 15);
  let bgG = Math.round(23 + grad * 20);
  let bgB = Math.round(42 + grad * 30);

  // Center motif: Two interlocking chain links (drawn as rounded loops)
  // Link 1 (upper-left): center (-0.18, -0.15), tilted or oval
  // Link 2 (lower-right): center (0.18, 0.15)
  // Distance from link 1 center
  const d1 = Math.hypot((x + 0.18) * 1.3, (y + 0.18) * 0.9);
  const inRing1 = (d1 >= 0.22 && d1 <= 0.44);

  // Distance from link 2 center
  const d2 = Math.hypot((x - 0.18) * 1.3, (y - 0.18) * 0.9);
  const inRing2 = (d2 >= 0.22 && d2 <= 0.44);

  if (inRing1 && inRing2) {
    // Interlocking intersection: highlight with cyan
    return [6, 182, 212, 255]; // #06b6d4
  } else if (inRing1) {
    // Upper link: emerald green
    return [52, 211, 153, 255]; // #34d399
  } else if (inRing2) {
    // Lower link: cyan
    return [56, 189, 248, 255]; // #38bdf8
  }

  // Center sentry dot / pulse
  const dCenter = Math.hypot(x, y);
  if (dCenter < 0.1) {
    return [245, 158, 11, 255]; // Warm gold sentry core
  }

  return [bgR, bgG, bgB, 255];
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPng(size, size, (u, v) => drawLinkSentry(u, v));
  const outFile = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outFile, png);
  console.log(`Generated ${outFile} (${size}x${size}, ${png.length} bytes)`);
}
