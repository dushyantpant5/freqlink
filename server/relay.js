/**
 * FreqLink relay — in-memory frequency map and message routing.
 *
 * The relay is a dumb router. It never reads message contents.
 * All payloads are opaque base64-encoded ciphertext.
 */

import { MessageType, serialize } from '../shared/protocol.js';

/**
 * Create a new relay instance.
 *
 * @returns {object} Relay with join, leave, broadcast, and query methods.
 */
export function createRelay() {
  /**
   * In-memory frequency map.
   * @type {Map<string, Set<PeerInfo>>}
   *
   * @typedef {object} PeerInfo
   * @property {import('ws').WebSocket} socket
   * @property {string} peerId       - UUID assigned at connection
   * @property {string} peerName     - Human-readable peer name
   * @property {string} publicKey    - Base64 ECDH public key
   * @property {number} joinedAt     - Unix timestamp ms
   */
  const frequencies = new Map();

  /**
   * Peer → frequency reverse index for O(1) leave operations.
   * @type {Map<string, string>}  peerId → frequency
   */
  const peerFrequency = new Map();

  /**
   * Join a frequency. Sends peer_list to the joining peer
   * and peer_joined to all existing peers.
   *
   * @param {PeerInfo} peer
   * @param {string} frequency
   * @param {number} maxPeers
   * @returns {{ success: boolean, error?: string, code?: string }}
   */
  function join(peer, frequency, maxPeers) {
    // Check if already on a frequency
    if (peerFrequency.has(peer.peerId)) {
      const current = peerFrequency.get(peer.peerId);
      return {
        success: false,
        error: `Already on frequency ${current}. Use /leave first.`,
        code: 'ALREADY_ON_FREQUENCY',
      };
    }

    // Get or create frequency bucket
    if (!frequencies.has(frequency)) {
      frequencies.set(frequency, new Set());
    }
    const bucket = frequencies.get(frequency);

    // Check capacity
    if (bucket.size >= maxPeers) {
      return {
        success: false,
        error: `Frequency ${frequency} is at capacity (${maxPeers} peers)`,
        code: 'FREQUENCY_FULL',
      };
    }

    // Send current peer list to the joining peer
    const currentPeers = [];
    for (const p of bucket) {
      currentPeers.push({ peerName: p.peerName, publicKey: p.publicKey });
    }
    safeSend(peer.socket, serialize({
      type: MessageType.PEER_LIST,
      peers: currentPeers,
    }));

    // Notify existing peers about the new join
    for (const p of bucket) {
      safeSend(p.socket, serialize({
        type: MessageType.PEER_JOINED,
        peerName: peer.peerName,
        publicKey: peer.publicKey,
      }));
    }

    // Add peer to bucket
    bucket.add(peer);
    peerFrequency.set(peer.peerId, frequency);

    return { success: true };
  }

  /**
   * Remove a peer from their current frequency.
   * Notifies remaining peers of the departure.
   *
   * @param {string} peerId
   * @returns {boolean} True if the peer was on a frequency.
   */
  function leave(peerId) {
    const frequency = peerFrequency.get(peerId);
    if (!frequency) return false;

    const bucket = frequencies.get(frequency);
    if (!bucket) return false;

    let leavingPeer = null;
    for (const p of bucket) {
      if (p.peerId === peerId) {
        leavingPeer = p;
        break;
      }
    }

    if (!leavingPeer) return false;

    bucket.delete(leavingPeer);
    peerFrequency.delete(peerId);

    // Clean up empty frequency buckets
    if (bucket.size === 0) {
      frequencies.delete(frequency);
    } else {
      // Notify remaining peers
      for (const p of bucket) {
        safeSend(p.socket, serialize({
          type: MessageType.PEER_LEFT,
          peerName: leavingPeer.peerName,
        }));
      }
    }

    return true;
  }

  /**
   * Broadcast a message to all peers on a frequency except the sender.
   *
   * @param {string} senderPeerId
   * @param {object} message - Message object to broadcast.
   * @returns {boolean} True if the sender was on a frequency.
   */
  function broadcast(senderPeerId, message) {
    const frequency = peerFrequency.get(senderPeerId);
    if (!frequency) return false;

    const bucket = frequencies.get(frequency);
    if (!bucket) return false;

    const raw = serialize(message);
    for (const p of bucket) {
      if (p.peerId !== senderPeerId) {
        safeSend(p.socket, raw);
      }
    }

    return true;
  }

  /**
   * Send a message to a specific named peer (direct message).
   *
   * @param {string} senderPeerId
   * @param {string} targetPeerName
   * @param {object} message
   * @returns {{ success: boolean, error?: string }}
   */
  function sendDirect(senderPeerId, targetPeerName, message) {
    const frequency = peerFrequency.get(senderPeerId);
    if (!frequency) return { success: false, error: 'Not on a frequency' };

    const bucket = frequencies.get(frequency);
    if (!bucket) return { success: false, error: 'Frequency not found' };

    let targetPeer = null;
    let senderPeer = null;
    for (const p of bucket) {
      if (p.peerName === targetPeerName) targetPeer = p;
      if (p.peerId === senderPeerId) senderPeer = p;
    }

    if (!senderPeer) return { success: false, error: 'Sender not found on frequency' };
    if (!targetPeer) return { success: false, error: `Peer "${targetPeerName}" not found on this frequency` };

    safeSend(targetPeer.socket, serialize(message));
    return { success: true };
  }

  /**
   * Get the list of peers on a frequency (by peer ID).
   *
   * @param {string} peerId
   * @returns {Array<{ peerName: string, publicKey: string }>}
   */
  function getPeers(peerId) {
    const frequency = peerFrequency.get(peerId);
    if (!frequency) return [];

    const bucket = frequencies.get(frequency);
    if (!bucket) return [];

    return Array.from(bucket).map((p) => ({
      peerName: p.peerName,
      publicKey: p.publicKey,
    }));
  }

  /**
   * Get the current frequency for a peer.
   * @param {string} peerId
   * @returns {string|null}
   */
  function getFrequency(peerId) {
    return peerFrequency.get(peerId) ?? null;
  }

  /**
   * Get total connection count across all frequencies.
   * @returns {number}
   */
  function totalConnections() {
    let count = 0;
    for (const bucket of frequencies.values()) {
      count += bucket.size;
    }
    return count;
  }

  /**
   * Relay a key_exchange message to a specific target peer.
   *
   * @param {string} senderPeerId
   * @param {string} targetPeerName
   * @param {object} message
   */
  function relayKeyExchange(senderPeerId, targetPeerName, message) {
    return sendDirect(senderPeerId, targetPeerName, message);
  }

  return {
    join,
    leave,
    broadcast,
    sendDirect,
    relayKeyExchange,
    getPeers,
    getFrequency,
    totalConnections,
  };
}

/**
 * Send data to a WebSocket, suppressing errors on closed connections.
 * @param {import('ws').WebSocket} ws
 * @param {string} data
 */
function safeSend(ws, data) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  } catch {
    // Ignore send errors on closed connections
  }
}
