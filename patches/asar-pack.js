// Minimal asar packer — writes the exact layout Electron's asar reader expects:
//   [0..3]  u32 LE = 4
//   [4..7]  u32 LE = S = 4 + padded(4 + jsonLen)
//   [8..11] u32 LE = padded(4 + jsonLen)
//   [12..15] u32 LE = jsonLen
//   [16..16+jsonLen) json
//   data section at 8 + S, each file 4-byte aligned, offsets relative to data start.
// File offsets are data-relative, so they are independent of the header size:
// one pass computes them from the cumulative aligned sizes.
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];

function ceil4(n) { return (n + 3) & ~3; }

// Pass 1: walk the tree, collect files (rel, size) and assign cumulative
// aligned offsets; build the tree structure with sizes only.
const files = []; // { rel, size, offset }
let cursor = 0;
function collect(dir, prefix) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const tree = { files: {} };
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      tree.files[ent.name] = collect(full, rel);
    } else if (ent.isFile()) {
      const size = fs.statSync(full).size;
      const offset = cursor;
      cursor += ceil4(size);
      files.push({ rel, size, offset });
      tree.files[ent.name] = { size, offset: String(offset) };
    }
  }
  return tree;
}
const tree = collect(SRC, '');
const json = JSON.stringify(tree);
const jsonLen = Buffer.byteLength(json, 'utf8');
const payloadPadded = ceil4(4 + jsonLen);
const S = 4 + payloadPadded;

// Write output.
const header = Buffer.alloc(8 + S);
header.writeUInt32LE(4, 0);
header.writeUInt32LE(S, 4);
header.writeUInt32LE(payloadPadded, 8);
header.writeUInt32LE(jsonLen, 12);
header.write(json, 16, 'utf8');

const out = fs.openSync(OUT, 'w');
fs.writeSync(out, header);
for (const f of files) {
  const buf = fs.readFileSync(path.join(SRC, f.rel));
  if (buf.length !== f.size) throw new Error(`size mismatch for ${f.rel}`);
  fs.writeSync(out, buf);
  const pad = ceil4(buf.length) - buf.length;
  if (pad > 0) fs.writeSync(out, Buffer.alloc(pad));
}
fs.closeSync(out);
console.log(`packed ${files.length} files -> ${OUT}`);
console.log(`jsonLen=${jsonLen} S=${S} dataStart=${8 + S} total=${fs.statSync(OUT).size}`);
