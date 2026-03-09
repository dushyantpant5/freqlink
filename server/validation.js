/**
 * FreqLink server-side input validation.
 *
 * All incoming messages are validated before processing.
 * The server never trusts client input.
 */

import { FREQUENCY, PEER, MESSAGE, BURN } from '../shared/constants.js';
import { ErrorCode } from '../shared/protocol.js';

/**
 * Validate a frequency string.
 * Must match NNN.NN format (e.g., "145.80") and be within allowed range.
 *
 * @param {string} freq - Frequency string to validate.
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
export function validateFrequency(freq) {
  if (typeof freq !== 'string') {
    return { valid: false, error: 'Frequency must be a string', code: ErrorCode.INVALID_FREQUENCY };
  }
  if (!FREQUENCY.REGEX.test(freq)) {
    return {
      valid: false,
      error: `Invalid frequency format. Use NNN.NN (e.g., ${FREQUENCY.FORMAT_EXAMPLE})`,
      code: ErrorCode.INVALID_FREQUENCY,
    };
  }
  const val = parseFloat(freq);
  if (val < FREQUENCY.MIN || val > FREQUENCY.MAX) {
    return {
      valid: false,
      error: `Frequency must be between 001.00 and 999.99`,
      code: ErrorCode.INVALID_FREQUENCY,
    };
  }
  return { valid: true };
}

/**
 * Validate a peer name.
 * Must be alphanumeric with hyphens, max 32 characters.
 *
 * @param {string} name - Peer name to validate.
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
export function validatePeerName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { valid: false, error: 'Peer name is required', code: ErrorCode.INVALID_PEER_NAME };
  }
  if (name.length > PEER.MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: `Peer name must be ${PEER.MAX_NAME_LENGTH} characters or fewer`,
      code: ErrorCode.INVALID_PEER_NAME,
    };
  }
  if (!PEER.NAME_REGEX.test(name)) {
    return {
      valid: false,
      error: 'Peer name may only contain letters, numbers, and hyphens',
      code: ErrorCode.INVALID_PEER_NAME,
    };
  }
  return { valid: true };
}

/**
 * Validate an encrypted payload string.
 * Must be a non-empty base64 string within size limits.
 *
 * @param {string} payload - Base64-encoded encrypted payload.
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePayload(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    return { valid: false, error: 'Payload is required' };
  }
  // Max encrypted payload: MESSAGE.MAX_LENGTH * 2 to account for base64 overhead and encryption overhead
  const maxEncryptedLength = MESSAGE.MAX_LENGTH * 2;
  if (payload.length > maxEncryptedLength) {
    return { valid: false, error: 'Payload exceeds maximum size' };
  }
  // Validate base64
  if (!/^[A-Za-z0-9+/]+=*$/.test(payload)) {
    return { valid: false, error: 'Payload must be valid base64' };
  }
  return { valid: true };
}

/**
 * Validate a burn message TTL value.
 * @param {number} ttl - TTL in seconds.
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTTL(ttl) {
  if (typeof ttl !== 'number' || !Number.isInteger(ttl)) {
    return { valid: false, error: 'TTL must be an integer' };
  }
  if (ttl < BURN.MIN_TTL || ttl > BURN.MAX_TTL) {
    return {
      valid: false,
      error: `TTL must be between ${BURN.MIN_TTL} and ${BURN.MAX_TTL} seconds`,
    };
  }
  return { valid: true };
}

/**
 * Validate a join message.
 * @param {object} msg - Parsed message object.
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
export function validateJoinMessage(msg) {
  const freqResult = validateFrequency(msg.frequency);
  if (!freqResult.valid) return freqResult;

  const nameResult = validatePeerName(msg.peerName);
  if (!nameResult.valid) return nameResult;

  if (typeof msg.publicKey !== 'string' || msg.publicKey.length === 0) {
    return { valid: false, error: 'Public key is required' };
  }

  return { valid: true };
}
