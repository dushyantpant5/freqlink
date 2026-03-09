/**
 * FreqLink wire protocol — message type definitions and serialization helpers.
 *
 * All messages are JSON objects transmitted over WebSocket.
 * The server relays encrypted payloads opaquely — it never reads content.
 */

export const MessageType = Object.freeze({
  // Client → Server
  JOIN: 'join',
  LEAVE: 'leave',
  MESSAGE: 'message',
  DM: 'dm',
  BURN: 'burn',
  KEY_EXCHANGE: 'key_exchange',
  KEY_VERIFY: 'key_verify',
  PONG: 'pong',

  // Server → Client
  PEER_JOINED: 'peer_joined',
  PEER_LEFT: 'peer_left',
  PEER_LIST: 'peer_list',
  ERROR: 'error',
  SERVER_SHUTDOWN: 'server_shutdown',
  PING: 'ping',
});

export const ErrorCode = Object.freeze({
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_FREQUENCY: 'INVALID_FREQUENCY',
  ALREADY_ON_FREQUENCY: 'ALREADY_ON_FREQUENCY',
  NOT_ON_FREQUENCY: 'NOT_ON_FREQUENCY',
  FREQUENCY_FULL: 'FREQUENCY_FULL',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  PEER_NOT_FOUND: 'PEER_NOT_FOUND',
  INVALID_PEER_NAME: 'INVALID_PEER_NAME',
});

/**
 * Serialize a protocol message to a JSON string.
 * @param {object} msg - The message object to serialize.
 * @returns {string} JSON string.
 */
export function serialize(msg) {
  return JSON.stringify(msg);
}

/**
 * Parse and validate a raw WebSocket message string.
 * Returns null if the message is malformed.
 * @param {string} raw - Raw string from WebSocket.
 * @returns {object|null}
 */
export function parse(raw) {
  if (typeof raw !== 'string' || raw.length > 65536) return null;
  try {
    const msg = JSON.parse(raw);
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
    if (typeof msg.type !== 'string') return null;
    return msg;
  } catch {
    return null;
  }
}
