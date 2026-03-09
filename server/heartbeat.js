/**
 * FreqLink WebSocket heartbeat monitor.
 *
 * Sends periodic pings to all connected clients.
 * Terminates connections that fail to respond within the timeout window.
 */

import { SERVER } from '../shared/constants.js';
import { MessageType, serialize } from '../shared/protocol.js';

/**
 * Start the heartbeat monitor for a WebSocket server.
 *
 * @param {import('ws').WebSocketServer} wss - The WebSocket server instance.
 * @returns {{ stop: function }} Object with a stop method to halt the monitor.
 */
export function startHeartbeat(wss) {
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        // No pong received since last ping — terminate connection
        ws.terminate();
        continue;
      }

      ws.isAlive = false;
      try {
        ws.send(serialize({ type: MessageType.PING }));
      } catch {
        ws.terminate();
      }
    }
  }, SERVER.HEARTBEAT_INTERVAL);

  // Prevent the interval from keeping the process alive
  if (interval.unref) interval.unref();

  return {
    stop() {
      clearInterval(interval);
    },
  };
}

/**
 * Initialize heartbeat state for a new WebSocket connection.
 * Call this immediately after a new connection is accepted.
 *
 * @param {import('ws').WebSocket} ws - The WebSocket connection.
 */
export function initConnection(ws) {
  ws.isAlive = true;
}
