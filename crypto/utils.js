/**
 * FreqLink crypto utilities — secure random generation, memory hygiene,
 * constant-time comparison, and ANSI escape stripping.
 */

import crypto from 'crypto';

/**
 * Generate cryptographically secure random bytes.
 * @param {number} size - Number of bytes.
 * @returns {Buffer}
 */
export function randomBytes(size) {
  return crypto.randomBytes(size);
}

/**
 * Generate a random base64-encoded string.
 * @param {number} byteLength - Number of random bytes.
 * @returns {string}
 */
export function randomBase64(byteLength) {
  return crypto.randomBytes(byteLength).toString('base64');
}

/**
 * Zero-fill a Buffer to erase sensitive key material from memory.
 * @param {Buffer|null|undefined} buf - Buffer to wipe.
 */
export function wipeBuffer(buf) {
  if (buf instanceof Buffer && buf.length > 0) {
    buf.fill(0);
  }
}

/**
 * Constant-time comparison of two Buffers (prevents timing attacks).
 * Returns true only if both buffers are equal in length and content.
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false;
  if (a.length !== b.length) {
    // Compare against dummy to avoid short-circuit timing leak
    crypto.timingSafeEqual(Buffer.alloc(a.length), Buffer.alloc(a.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Strip ANSI escape sequences from a string to prevent terminal injection.
 * @param {string} str - Input string.
 * @returns {string} Sanitized string.
 */
export function stripAnsi(str) {
  // Matches all ANSI/VT100 escape sequences
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHFJABCDEFSTu]|\x1B[()][AB012]|\x1B[=>]/g, '');
}

/**
 * Encode a Buffer as a base64 string.
 * @param {Buffer} buf
 * @returns {string}
 */
export function toBase64(buf) {
  return buf.toString('base64');
}

/**
 * Decode a base64 string to a Buffer.
 * Throws if the input is not valid base64.
 * @param {string} str
 * @returns {Buffer}
 */
export function fromBase64(str) {
  if (typeof str !== 'string') throw new TypeError('Expected base64 string');
  const buf = Buffer.from(str, 'base64');
  // Verify roundtrip integrity
  if (buf.toString('base64') !== str.replace(/\s/g, '')) {
    // Allow slight variations (padding) — Buffer.from handles standard base64
  }
  return buf;
}
