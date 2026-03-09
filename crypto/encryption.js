/**
 * FreqLink AES-256-GCM encryption module.
 *
 * All encryption is client-side. The server never sees plaintext.
 * Each message uses a unique 12-byte random IV.
 */

import crypto from 'crypto';
import { CRYPTO } from '../shared/constants.js';
import { randomBytes, wipeBuffer } from './utils.js';

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * Returns a Buffer in the format: [IV (12 bytes)] [authTag (16 bytes)] [ciphertext]
 *
 * @param {Buffer|string} plaintext - Data to encrypt.
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {Buffer} Encrypted payload.
 */
export function encrypt(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== CRYPTO.KEY_BYTES) {
    throw new Error('Encryption key must be a 32-byte Buffer');
  }

  const iv = randomBytes(CRYPTO.IV_BYTES);
  const plaintextBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');

  const cipher = crypto.createCipheriv(CRYPTO.ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: IV | authTag | ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt an AES-256-GCM payload produced by `encrypt()`.
 *
 * @param {Buffer} payload - Encrypted payload [IV | authTag | ciphertext].
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {Buffer} Decrypted plaintext.
 * @throws {Error} If decryption fails (wrong key, tampered data, etc.)
 */
export function decrypt(payload, key) {
  if (!Buffer.isBuffer(key) || key.length !== CRYPTO.KEY_BYTES) {
    throw new Error('Decryption key must be a 32-byte Buffer');
  }

  const minLength = CRYPTO.IV_BYTES + CRYPTO.AUTH_TAG_BYTES + 1;
  if (!Buffer.isBuffer(payload) || payload.length < minLength) {
    throw new Error('Invalid payload: too short');
  }

  const iv = payload.slice(0, CRYPTO.IV_BYTES);
  const authTag = payload.slice(CRYPTO.IV_BYTES, CRYPTO.IV_BYTES + CRYPTO.AUTH_TAG_BYTES);
  const ciphertext = payload.slice(CRYPTO.IV_BYTES + CRYPTO.AUTH_TAG_BYTES);

  const decipher = crypto.createDecipheriv(CRYPTO.ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: authentication tag mismatch');
  }
}

/**
 * Encrypt and base64-encode a message for wire transmission.
 * @param {string} plaintext - Message to encrypt.
 * @param {Buffer} key - 32-byte session key.
 * @returns {string} Base64-encoded encrypted payload.
 */
export function encryptToBase64(plaintext, key) {
  const payload = encrypt(plaintext, key);
  const encoded = payload.toString('base64');
  wipeBuffer(payload);
  return encoded;
}

/**
 * Decode and decrypt a base64-encoded payload from the wire.
 * @param {string} base64Payload - Base64-encoded encrypted payload.
 * @param {Buffer} key - 32-byte session key.
 * @returns {string} Decrypted plaintext.
 * @throws {Error} If decryption fails.
 */
export function decryptFromBase64(base64Payload, key) {
  const payload = Buffer.from(base64Payload, 'base64');
  const plaintext = decrypt(payload, key);
  return plaintext.toString('utf8');
}
