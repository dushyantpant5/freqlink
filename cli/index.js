/**
 * FreqLink CLI entry point.
 *
 * Bootstraps the terminal interface, connects to the relay server,
 * and starts the interactive REPL session.
 */

import readline from 'readline';
import { createState } from './state.js';
import { createConnection } from './connection.js';
import { createCommandHandler } from './commands.js';
import { MessageType } from '../shared/protocol.js';
import { decryptFromBase64 } from '../crypto/encryption.js';
import { stripAnsi } from '../crypto/utils.js';
import {
  printBanner,
  printSystem,
  printWarning,
  printError,
  printMessage,
  printDM,
  printBurnMessage,
  printPeerJoined,
  printPeerLeft,
  printConsoleHeader,
  buildPrompt,
} from './ui.js';
import { PEER } from '../shared/constants.js';

const SERVER_URL = process.env.FREQLINK_SERVER ?? 'ws://localhost:3200';

// ─── Session state ────────────────────────────────────────────────────────────

const state = createState();

// ─── Readline interface ───────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  prompt: buildPrompt(null),
});

function setPrompt(frequency) {
  rl.setPrompt(buildPrompt(frequency));
}

// ─── Connection ───────────────────────────────────────────────────────────────

const connection = createConnection({
  serverUrl: SERVER_URL,
  onMessage: handleServerMessage,
  onOpen: () => {
    state.connected = true;
  },
  onClose: () => {
    state.connected = false;
    rl.prompt(true);
  },
});

// ─── Command handler ──────────────────────────────────────────────────────────

const cmdHandler = createCommandHandler({
  connection,
  state,
  setPrompt,
  quit: () => {
    rl.close();
    process.exit(0);
  },
});

// ─── Server message handler ───────────────────────────────────────────────────

async function handleServerMessage(msg) {
  switch (msg.type) {
    case MessageType.PING:
      // Respond to server pings
      try {
        connection.send({ type: MessageType.PONG });
      } catch {
        // Ignore
      }
      break;

    case MessageType.PEER_LIST:
      // Initial peer list on join — initiate key exchange with each existing peer
      for (const peer of (msg.peers ?? [])) {
        await cmdHandler.initiateKeyExchange(peer.peerName, peer.publicKey);
      }
      // Show header after key exchange is initiated
      showHeader(msg.peers?.length ?? 0);
      break;

    case MessageType.PEER_JOINED: {
      const newPeer = msg.peerName;
      const newKey = msg.publicKey;
      state.peerPublicKeys.set(newPeer, newKey);
      await cmdHandler.initiateKeyExchange(newPeer, newKey);
      printPeerJoined(newPeer, state.verifiedPeers.has(newPeer), state.mismatchedPeers.has(newPeer));
      break;
    }

    case MessageType.PEER_LEFT:
      state.peerPublicKeys.delete(msg.peerName);
      const key = state.sessionKeys.get(msg.peerName);
      if (key) {
        const { wipeBuffer } = await import('../crypto/utils.js');
        wipeBuffer(key);
        state.sessionKeys.delete(msg.peerName);
      }
      state.verifiedPeers.delete(msg.peerName);
      state.mismatchedPeers.delete(msg.peerName);
      printPeerLeft(msg.peerName);
      break;

    case MessageType.MESSAGE:
      handleIncomingMessage(msg);
      break;

    case MessageType.DM:
      handleIncomingDM(msg);
      break;

    case MessageType.BURN:
      handleIncomingBurn(msg);
      break;

    case MessageType.KEY_EXCHANGE:
      await cmdHandler.handleKeyExchange(msg.from, msg.publicKey);
      break;

    case MessageType.KEY_VERIFY:
      await cmdHandler.handleKeyVerifyChallenge(msg.from, msg.nonce, msg.challenge);
      break;

    case MessageType.ERROR:
      printError(`Server: [${msg.code}] ${msg.message}`);
      break;

    case MessageType.SERVER_SHUTDOWN:
      printWarning(`Relay node shutting down: ${msg.message}`);
      state.leaveFrequency();
      setPrompt(null);
      break;

    default:
      break;
  }

  rl.prompt(true);
}

// ─── Incoming message handlers ────────────────────────────────────────────────

function handleIncomingMessage(msg) {
  const key = cmdHandler.getEffectiveKey(msg.from);
  if (!key) {
    printWarning(`Received message from ${msg.from} but no session key. Ignoring.`);
    return;
  }

  try {
    const plaintext = decryptFromBase64(msg.payload, key);
    const safe = stripAnsi(plaintext);
    printMessage(msg.from, safe);
  } catch {
    printWarning(`Could not decrypt message from ${msg.from}. Possible key mismatch.`);
  }
}

function handleIncomingDM(msg) {
  const key = cmdHandler.getEffectiveKey(msg.from);
  if (!key) {
    printWarning(`Received DM from ${msg.from} but no session key. Ignoring.`);
    return;
  }

  try {
    const plaintext = decryptFromBase64(msg.payload, key);
    const safe = stripAnsi(plaintext);
    printDM(msg.from, safe);
  } catch {
    printWarning(`Could not decrypt DM from ${msg.from}. Possible key mismatch.`);
  }
}

function handleIncomingBurn(msg) {
  const key = cmdHandler.getEffectiveKey(msg.from);
  if (!key) {
    printWarning(`Received burn from ${msg.from} but no session key. Ignoring.`);
    return;
  }

  try {
    const plaintext = decryptFromBase64(msg.payload, key);
    const safe = stripAnsi(plaintext);
    printBurnMessage(msg.from, safe, msg.ttl ?? 5);
  } catch {
    printWarning(`Could not decrypt burn message from ${msg.from}. Possible key mismatch.`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showHeader(existingPeerCount) {
  if (!state.frequency || !state.peerName) return;
  printConsoleHeader({
    peerName: state.peerName,
    frequency: state.frequency,
    peerCount: existingPeerCount + 1, // +1 for ourselves
    hasPassphrase: !!state.passphraseKey,
  });
}

// ─── Signal handling ──────────────────────────────────────────────────────────

async function cleanup(signal) {
  printSystem(`\nReceived ${signal}. Terminating session...`);

  if (state.frequency) {
    try {
      connection.send({ type: MessageType.LEAVE });
    } catch {
      // Ignore
    }
  }

  state.leaveFrequency();
  state.wipeKeys();
  connection.disconnect();

  printSystem('Session terminated. Keys purged.');
  process.exit(0);
}

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));

// Handle Ctrl+D (EOF on stdin)
rl.on('close', () => {
  cleanup('EOF');
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  // Prompt for peer name
  const peerName = await new Promise((resolve) => {
    rl.question(chalk_prompt('  Peer name: '), (answer) => {
      resolve(answer.trim());
    });
  });

  if (!peerName || !PEER.NAME_REGEX.test(peerName) || peerName.length > PEER.MAX_NAME_LENGTH) {
    printError('Invalid peer name. Use alphanumeric characters and hyphens only (max 32 chars).');
    process.exit(1);
  }

  state.peerName = peerName;

  console.log('');
  printSystem(`Identity set: ${peerName}`);
  printSystem(`Relay node: ${SERVER_URL}`);
  printSystem('Type /connect to connect, /help for commands.');
  console.log('');

  rl.prompt();

  rl.on('line', async (line) => {
    await cmdHandler.handle(line);
    rl.prompt();
  });
}

/**
 * Simple inline chalk-like cyan prompt (avoid importing chalk just for this).
 * @param {string} text
 * @returns {string}
 */
function chalk_prompt(text) {
  return `\x1b[36m${text}\x1b[0m`;
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
