/**
 * FreqLink shared constants — protocol limits, defaults, and validation rules.
 * Used by both client and server.
 */

export const FREQUENCY = {
  MIN: 1.0,
  MAX: 999.99,
  REGEX: /^\d{3}\.\d{2}$/,
  FORMAT_EXAMPLE: '145.80',
};

export const PEER = {
  MAX_NAME_LENGTH: 32,
  NAME_REGEX: /^[a-zA-Z0-9-]+$/,
};

export const MESSAGE = {
  MAX_LENGTH: 4096,
};

export const BURN = {
  DEFAULT_TTL: 5,
  MAX_TTL: 30,
  MIN_TTL: 1,
};

export const SERVER = {
  DEFAULT_PORT: 3200,
  MAX_PEERS_PER_FREQ: 50,
  HEARTBEAT_INTERVAL: 30000,
  HEARTBEAT_TIMEOUT: 10000,
};

export const RATE_LIMIT = {
  MESSAGE_MAX: 30,
  MESSAGE_WINDOW: 10000,
  JOIN_MAX: 5,
  JOIN_WINDOW: 30000,
};

export const RECONNECT = {
  MAX_ATTEMPTS: 5,
  INITIAL_DELAY: 1000,
  MAX_DELAY: 30000,
};

export const CRYPTO = {
  IV_BYTES: 12,
  KEY_BYTES: 32,
  AUTH_TAG_BYTES: 16,
  ALGORITHM: 'aes-256-gcm',
  CURVE: 'X25519',
  HKDF_HASH: 'sha256',
  SCRYPT_N: 16384,
  SCRYPT_R: 8,
  SCRYPT_P: 1,
  HKDF_SALT: 'freqlink-session',
};
