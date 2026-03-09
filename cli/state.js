/**
 * FreqLink client session state.
 *
 * Holds the current peer identity, frequency, session keys, and peer map.
 * All keys are in-memory only — never written to disk.
 */

import { wipeBuffer } from '../crypto/utils.js';

/**
 * Create a new session state object.
 * @returns {SessionState}
 *
 * @typedef {object} SessionState
 * @property {string|null} peerName        - Local peer's name
 * @property {string|null} frequency       - Current frequency
 * @property {object|null} privateKey      - ECDH private key (KeyObject)
 * @property {string|null} publicKeyBase64 - Our public key (base64)
 * @property {Buffer|null} passphraseKey   - Derived passphrase key (if --key used)
 * @property {Map<string,Buffer>} sessionKeys  - peerName → session key
 * @property {Map<string,string>} peerPublicKeys - peerName → public key (base64)
 * @property {Set<string>} verifiedPeers   - Peer names that passed key verification
 * @property {Set<string>} mismatchedPeers - Peer names that failed key verification
 * @property {boolean} connected           - WebSocket connection status
 */
export function createState() {
  return {
    peerName: null,
    frequency: null,
    privateKey: null,
    publicKeyBase64: null,
    passphraseKey: null,
    /** @type {Map<string, Buffer>} */
    sessionKeys: new Map(),
    /** @type {Map<string, string>} */
    peerPublicKeys: new Map(),
    /** @type {Set<string>} */
    verifiedPeers: new Set(),
    /** @type {Set<string>} */
    mismatchedPeers: new Set(),
    connected: false,

    /**
     * Store a session key for a peer. Wipes the old key if present.
     * @param {string} peerName
     * @param {Buffer} key
     */
    setSessionKey(peerName, key) {
      const existing = this.sessionKeys.get(peerName);
      if (existing) wipeBuffer(existing);
      this.sessionKeys.set(peerName, key);
    },

    /**
     * Retrieve the session key for a peer.
     * @param {string} peerName
     * @returns {Buffer|null}
     */
    getSessionKey(peerName) {
      return this.sessionKeys.get(peerName) ?? null;
    },

    /**
     * Wipe all cryptographic material from memory.
     * Call on /leave and /quit.
     */
    wipeKeys() {
      for (const key of this.sessionKeys.values()) {
        wipeBuffer(key);
      }
      this.sessionKeys.clear();

      if (this.passphraseKey) {
        wipeBuffer(this.passphraseKey);
        this.passphraseKey = null;
      }

      this.privateKey = null;
      this.publicKeyBase64 = null;
      this.peerPublicKeys.clear();
      this.verifiedPeers.clear();
      this.mismatchedPeers.clear();
    },

    /**
     * Reset frequency-specific state (but keep connection).
     */
    leaveFrequency() {
      this.wipeKeys();
      this.frequency = null;
    },
  };
}
