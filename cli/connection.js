/**
 * FreqLink WebSocket client connection manager.
 *
 * Handles connection lifecycle, reconnection with exponential backoff,
 * and message dispatching.
 */

import { WebSocket } from 'ws';
import { parse, serialize } from '../shared/protocol.js';
import { RECONNECT } from '../shared/constants.js';
import { printWarning, printError, printSystem } from './ui.js';

/**
 * Create a connection manager.
 *
 * @param {object} opts
 * @param {string} opts.serverUrl - WebSocket server URL.
 * @param {function(object): void} opts.onMessage - Called with parsed messages.
 * @param {function(): void} opts.onOpen - Called when connection is established.
 * @param {function(): void} opts.onClose - Called on unexpected close.
 * @returns {ConnectionManager}
 *
 * @typedef {object} ConnectionManager
 * @property {function(): Promise<void>} connect
 * @property {function(object): void} send
 * @property {function(): void} disconnect
 * @property {function(): boolean} isConnected
 */
export function createConnection({ serverUrl, onMessage, onOpen, onClose }) {
  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let intentionalClose = false;
  let isOpen = false;

  /**
   * Attempt to connect to the relay server.
   * @returns {Promise<void>} Resolves when connected, rejects on failure.
   */
  function connect() {
    return new Promise((resolve, reject) => {
      intentionalClose = false;

      try {
        ws = new WebSocket(serverUrl);
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${err.message}`));
        return;
      }

      ws.once('open', () => {
        isOpen = true;
        reconnectAttempts = 0;
        onOpen();
        resolve();
      });

      ws.once('error', (err) => {
        if (!isOpen) {
          reject(new Error(`Connection failed: ${err.message}`));
        }
      });

      ws.on('message', (data) => {
        const raw = data.toString('utf8');
        const msg = parse(raw);
        if (msg) {
          onMessage(msg);
        }
      });

      ws.on('close', () => {
        isOpen = false;
        onClose();

        if (!intentionalClose) {
          scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        if (isOpen) {
          printWarning(`Connection error: ${err.message}`);
        }
      });
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  function scheduleReconnect() {
    if (reconnectAttempts >= RECONNECT.MAX_ATTEMPTS) {
      printError('Max reconnection attempts reached. Use /connect to retry manually.');
      return;
    }

    const delay = Math.min(
      RECONNECT.INITIAL_DELAY * Math.pow(2, reconnectAttempts),
      RECONNECT.MAX_DELAY
    );

    reconnectAttempts++;
    printWarning(`Connection lost. Reconnecting... (attempt ${reconnectAttempts}, ${delay / 1000}s)`);

    reconnectTimer = setTimeout(async () => {
      try {
        await connect();
        printSystem('Reconnected to relay node. Re-join frequency to resume.');
      } catch {
        scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Send a message to the server.
   * @param {object} msg - Message object to serialize and send.
   * @throws {Error} If not connected.
   */
  function send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to relay server. Use /connect first.');
    }
    ws.send(serialize(msg));
  }

  /**
   * Close the connection intentionally.
   */
  function disconnect() {
    intentionalClose = true;
    isOpen = false;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws) {
      try {
        ws.close();
      } catch {
        ws.terminate();
      }
      ws = null;
    }
  }

  /**
   * Check if the connection is currently open.
   * @returns {boolean}
   */
  function isConnected() {
    return isOpen && ws !== null && ws.readyState === WebSocket.OPEN;
  }

  return { connect, send, disconnect, isConnected };
}
