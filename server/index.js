/**
 * FreqLink relay server entry point.
 *
 * Responsibilities:
 *  - Accept WebSocket connections
 *  - Route encrypted messages between peers on the same frequency
 *  - Enforce rate limits and heartbeat keepalives
 *  - Expose GET /health for deployment monitoring
 *  - Never decrypt or store any message
 */

import http from 'http';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import { createRelay } from './relay.js';
import { createRateLimiter } from './rateLimiter.js';
import { startHeartbeat, initConnection } from './heartbeat.js';
import { validateJoinMessage, validatePayload, validateFrequency, validateTTL } from './validation.js';
import { parse, serialize, MessageType, ErrorCode } from '../shared/protocol.js';
import { SERVER } from '../shared/constants.js';

const PORT = parseInt(process.env.PORT ?? SERVER.DEFAULT_PORT, 10);
const MAX_PEERS_PER_FREQ = parseInt(process.env.MAX_PEERS_PER_FREQ ?? SERVER.MAX_PEERS_PER_FREQ, 10);

const startTime = Date.now();
const relay = createRelay();

// ─── HTTP Server (health check) ──────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      connections: wss?.clients?.size ?? 0,
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });
const heartbeatMonitor = startHeartbeat(wss);

wss.on('connection', (ws) => {
  const peerId = crypto.randomUUID();
  const rateLimiter = createRateLimiter();
  initConnection(ws);

  // Peer info — populated on JOIN
  let peerInfo = null;

  ws.on('message', (data) => {
    // Mark as alive (pong received implicitly via any message; ping is explicit)
    ws.isAlive = true;

    const raw = data.toString('utf8');
    const msg = parse(raw);

    if (!msg) {
      sendError(ws, 'INVALID_MESSAGE', 'Malformed message');
      return;
    }

    switch (msg.type) {
      case MessageType.PONG:
        ws.isAlive = true;
        break;

      case MessageType.JOIN:
        handleJoin(ws, peerId, rateLimiter, msg, (info) => { peerInfo = info; });
        break;

      case MessageType.LEAVE:
        handleLeave(ws, peerId, rateLimiter, peerInfo);
        peerInfo = null;
        break;

      case MessageType.MESSAGE:
        handleMessage(ws, peerId, rateLimiter, peerInfo, msg);
        break;

      case MessageType.DM:
        handleDM(ws, peerId, rateLimiter, peerInfo, msg);
        break;

      case MessageType.BURN:
        handleBurn(ws, peerId, rateLimiter, peerInfo, msg);
        break;

      case MessageType.KEY_EXCHANGE:
        handleKeyExchange(ws, peerId, peerInfo, msg);
        break;

      case MessageType.KEY_VERIFY:
        handleKeyVerify(ws, peerId, peerInfo, msg);
        break;

      default:
        sendError(ws, 'INVALID_MESSAGE', `Unknown message type: ${msg.type}`);
    }
  });

  ws.on('close', () => {
    relay.leave(peerId);
    rateLimiter.reset();
  });

  ws.on('error', () => {
    relay.leave(peerId);
  });
});

// ─── Message Handlers ─────────────────────────────────────────────────────────

function handleJoin(ws, peerId, rateLimiter, msg, setPeerInfo) {
  if (!rateLimiter.checkJoin()) {
    sendError(ws, ErrorCode.RATE_LIMITED, 'Too many join/leave operations. Wait before trying again.');
    return;
  }

  const validation = validateJoinMessage(msg);
  if (!validation.valid) {
    sendError(ws, validation.code ?? 'INVALID_MESSAGE', validation.error);
    return;
  }

  const peer = {
    socket: ws,
    peerId,
    peerName: msg.peerName,
    publicKey: msg.publicKey,
    joinedAt: Date.now(),
  };

  const result = relay.join(peer, msg.frequency, MAX_PEERS_PER_FREQ);

  if (!result.success) {
    sendError(ws, result.code ?? 'JOIN_FAILED', result.error);
    return;
  }

  setPeerInfo(peer);
}

function handleLeave(ws, peerId, rateLimiter, peerInfo) {
  if (!peerInfo) {
    sendError(ws, ErrorCode.NOT_ON_FREQUENCY, 'Not on a frequency');
    return;
  }

  if (!rateLimiter.checkJoin()) {
    sendError(ws, ErrorCode.RATE_LIMITED, 'Too many join/leave operations. Wait before trying again.');
    return;
  }

  relay.leave(peerId);
}

function handleMessage(ws, peerId, rateLimiter, peerInfo, msg) {
  if (!peerInfo) {
    sendError(ws, ErrorCode.NOT_ON_FREQUENCY, 'Not on a frequency');
    return;
  }

  if (!rateLimiter.checkMessage()) {
    sendError(ws, ErrorCode.RATE_LIMITED, 'Too many messages. Wait before sending again.');
    return;
  }

  const payloadValidation = validatePayload(msg.payload);
  if (!payloadValidation.valid) {
    sendError(ws, 'INVALID_MESSAGE', payloadValidation.error);
    return;
  }

  // If targetPeer is set, route only to that peer (per-pair encryption for 3+ peer groups).
  // Otherwise fall back to broadcast.
  if (typeof msg.targetPeer === 'string' && msg.targetPeer) {
    const result = relay.sendDirect(peerId, msg.targetPeer, {
      type: MessageType.MESSAGE,
      from: peerInfo.peerName,
      payload: msg.payload,
    });
    if (!result.success) {
      sendError(ws, ErrorCode.PEER_NOT_FOUND, result.error);
    }
  } else {
    relay.broadcast(peerId, {
      type: MessageType.MESSAGE,
      from: peerInfo.peerName,
      payload: msg.payload,
    });
  }
}

function handleDM(ws, peerId, rateLimiter, peerInfo, msg) {
  if (!peerInfo) {
    sendError(ws, ErrorCode.NOT_ON_FREQUENCY, 'Not on a frequency');
    return;
  }

  if (!rateLimiter.checkMessage()) {
    sendError(ws, ErrorCode.RATE_LIMITED, 'Too many messages. Wait before sending again.');
    return;
  }

  if (typeof msg.target !== 'string' || !msg.target) {
    sendError(ws, 'INVALID_MESSAGE', 'DM target is required');
    return;
  }

  const payloadValidation = validatePayload(msg.payload);
  if (!payloadValidation.valid) {
    sendError(ws, 'INVALID_MESSAGE', payloadValidation.error);
    return;
  }

  const result = relay.sendDirect(peerId, msg.target, {
    type: MessageType.DM,
    from: peerInfo.peerName,
    payload: msg.payload,
  });

  if (!result.success) {
    sendError(ws, ErrorCode.PEER_NOT_FOUND, result.error);
  }
}

function handleBurn(ws, peerId, rateLimiter, peerInfo, msg) {
  if (!peerInfo) {
    sendError(ws, ErrorCode.NOT_ON_FREQUENCY, 'Not on a frequency');
    return;
  }

  if (!rateLimiter.checkMessage()) {
    sendError(ws, ErrorCode.RATE_LIMITED, 'Too many messages. Wait before sending again.');
    return;
  }

  const payloadValidation = validatePayload(msg.payload);
  if (!payloadValidation.valid) {
    sendError(ws, 'INVALID_MESSAGE', payloadValidation.error);
    return;
  }

  const ttl = typeof msg.ttl === 'number' ? msg.ttl : 5;
  const ttlValidation = validateTTL(ttl);
  if (!ttlValidation.valid) {
    sendError(ws, 'INVALID_MESSAGE', ttlValidation.error);
    return;
  }

  if (typeof msg.targetPeer === 'string' && msg.targetPeer) {
    relay.sendDirect(peerId, msg.targetPeer, {
      type: MessageType.BURN,
      from: peerInfo.peerName,
      payload: msg.payload,
      ttl,
    });
  } else {
    relay.broadcast(peerId, {
      type: MessageType.BURN,
      from: peerInfo.peerName,
      payload: msg.payload,
      ttl,
    });
  }
}

function handleKeyExchange(ws, peerId, peerInfo, msg) {
  if (!peerInfo) {
    sendError(ws, ErrorCode.NOT_ON_FREQUENCY, 'Not on a frequency');
    return;
  }

  if (typeof msg.target !== 'string' || !msg.target || typeof msg.publicKey !== 'string') {
    sendError(ws, 'INVALID_MESSAGE', 'key_exchange requires target and publicKey');
    return;
  }

  const result = relay.relayKeyExchange(peerId, msg.target, {
    type: MessageType.KEY_EXCHANGE,
    from: peerInfo.peerName,
    publicKey: msg.publicKey,
  });

  if (!result.success) {
    sendError(ws, ErrorCode.PEER_NOT_FOUND, result.error);
  }
}

function handleKeyVerify(ws, peerId, peerInfo, msg) {
  if (!peerInfo) {
    sendError(ws, ErrorCode.NOT_ON_FREQUENCY, 'Not on a frequency');
    return;
  }

  if (typeof msg.target !== 'string' || !msg.target) {
    sendError(ws, 'INVALID_MESSAGE', 'key_verify requires target');
    return;
  }

  const result = relay.sendDirect(peerId, msg.target, {
    type: MessageType.KEY_VERIFY,
    from: peerInfo.peerName,
    nonce: msg.nonce,
    challenge: msg.challenge,
  });

  if (!result.success) {
    sendError(ws, ErrorCode.PEER_NOT_FOUND, result.error);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Send an error message to a client.
 * @param {import('ws').WebSocket} ws
 * @param {string} code
 * @param {string} message
 */
function sendError(ws, code, message) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(serialize({ type: MessageType.ERROR, code, message }));
    }
  } catch {
    // Ignore
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down relay node...`);

  heartbeatMonitor.stop();

  // Notify all connected clients
  const shutdownMsg = serialize({
    type: MessageType.SERVER_SHUTDOWN,
    message: 'Relay node shutting down',
  });

  for (const ws of wss.clients) {
    try {
      ws.send(shutdownMsg);
      ws.close();
    } catch {
      ws.terminate();
    }
  }

  httpServer.close(() => {
    console.log('Relay node offline.');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`FreqLink relay node online — port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
