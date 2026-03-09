/**
 * FreqLink key derivation module.
 *
 * Provides HKDF for session key derivation from ECDH shared secrets,
 * and scrypt for passphrase-based key derivation.
 */

import crypto from 'crypto';
import { CRYPTO } from '../shared/constants.js';
import { wipeBuffer } from './utils.js';

/**
 * Derive a session key from an ECDH shared secret using HKDF.
 *
 * @param {Buffer} sharedSecret - Raw ECDH shared secret.
 * @param {string} frequency - Frequency string (used as HKDF info).
 * @returns {Buffer} 32-byte derived session key.
 */
export function deriveSessionKey(sharedSecret, frequency) {
  const salt = Buffer.from(CRYPTO.HKDF_SALT, 'utf8');
  const info = Buffer.from(`freqlink-${frequency}`, 'utf8');

  return crypto.hkdfSync(
    CRYPTO.HKDF_HASH,
    sharedSecret,
    salt,
    info,
    CRYPTO.KEY_BYTES
  );
}

/**
 * Derive an encryption key from a user passphrase using scrypt.
 * Uses the frequency as a salt component for domain separation.
 *
 * @param {string} passphrase - User-provided secret passphrase.
 * @param {string} frequency - Frequency string (salt component).
 * @returns {Buffer} 32-byte derived key.
 */
export function derivePassphraseKey(passphrase, frequency) {
  // Derive salt from frequency using SHA-256 for consistent length
  const salt = crypto.createHash('sha256').update(frequency).digest();

  return crypto.scryptSync(passphrase, salt, CRYPTO.KEY_BYTES, {
    N: CRYPTO.SCRYPT_N,
    r: CRYPTO.SCRYPT_R,
    p: CRYPTO.SCRYPT_P,
  });
}

/**
 * Combine a session key and a passphrase-derived key into a single key
 * using HKDF. This allows both ECDH and passphrase encryption in a single
 * AES-GCM operation.
 *
 * @param {Buffer} sessionKey - ECDH-derived session key.
 * @param {Buffer} passphraseKey - scrypt-derived passphrase key.
 * @param {string} frequency - Frequency for domain separation.
 * @returns {Buffer} 32-byte combined key.
 */
export function combineKeys(sessionKey, passphraseKey, frequency) {
  // XOR the two keys, then run through HKDF for proper mixing
  const xored = Buffer.alloc(CRYPTO.KEY_BYTES);
  for (let i = 0; i < CRYPTO.KEY_BYTES; i++) {
    xored[i] = sessionKey[i] ^ passphraseKey[i];
  }

  const info = Buffer.from(`freqlink-combined-${frequency}`, 'utf8');
  const salt = Buffer.from('freqlink-combined', 'utf8');

  const combined = crypto.hkdfSync(
    CRYPTO.HKDF_HASH,
    xored,
    salt,
    info,
    CRYPTO.KEY_BYTES
  );

  wipeBuffer(xored);
  return combined;
}

/**
 * Compute an HMAC-SHA256 challenge for zero-knowledge key verification.
 *
 * @param {Buffer} key - The derived passphrase key.
 * @param {Buffer} nonce - Random nonce.
 * @returns {Buffer} HMAC challenge bytes.
 */
export function computeKeyChallenge(key, nonce) {
  return crypto.createHmac('sha256', key).update(nonce).digest();
}
