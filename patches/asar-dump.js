// Minimal asar reader v3 — exact header layout:
//   [0..3]  u32 LE = 4 (size pickle payload length)
//   [4..7]  u32 LE = S (header pickle size, = 8 + padded(4 + jsonLen))
//   [8..11] u32 LE = padded(4 + jsonLen)
//   [12..15] u32 LE = jsonLen
//   [16..16+jsonLen) json
//   data starts at 8 + S
const fs = require('fs');
const path = require('path');

const ASAR = process.argv[2];
const OUTDIR = process.argv[3] || null;
const PATTERN = process.argv[4] ? new RegExp(process.argv[4]) : null;

const buf = fs.readFileSync(ASAR);
const S = buf.readUInt32LE(4);
const jsonLen = buf.readUInt32LE(12);
const json = buf.slice(16, 16 + jsonLen).toString('utf8');
const tree = JSON.parse(json);
const dataStart = 8 + S;

let count = 0;
function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.files) {
      walk(child, rel);
    } else {
      const size = child.size;
      const offset = Number(child.offset);
      const hit = !PATTERN || PATTERN.test(rel);
      if (!OUTDIR || hit) {
        count++;
        console.log(`${rel}\t${size}\t${offset}`);
      }
      if (OUTDIR && hit) {
        const dest = path.join(OUTDIR, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf.slice(dataStart + offset, dataStart + offset + size));
      }
    }
  }
}
walk(tree, '');
if (!PATTERN) console.log(`total entries: ${count}`);
if (OUTDIR) console.log(`extracted matching files to ${OUTDIR}`);
