"use strict";

// A dependency-free reader and writer for the subset of the ZIP format that
// .docx uses, plus a shim that presents it through the small part of the JSZip
// API js/app.js actually calls.
//
// The app under test runs in a browser and gets JSZip from vendor/. The tests run
// under node, so they need something that answers `loadAsync`, `file()` and
// `async("string" | "base64")` the same way. Writing one is about a hundred
// lines and means the suite has no dependencies at all, which matters more here
// than covering the rest of JSZip.

const zlib = require("node:zlib");

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * Read a ZIP archive and return a Map of entry name -> uncompressed Buffer.
 * Only the two compression methods .docx uses are supported: stored and
 * deflate.
 */
function readZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);

  // The end-of-central-directory record is last, but a trailing comment may
  // follow it, so scan backwards for the signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`corrupt central directory at entry ${n}`);
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`corrupt local header for ${name}`);
    }
    // The local header repeats the name and extra-field lengths, and they are
    // not always the same as the central directory's, so read them from here.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) entries.set(name, Buffer.from(raw));
    else if (method === 8) entries.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`unsupported compression method ${method} for ${name}`);
  }
  return entries;
}

function dosTime() {
  // A fixed timestamp keeps generated fixtures byte-identical between runs.
  return { time: 0, date: 0x2821 }; // 2000-01-01
}

/**
 * Build a ZIP archive from a Map (or plain object) of name -> Buffer|string.
 * Entries are deflated, which is what Word produces, so the reader's deflate
 * path is exercised by every generated fixture rather than only by the two
 * checked-in sample documents.
 */
function writeZip(files) {
  const list = files instanceof Map ? [...files] : Object.entries(files);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of list) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    const deflated = zlib.deflateRawSync(data);
    // Storing is allowed to be smaller than deflating for tiny entries; pick
    // whichever is smaller, exactly as a real writer would.
    const store = deflated.length >= data.length;
    const payload = store ? data : deflated;
    const method = store ? 0 : 8;
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date } = dosTime();

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(list.length, 8);
  eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * The slice of the JSZip API that js/app.js uses. Deliberately no wider than
 * that: a test that starts depending on more of JSZip should be rewritten, not
 * served by a bigger shim.
 */
const JSZipShim = {
  async loadAsync(data) {
    const entries = readZip(Buffer.from(data));
    return {
      file(path) {
        if (!entries.has(path)) return null;
        const buf = entries.get(path);
        return {
          name: path,
          async async(kind) {
            if (kind === "string") return buf.toString("utf8");
            if (kind === "base64") return buf.toString("base64");
            if (kind === "uint8array") return new Uint8Array(buf);
            throw new Error(`zip shim: unsupported async kind ${kind}`);
          },
        };
      },
      names: () => [...entries.keys()],
    };
  },
};

module.exports = { readZip, writeZip, crc32, JSZipShim };
