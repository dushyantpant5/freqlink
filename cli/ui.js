/**
 * FreqLink CLI user interface — rendering, colors, and terminal formatting.
 *
 * Uses chalk for color output and box-drawing characters for the console header.
 * All output goes through this module to ensure consistent formatting.
 */

import chalk from 'chalk';
import { BURN } from '../shared/constants.js';

// ─── Timestamps ───────────────────────────────────────────────────────────────

/**
 * Format current time as HH:MM:SS.
 * @returns {string}
 */
function timestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ─── System Messages ──────────────────────────────────────────────────────────

/**
 * Print a cyan system/info message.
 * @param {string} msg
 */
export function printSystem(msg) {
  console.log(chalk.cyan(`  ${msg}`));
}

/**
 * Print a yellow warning.
 * @param {string} msg
 */
export function printWarning(msg) {
  console.log(chalk.yellow(`  ⚠ ${msg}`));
}

/**
 * Print a red error message.
 * @param {string} msg
 */
export function printError(msg) {
  console.log(chalk.red(`  ✗ ${msg}`));
}

/**
 * Print a green success indicator.
 * @param {string} msg
 */
export function printSuccess(msg) {
  console.log(chalk.green(`  ✓ ${msg}`));
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/**
 * Print an incoming message from a peer.
 * @param {string} from - Sender peer name.
 * @param {string} text - Decrypted message text.
 * @param {boolean} [isOwn] - True if this is our echo.
 */
export function printMessage(from, text, isOwn = false) {
  const ts = chalk.gray(`[${timestamp()}]`);
  const name = isOwn ? chalk.green(`[${from}]`) : chalk.white(`[${from}]`);
  console.log(`${ts} ${name}: ${text}`);
}

/**
 * Print an incoming direct message.
 * @param {string} from
 * @param {string} text
 */
export function printDM(from, text) {
  const ts = chalk.gray(`[${timestamp()}]`);
  const label = chalk.magenta(`[DM:${from}]`);
  console.log(`${ts} ${label}: ${text}`);
}

/**
 * Print a burn message and schedule visual erasure.
 * @param {string} from
 * @param {string} text
 * @param {number} ttl - Seconds before erasure.
 */
export function printBurnMessage(from, text, ttl) {
  const ts = chalk.gray(`[${timestamp()}]`);
  const label = chalk.magenta(`[${from}]`);
  const burnLabel = chalk.red(`🔥 BURN`);

  // ANSI cursor-up trick: we'll overwrite this line after TTL
  // We print the message and note the row for erasure
  const line = `${ts} ${burnLabel} ${label}: ${text} ${chalk.gray(`(${ttl}s)`)}`;
  process.stdout.write(line + '\n');

  // After TTL, move up and erase the line
  setTimeout(() => {
    // Move cursor up one line, clear it, and write a redacted notice
    process.stdout.write('\x1B[1A\x1B[2K');
    process.stdout.write(chalk.gray(`  [burn message erased]\n`));
  }, ttl * 1000);
}

// ─── Peer Events ──────────────────────────────────────────────────────────────

/**
 * Print a peer-joined notification.
 * @param {string} peerName
 * @param {boolean} keyVerified - Whether this peer passed key verification.
 * @param {boolean} keyMismatch - Whether this peer failed key verification.
 */
export function printPeerJoined(peerName, keyVerified = false, keyMismatch = false) {
  let suffix = '';
  if (keyVerified) suffix = chalk.green(' ✓ Key verified');
  else if (keyMismatch) suffix = chalk.yellow(' ⚠ Key mismatch');

  printSystem(`${chalk.white(peerName)} joined the frequency${suffix}`);
}

/**
 * Print a peer-left notification.
 * @param {string} peerName
 */
export function printPeerLeft(peerName) {
  printSystem(`${chalk.white(peerName)} left the frequency`);
}

// ─── Console Header ───────────────────────────────────────────────────────────

const BOX_WIDTH = 46;

/**
 * Print the frequency console header box.
 * @param {object} opts
 * @param {string} opts.peerName
 * @param {string} opts.frequency
 * @param {number} opts.peerCount
 * @param {boolean} [opts.hasPassphrase]
 */
export function printConsoleHeader({ peerName, frequency, peerCount, hasPassphrase = false }) {
  const encLabel = hasPassphrase
    ? 'AES-256-GCM (ECDH + passphrase)'
    : 'AES-256-GCM (ECDH)';

  const pad = (label, value) => {
    const content = `  ${label}${value}`;
    return content;
  };

  console.log('');
  console.log(chalk.cyan('╔' + '═'.repeat(BOX_WIDTH) + '╗'));
  console.log(chalk.cyan('║') + chalk.bold(' FreqLink Console').padEnd(BOX_WIDTH) + chalk.cyan('║'));
  console.log(chalk.cyan('╠' + '═'.repeat(BOX_WIDTH) + '╣'));
  console.log(chalk.cyan('║') + pad('  Peer:        ', chalk.white(peerName)).padEnd(BOX_WIDTH) + chalk.cyan('║'));
  console.log(chalk.cyan('║') + pad('  Frequency:   ', chalk.yellow(`${frequency} MHz`)).padEnd(BOX_WIDTH) + chalk.cyan('║'));
  console.log(chalk.cyan('║') + pad('  Encryption:  ', chalk.green(encLabel)).padEnd(BOX_WIDTH) + chalk.cyan('║'));
  console.log(chalk.cyan('║') + pad('  Peers:       ', chalk.white(String(peerCount))).padEnd(BOX_WIDTH) + chalk.cyan('║'));
  console.log(chalk.cyan('╚' + '═'.repeat(BOX_WIDTH) + '╝'));
  console.log('');
}

// ─── Peer List ────────────────────────────────────────────────────────────────

/**
 * Print the list of peers on the current frequency.
 * @param {string} frequency
 * @param {Array<{ peerName: string }>} peers
 * @param {string} myName
 * @param {Set<string>} verifiedPeers
 * @param {Set<string>} mismatchedPeers
 */
export function printPeerList(frequency, peers, myName, verifiedPeers, mismatchedPeers) {
  console.log('');
  console.log(chalk.cyan(`  Peers on ${frequency} MHz:`));
  for (const p of peers) {
    const isMe = p.peerName === myName;
    let suffix = isMe ? chalk.gray(' (you)') : '';
    if (!isMe && verifiedPeers.has(p.peerName)) suffix += chalk.green(' ✓');
    if (!isMe && mismatchedPeers.has(p.peerName)) suffix += chalk.yellow(' ⚠');
    console.log(chalk.cyan(`    • `) + chalk.white(p.peerName) + suffix);
  }
  console.log('');
}

// ─── Help ─────────────────────────────────────────────────────────────────────

/**
 * Print the help text.
 */
export function printHelp() {
  console.log('');
  console.log(chalk.cyan('  Available commands:'));
  const cmds = [
    ['/connect', 'Connect to the relay server'],
    ['/join <freq> --key <secret>', 'Join a frequency with a passphrase (required)'],
    ['/leave', 'Leave the current frequency'],
    ['/peers', 'List peers on the current frequency'],
    ['/dm <peer> <message>', 'Send a direct message to a peer'],
    ['/burn <message>', 'Send a self-destructing message (5s TTL)'],
    ['/burn <message> --ttl <s>', 'Send a burn message with custom TTL (max 30s)'],
    ['/quit', 'Disconnect and purge all session keys'],
    ['/help', 'Show this help text'],
  ];
  for (const [cmd, desc] of cmds) {
    console.log(`    ${chalk.yellow(cmd.padEnd(32))} ${chalk.gray(desc)}`);
  }
  console.log('');
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

/**
 * Build the REPL prompt string reflecting current state.
 * @param {string|null} frequency
 * @returns {string}
 */
export function buildPrompt(frequency) {
  if (frequency) {
    return chalk.cyan(`freqlink:${frequency}> `);
  }
  return chalk.cyan('freqlink> ');
}

// ─── Startup Banner ───────────────────────────────────────────────────────────

/**
 * Print the FreqLink startup banner.
 */
export function printBanner() {
  console.log('');
  console.log(chalk.cyan('  ███████╗██████╗ ███████╗ ██████╗ ██╗     ██╗███╗   ██╗██╗  ██╗'));
  console.log(chalk.cyan('  ██╔════╝██╔══██╗██╔════╝██╔═══██╗██║     ██║████╗  ██║██║ ██╔╝'));
  console.log(chalk.cyan('  █████╗  ██████╔╝█████╗  ██║   ██║██║     ██║██╔██╗ ██║█████╔╝ '));
  console.log(chalk.cyan('  ██╔══╝  ██╔══██╗██╔══╝  ██║▄▄ ██║██║     ██║██║╚██╗██║██╔═██╗ '));
  console.log(chalk.cyan('  ██║     ██║  ██║███████╗╚██████╔╝███████╗██║██║ ╚████║██║  ██╗'));
  console.log(chalk.cyan('  ╚═╝     ╚═╝  ╚═╝╚══════╝ ╚══▀▀═╝ ╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝'));
  console.log('');
  console.log(chalk.gray('  Terminal-based encrypted frequency communication'));
  console.log(chalk.gray('  Type /help for available commands\n'));
}
