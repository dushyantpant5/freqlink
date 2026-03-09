/**
 * FreqLink ECDH key exchange module.
 *
 * Manages ephemeral key pair generation, public key export,
 * and shared secret computation for each frequency session.
 */

import crypto from 'crypto';
import { CRYPTO } from '../shared/constants.js';
import { wipeBuffer } from './utils.js';
import { deriveSessionKey } from './keyDerivation.js';

/**
 * Generate an ephemeral ECDH key pair for a new session.
 * Returns an object holding the private key handle and the exported public key.
 *
 * @returns {{ privateKey: KeyObject, publicKeyBase64: string }}
 */
export function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');

  // Export public key as raw 32-byte buffer (RFC 8410 SubjectPublicKeyInfo → raw)
  const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' });
  // X25519 SPKI is 44 bytes; raw key is the last 32 bytes
  const publicKeyBytes = publicKeyRaw.slice(-32);
  const publicKeyBase64 = publicKeyBytes.toString('base64');

  return { privateKey, publicKeyBase64 };
}

/**
 * Compute the ECDH shared secret from our private key and a peer's public key.
 * Then derive a session key using HKDF.
 *
 * @param {KeyObject} myPrivateKey - Our X25519 private key object.
 * @param {string} theirPublicKeyBase64 - Peer's raw public key (base64).
 * @param {string} frequency - Frequency string for HKDF info.
 * @returns {Buffer} 32-byte session key.
 * @throws {Error} If the peer's public key is invalid.
 */
export function computeSessionKey(myPrivateKey, theirPublicKeyBase64, frequency) {
  let theirPublicKeyBytes;
  try {
    theirPublicKeyBytes = Buffer.from(theirPublicKeyBase64, 'base64');
    if (theirPublicKeyBytes.length !== 32) {
      throw new Error('Invalid key length');
    }
  } catch {
    throw new Error('Invalid peer public key format');
  }

  // Reconstruct X25519 public key from raw bytes (wrap in SPKI DER)
  // X25519 SPKI prefix (12 bytes) + raw key (32 bytes) = 44 bytes total
  const spkiPrefix = Buffer.from(
    '302a300506032b656e032100',
    'hex'
  );
  const spkiDer = Buffer.concat([spkiPrefix, theirPublicKeyBytes]);
  const theirPublicKey = crypto.createPublicKey({ key: spkiDer, type: 'spki', format: 'der' });

  // Compute raw ECDH shared secret
  const sharedSecret = crypto.diffieHellman({
    privateKey: myPrivateKey,
    publicKey: theirPublicKey,
  });

  const sessionKey = deriveSessionKey(sharedSecret, frequency);

  // Wipe the intermediate shared secret
  wipeBuffer(sharedSecret);

  return sessionKey;
}
