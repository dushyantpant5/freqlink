/**
 * FreqLink per-connection sliding-window rate limiter.
 *
 * Uses in-memory counters per WebSocket connection.
 * No external dependencies.
 */

import { RATE_LIMIT } from '../shared/constants.js';

/**
 * Create a new rate limiter instance for a single connection.
 *
 * @returns {object} Rate limiter with check methods.
 */
export function createRateLimiter() {
  // Sliding window: store timestamps of recent events
  const messageTimestamps = [];
  const joinTimestamps = [];

  /**
   * Check if a message can be sent under the rate limit.
   * Returns true if allowed, false if rate-limited.
   * @returns {boolean}
   */
  function checkMessage() {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT.MESSAGE_WINDOW;

    // Remove timestamps outside the window
    while (messageTimestamps.length > 0 && messageTimestamps[0] < windowStart) {
      messageTimestamps.shift();
    }

    if (messageTimestamps.length >= RATE_LIMIT.MESSAGE_MAX) {
      return false;
    }

    messageTimestamps.push(now);
    return true;
  }

  /**
   * Check if a join/leave operation is allowed under the rate limit.
   * Returns true if allowed, false if rate-limited.
   * @returns {boolean}
   */
  function checkJoin() {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT.JOIN_WINDOW;

    while (joinTimestamps.length > 0 && joinTimestamps[0] < windowStart) {
      joinTimestamps.shift();
    }

    if (joinTimestamps.length >= RATE_LIMIT.JOIN_MAX) {
      return false;
    }

    joinTimestamps.push(now);
    return true;
  }

  /** Reset all rate limit counters (e.g., on disconnect). */
  function reset() {
    messageTimestamps.length = 0;
    joinTimestamps.length = 0;
  }

  return { checkMessage, checkJoin, reset };
}
