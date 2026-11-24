// Builds a fragmented mp4 like the ones YouTube serves, from made-up bytes: ftyp, moov and a
// sidx that lists every fragment, then the fragments. Nothing in it plays, but its layout is real.
const crypto = require("crypto");

// big writes the size as 64 bits, which a box may do when its size field holds 1.
function box(type, payload, { big = false } = {}) {
  const head = Buffer.alloc(big ? 16 : 8);
  if (big) {
    head.writeUInt32BE(1, 0);
    head.writeBigUInt64BE(BigInt(16 + payload.length), 8);
  } else head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}

function sidx({ version, timescale, ept, first, refs }, opts) {
  const wide = version !== 0;
  const fixed = Buffer.alloc(12 + (wide ? 16 : 8) + 4);
  fixed.writeUInt8(version, 0);
  fixed.writeUInt32BE(1, 4); // reference_ID
  fixed.writeUInt32BE(timescale, 8);
  if (wide) {
    fixed.writeBigUInt64BE(BigInt(ept), 12);
    fixed.writeBigUInt64BE(BigInt(first), 20);
  } else {
    fixed.writeUInt32BE(ept, 12);
    fixed.writeUInt32BE(first, 16);
  }
  fixed.writeUInt16BE(refs.length, fixed.length - 2);
  const table = Buffer.alloc(refs.length * 12);
  refs.forEach((r, i) => {
    table.writeUInt32BE(r.size, i * 12);
    table.writeUInt32BE(r.duration, i * 12 + 4);
    table.writeUInt32BE(0x90000000, i * 12 + 8);
  });
  return box("sidx", Buffer.concat([fixed, table]), opts);
}

// frags: [{ duration, size }] in timescale ticks and bytes. first is the number of bytes between
// the sidx and the first fragment. Returns the file, where the init bytes end and where each
// fragment sits.
function fragmentedMp4({ frags, version = 0, timescale = 1000, ept = 0, first = 0, big = false, moov = 40 }) {
  const ftyp = box("ftyp", Buffer.from("isom\0\0\2\0isomiso2", "latin1"));
  const moovBox = box("moov", crypto.randomBytes(moov), { big });
  const index = sidx({ version, timescale, ept, first, refs: frags }, { big });
  const list = [];
  let offset = ftyp.length + moovBox.length + index.length + first;
  let ticks = ept;
  const pieces = frags.map((f) => {
    const body = crypto.randomBytes(f.size);
    list.push({ offset, size: f.size, start: ticks / timescale, end: (ticks + f.duration) / timescale });
    offset += f.size;
    ticks += f.duration;
    return body;
  });
  const file = Buffer.concat([ftyp, moovBox, index, Buffer.alloc(first), ...pieces]);
  return { file, initEnd: ftyp.length + moovBox.length, frags: list };
}

module.exports = { box, fragmentedMp4 };
