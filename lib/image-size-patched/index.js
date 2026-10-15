'use strict';

// Compatibility implementation for the synchronous API used by Metro.  It is
// deliberately conservative for ISO containers: untrusted box lengths must
// always move the cursor forward and stay inside the supplied buffer.
const fs = require('fs');
const path = require('path');

const disabledTypes = new Set();
let fsDisabled = false;

function u16(input, offset) {
  return input[offset] * 0x100 + input[offset + 1];
}

function u32(input, offset) {
  return (input[offset] * 0x1000000) + (input[offset + 1] * 0x10000) +
    (input[offset + 2] * 0x100) + input[offset + 3];
}

function ascii(input, start, end) {
  return Buffer.from(input.slice(start, end)).toString('ascii');
}

function fail(type) {
  if (disabledTypes.has(type)) throw new TypeError(`disabled file type: ${type}`);
  throw new TypeError(`unsupported or malformed image type: ${type}`);
}

function png(input) {
  if (ascii(input, 1, 4) !== 'PNG' || ascii(input, 12, 16) !== 'IHDR') return;
  return { width: u32(input, 16), height: u32(input, 20), type: 'png' };
}

function gif(input) {
  if (ascii(input, 0, 3) !== 'GIF') return;
  return { width: u16(input, 6), height: u16(input, 8), type: 'gif' };
}

function jpeg(input) {
  if (input[0] !== 0xff || input[1] !== 0xd8) return;
  let offset = 2;
  while (offset + 9 < input.length) {
    if (input[offset] !== 0xff) return fail('jpg');
    const marker = input[offset + 1];
    const length = u16(input, offset + 2);
    if (length < 2 || offset + 2 + length > input.length) return fail('jpg');
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: u16(input, offset + 5), width: u16(input, offset + 7), type: 'jpg' };
    }
    offset += length + 2;
  }
  return fail('jpg');
}

function webp(input) {
  if (ascii(input, 0, 4) !== 'RIFF' || ascii(input, 8, 12) !== 'WEBP') return;
  const subtype = ascii(input, 12, 16);
  if (subtype === 'VP8X' && input.length >= 30) {
    return { width: 1 + input[24] + input[25] * 256 + input[26] * 65536, height: 1 + input[27] + input[28] * 256 + input[29] * 65536, type: 'webp' };
  }
  return fail('webp');
}

function findBox(input, name, start = 0) {
  let offset = start;
  while (offset < input.length) {
    if (input.length - offset < 8) return;
    const size = u32(input, offset);
    // ISO BMFF permits a zero length only as "to end of file", but image-size
    // previously treated it as a regular length and retried the same offset.
    if (size === 0 || size < 8 || size > input.length - offset) return;
    if (ascii(input, offset + 4, offset + 8) === name) return { offset, size };
    offset += size;
  }
}

function heif(input) {
  const ftyp = findBox(input, 'ftyp');
  if (!ftyp) return fail('heif');
  const brands = ['avif', 'mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx'];
  if (!brands.includes(ascii(input, ftyp.offset + 8, ftyp.offset + 12))) return fail('heif');
  const meta = findBox(input, 'meta');
  const iprp = meta && findBox(input, 'iprp', meta.offset + 12);
  const ipco = iprp && findBox(input, 'ipco', iprp.offset + 8);
  const ispe = ipco && findBox(input, 'ispe', ipco.offset + 8);
  if (!ispe || ispe.size < 20) return fail('heif');
  return { width: u32(input, ispe.offset + 12), height: u32(input, ispe.offset + 16), type: ascii(input, 8, 12) };
}

function guardedContainer(input, type) {
  let offset = 0;
  while (offset < input.length) {
    if (input.length - offset < 8) return fail(type);
    const size = u32(input, offset);
    if (size === 0 || size < 8 || size > input.length - offset) return fail(type);
    offset += size;
  }
  return fail(type);
}

function imageSize(input, callback) {
  if (typeof input === 'string') {
    if (fsDisabled) throw new TypeError('invalid invocation. input should be a Uint8Array');
    if (typeof callback === 'function') {
      fs.readFile(path.resolve(input), (error, data) => {
        if (error) return callback(error);
        try { callback(null, imageSize(data)); } catch (cause) { callback(cause); }
      });
      return;
    }
    input = fs.readFileSync(path.resolve(input));
  }
  if (!(input instanceof Uint8Array)) throw new TypeError('invalid invocation. input should be a Uint8Array');
  const value = png(input) || gif(input) || jpeg(input) || webp(input);
  if (value) {
    if (disabledTypes.has(value.type)) throw new TypeError(`disabled file type: ${value.type}`);
    return value;
  }
  if (ascii(input, 0, 4) === 'icns') return guardedContainer(input, 'icns');
  if (ascii(input, 4, 8) === 'ftyp') return heif(input);
  if (ascii(input, 4, 8) === 'JXL ') return guardedContainer(input, 'jxl');
  throw new TypeError('unsupported image type');
}

function disableFS(value) { fsDisabled = value; }
function disableTypes(types) { disabledTypes.clear(); types.forEach((type) => disabledTypes.add(type)); }
function setConcurrency() {}

module.exports = imageSize;
module.exports.default = imageSize;
module.exports.imageSize = imageSize;
module.exports.disableFS = disableFS;
module.exports.disableTypes = disableTypes;
module.exports.setConcurrency = setConcurrency;
module.exports.types = ['png', 'gif', 'jpg', 'webp'];