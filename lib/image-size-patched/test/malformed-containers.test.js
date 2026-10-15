'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const imageSize = require('..');

function buffer(text, length = 16) {
  const bytes = new Uint8Array(length);
  bytes.set(Buffer.from(text));
  return bytes;
}

test('rejects zero-length ICNS entry without looping', () => {
  const input = buffer('icns', 16);
  input[7] = 16; // declared file length
  input.set(Buffer.from('ICON'), 8);
  assert.throws(() => imageSize(input), /malformed/);
});

test('rejects zero-length HEIF box without looping', () => {
  const input = buffer('\0\0\0\0ftypmif1', 16);
  assert.throws(() => imageSize(input), /malformed/);
});

test('rejects zero-length JXL box without looping', () => {
  const input = buffer('\0\0\0\0JXL ', 16);
  assert.throws(() => imageSize(input), /malformed/);
});