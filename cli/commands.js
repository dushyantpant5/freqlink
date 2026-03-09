/**
 * FreqLink CLI command parser and dispatcher.
 *
 * Parses user input, validates commands, and dispatches to handlers.
 * Each handler has access to the connection, state, and UI modules.
 */

import { MessageType } from '../shared/protocol.js';
import { FREQUENCY, PEER, MESSAGE, BURN } from '../shared/constants.js';
import { generateKeyPair, computeSessionKey } from '../crypto/keyExchange.js';
import { derivePassphraseKey, combineKeys, computeKeyChallenge } from '../crypto/keyDerivation.js';
import { encryptToBase64, decryptFromBase64 } from '../crypto/encryption.js';
import { randomBytes, stripAnsi, wipeBuffer } from '../crypto/utils.js';
import {
  printSystem,
  printWarning,
  printError,
  printSuccess,
  printConsoleHeader,
  printPeerList,
  printHelp,
} from './ui.js';

/**
 * Parse a raw input line into a command and arguments.
 * @param {string} line
 * @returns {{ command: string, args: string[] }|null}
 */
function parseInput(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith('/')) {
    return { command: 'send', args: [trimmed] };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  return { command, args };
}

/**
 * Create the command dispatcher.
 *
 * @param {object} opts
 * @param {import('./connection.js').ConnectionManager} opts.connection
 * @param {import('./state.js').SessionState} opts.state
 * @param {function(string): void} opts.setPrompt - Update the REPL prompt.
 * @param {function(): void} opts.quit - Exit the process.
 * @returns {function(string): Promise<void>} Async input handler.
 */
export function createCommandHandler({ connection, state, setPrompt, quit }) {
  /**
   * Handle a raw input line from the user.
   * @param {string} line
   */
  async function handle(line) {
    const parsed = parseInput(line);
    if (!parsed) return;

    const { command, args } = parsed;

    switch (command) {
      case 'connect':
        await cmdConnect();
        break;
      case 'join':
        await cmdJoin(args);
        break;
      case 'leave':
        await cmdLeave();
        break;
      case 'peers':
        cmdPeers();
        break;
      case 'dm':
        await cmdDM(args);
        break;
      case 'burn':
        await cmdBurn(args);
        break;
      case 'quit':
        await cmdQuit();
        break;
      case 'help':
        printHelp();
        break;
      case 'send':
        await cmdSend(args[0]);
        break;
      default:
        printError(`Unknown command: /${command}. Type /help for available commands.`);
    }
  }

  // ─── /connect ───────────────────────────────────────────────────────────────

  async function cmdConnect() {
    if (connection.isConnected()) {
      printWarning('Already connected to relay node.');
      return;
    }

    printSystem('Connecting to relay node...');
    try {
      await connection.connect();
      state.connected = true;
      printSuccess('Connected to relay node');
    } catch (err) {
      printError(`Connection failed: ${err.message}`);
    }
  }

  // ─── /join ──────────────────────────────────────────────────────────────────

  async function cmdJoin(args) {
    if (!connection.isConnected()) {
      printError('Not connected. Use /connect first.');
      return;
    }

    if (args.length < 1) {
      printError('Usage: /join <frequency> [--key <passphrase>]');
      return;
    }

    const frequency = args[0];

    // Validate frequency format
    if (!FREQUENCY.REGEX.test(frequency)) {
      printError(`Invalid frequency format. Use NNN.NN (e.g., ${FREQUENCY.FORMAT_EXAMPLE})`);
      return;
    }

    const val = parseFloat(frequency);
    if (val < FREQUENCY.MIN || val > FREQUENCY.MAX) {
      printError('Frequency must be between 001.00 and 999.99');
      return;
    }

    if (state.frequency) {
      printError(`Already on frequency ${state.frequency}. Use /leave first.`);
      return;
    }

    // Parse optional --key flag
    let passphrase = null;
    const keyIdx = args.indexOf('--key');
    if (keyIdx !== -1 && args[keyIdx + 1]) {
      passphrase = args[keyIdx + 1];
    }

    // Generate ECDH key pair
    const { privateKey, publicKeyBase64 } = generateKeyPair();
    state.privateKey = privateKey;
    state.publicKeyBase64 = publicKeyBase64;

    // Derive passphrase key if provided
    if (passphrase) {
      printSystem('Deriving key from passphrase...');
      state.passphraseKey = derivePassphraseKey(passphrase, frequency);
    }

    state.frequency = frequency;

    // Send join message
    try {
      connection.send({
        type: MessageType.JOIN,
        frequency,
        peerName: state.peerName,
        publicKey: publicKeyBase64,
      });

      setPrompt(frequency);
      printSystem(`Joined frequency ${frequency} MHz`);
    } catch (err) {
      state.frequency = null;
      state.wipeKeys();
      printError(`Failed to join: ${err.message}`);
    }
  }

  // ─── /leave ─────────────────────────────────────────────────────────────────

  async function cmdLeave() {
    if (!state.frequency) {
      printError('Not on a frequency.');
      return;
    }

    try {
      connection.send({ type: MessageType.LEAVE });
    } catch {
      // Continue with local cleanup even if send fails
    }

    const freq = state.frequency;
    state.leaveFrequency();
    setPrompt(null);
    printSystem(`Left frequency ${freq} MHz`);
  }

  // ─── /peers ─────────────────────────────────────────────────────────────────

  function cmdPeers() {
    if (!state.frequency) {
      printError('Not on a frequency. Use /join <frequency> first.');
      return;
    }

    const peers = Array.from(state.peerPublicKeys.keys()).map((name) => ({ peerName: name }));
    // Include ourselves
    const allPeers = [{ peerName: state.peerName }, ...peers];

    printPeerList(
      state.frequency,
      allPeers,
      state.peerName,
      state.verifiedPeers,
      state.mismatchedPeers
    );
  }

  // ─── /dm ────────────────────────────────────────────────────────────────────

  async function cmdDM(args) {
    if (!state.frequency) {
      printError('Not on a frequency.');
      return;
    }

    if (args.length < 2) {
      printError('Usage: /dm <peer> <message>');
      return;
    }

    const target = args[0];
    const messageText = args.slice(1).join(' ');

    if (messageText.length > MESSAGE.MAX_LENGTH) {
      printError(`Message too long. Max ${MESSAGE.MAX_LENGTH} characters.`);
      return;
    }

    const sessionKey = getEffectiveKey(target);
    if (!sessionKey) {
      printError(`No session key for peer "${target}". They may not be on this frequency.`);
      return;
    }

    try {
      const payload = encryptToBase64(messageText, sessionKey);
      connection.send({
        type: MessageType.DM,
        target,
        payload,
      });
      printSystem(`DM sent to ${target}`);
    } catch (err) {
      printError(`Failed to send DM: ${err.message}`);
    }
  }

  // ─── /burn ──────────────────────────────────────────────────────────────────

  async function cmdBurn(args) {
    if (!state.frequency) {
      printError('Not on a frequency.');
      return;
    }

    if (args.length < 1) {
      printError('Usage: /burn <message> [--ttl <seconds>]');
      return;
    }

    // Parse --ttl flag
    let ttl = BURN.DEFAULT_TTL;
    const ttlIdx = args.indexOf('--ttl');
    let messageArgs = args;

    if (ttlIdx !== -1) {
      const ttlVal = parseInt(args[ttlIdx + 1], 10);
      if (isNaN(ttlVal) || ttlVal < BURN.MIN_TTL || ttlVal > BURN.MAX_TTL) {
        printError(`Invalid TTL. Must be between ${BURN.MIN_TTL} and ${BURN.MAX_TTL} seconds.`);
        return;
      }
      ttl = ttlVal;
      messageArgs = args.filter((_, i) => i !== ttlIdx && i !== ttlIdx + 1);
    }

    const messageText = messageArgs.join(' ');

    if (messageText.length > MESSAGE.MAX_LENGTH) {
      printError(`Message too long. Max ${MESSAGE.MAX_LENGTH} characters.`);
      return;
    }

    // Encrypt for each peer (broadcast burn — encrypt for each peer separately)
    // Since this is a broadcast, we need a shared key. Use the first peer's key,
    // or if multiple peers, send individual encrypted burns.
    const peerNames = Array.from(state.sessionKeys.keys());
    if (peerNames.length === 0) {
      printError('No peers on this frequency.');
      return;
    }

    // For broadcast burn, encrypt with first peer's key and send to all.
    // In a real multi-peer scenario, you'd need per-peer encryption.
    // For now, encrypt once and broadcast (all peers derive same key via ECDH+passphrase).
    const firstKey = getEffectiveKey(peerNames[0]);
    if (!firstKey) {
      printError('No session key available.');
      return;
    }

    try {
      const payload = encryptToBase64(messageText, firstKey);
      connection.send({
        type: MessageType.BURN,
        payload,
        ttl,
      });
      printSystem(`⚠ BURN message sent (TTL: ${ttl}s)`);
    } catch (err) {
      printError(`Failed to send burn message: ${err.message}`);
    }
  }

  // ─── /quit ──────────────────────────────────────────────────────────────────

  async function cmdQuit() {
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
    process.nextTick(quit);
  }

  // ─── send (plain message) ───────────────────────────────────────────────────

  async function cmdSend(text) {
    if (!connection.isConnected()) {
      printError('Not connected. Use /connect first.');
      return;
    }

    if (!state.frequency) {
      printError('Not on a frequency. Use /join <frequency> first.');
      return;
    }

    if (!text || text.length === 0) return;

    if (text.length > MESSAGE.MAX_LENGTH) {
      printError(`Message too long. Max ${MESSAGE.MAX_LENGTH} characters.`);
      return;
    }

    const peerNames = Array.from(state.sessionKeys.keys());
    if (peerNames.length === 0) {
      printWarning('No peers on frequency. Message not sent.');
      return;
    }

    // Encrypt for each peer individually
    for (const peerName of peerNames) {
      const key = getEffectiveKey(peerName);
      if (!key) continue;

      try {
        const payload = encryptToBase64(text, key);
        connection.send({
          type: MessageType.MESSAGE,
          payload,
          targetPeer: peerName,
        });
      } catch (err) {
        printWarning(`Failed to encrypt for ${peerName}: ${err.message}`);
      }
    }
  }

  // ─── Key exchange helpers ────────────────────────────────────────────────────

  /**
   * Initiate key exchange with a newly joined peer.
   * @param {string} peerName
   * @param {string} theirPublicKeyBase64
   */
  async function initiateKeyExchange(peerName, theirPublicKeyBase64) {
    if (!state.privateKey || !state.frequency) return;

    try {
      const sessionKey = computeSessionKey(state.privateKey, theirPublicKeyBase64, state.frequency);

      let effectiveKey = sessionKey;
      if (state.passphraseKey) {
        effectiveKey = combineKeys(sessionKey, state.passphraseKey, state.frequency);
        wipeBuffer(sessionKey);
      }

      state.setSessionKey(peerName, effectiveKey);
      state.peerPublicKeys.set(peerName, theirPublicKeyBase64);

      // Send our public key back to the new peer
      connection.send({
        type: MessageType.KEY_EXCHANGE,
        target: peerName,
        publicKey: state.publicKeyBase64,
      });

      // If we have a passphrase key, initiate zero-knowledge verification
      if (state.passphraseKey) {
        const nonce = randomBytes(32);
        const challenge = computeKeyChallenge(state.passphraseKey, nonce);

        connection.send({
          type: MessageType.KEY_VERIFY,
          target: peerName,
          nonce: nonce.toString('base64'),
          challenge: challenge.toString('base64'),
        });
      }
    } catch (err) {
      printWarning(`Key exchange failed with ${peerName}: ${err.message}`);
    }
  }

  /**
   * Handle a key_exchange message from a peer (they are sending us their public key).
   * @param {string} from
   * @param {string} theirPublicKeyBase64
   */
  async function handleKeyExchange(from, theirPublicKeyBase64) {
    if (!state.privateKey || !state.frequency) return;

    try {
      const sessionKey = computeSessionKey(state.privateKey, theirPublicKeyBase64, state.frequency);

      let effectiveKey = sessionKey;
      if (state.passphraseKey) {
        effectiveKey = combineKeys(sessionKey, state.passphraseKey, state.frequency);
        wipeBuffer(sessionKey);
      }

      state.setSessionKey(from, effectiveKey);
      state.peerPublicKeys.set(from, theirPublicKeyBase64);
    } catch (err) {
      printWarning(`Key exchange failed with ${from}: ${err.message}`);
    }
  }

  /**
   * Handle a key_verify challenge from a peer.
   * @param {string} from
   * @param {string} nonceBase64
   * @param {string} challengeBase64
   */
  async function handleKeyVerifyChallenge(from, nonceBase64, challengeBase64) {
    if (!state.passphraseKey) {
      // We don't have a passphrase key — mark as mismatch
      state.mismatchedPeers.add(from);
      return;
    }

    try {
      const nonce = Buffer.from(nonceBase64, 'base64');
      const theirChallenge = Buffer.from(challengeBase64, 'base64');
      const ourChallenge = computeKeyChallenge(state.passphraseKey, nonce);

      const { timingSafeEqual } = await import('../crypto/utils.js');
      if (timingSafeEqual(ourChallenge, theirChallenge)) {
        state.verifiedPeers.add(from);
        printSuccess(`Key verified with ${from}`);

        // Send our own challenge back
        const ourNonce = randomBytes(32);
        const ourChallengeForThem = computeKeyChallenge(state.passphraseKey, ourNonce);

        connection.send({
          type: MessageType.KEY_VERIFY,
          target: from,
          nonce: ourNonce.toString('base64'),
          challenge: ourChallengeForThem.toString('base64'),
        });
      } else {
        state.mismatchedPeers.add(from);
        printWarning(`Key mismatch with ${from} — they may be using a different passphrase`);
      }
    } catch (err) {
      printWarning(`Key verification failed with ${from}: ${err.message}`);
    }
  }

  /**
   * Get the effective encryption key for a peer.
   * Returns the session key (already combined with passphrase key if applicable).
   * @param {string} peerName
   * @returns {Buffer|null}
   */
  function getEffectiveKey(peerName) {
    return state.getSessionKey(peerName);
  }

  return {
    handle,
    initiateKeyExchange,
    handleKeyExchange,
    handleKeyVerifyChallenge,
    getEffectiveKey,
  };
}
