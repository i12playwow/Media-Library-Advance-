"use strict";
/** Pure, dependency-free rate limiter for PIN verification attempts.
 *
 *  Sliding-window failure counting per key with an escalating lockout: after
 *  `maxAttempts` failures inside `windowMs`, attempts are rejected for
 *  `lockoutMs`. A successful verification resets the key. Time is injected
 *  (`nowMs`) so tests can drive it without waiting on real clocks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PinRateLimiter = exports.DEFAULT_PIN_RATE_LIMIT = void 0;
exports.formatLockoutMessage = formatLockoutMessage;
exports.formatRemainingAttemptsMessage = formatRemainingAttemptsMessage;
exports.DEFAULT_PIN_RATE_LIMIT = {
    maxAttempts: 5,
    windowMs: 60_000,
    lockoutMs: 5 * 60_000
};
function formatLockoutMessage(retryAfterMs) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    if (seconds < 60) {
        return `Too many incorrect attempts. Try again in ${seconds}s.`;
    }
    const minutes = Math.ceil(seconds / 60);
    return `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
function formatRemainingAttemptsMessage(remaining) {
    return `Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before lockout.`;
}
class PinRateLimiter {
    config;
    entries = new Map();
    constructor(config = exports.DEFAULT_PIN_RATE_LIMIT) {
        this.config = config;
    }
    /** Record an attempt for `key` at time `nowMs` and decide whether the
     *  verification may proceed. Call this BEFORE hashing the PIN; when the
     *  verification succeeds, follow up with `reset(key)`. */
    attempt(key, nowMs) {
        const entry = this.entries.get(key) ?? { attempts: [], lockedUntil: 0 };
        if (entry.lockedUntil > nowMs) {
            return {
                allowed: false,
                retryAfterMs: entry.lockedUntil - nowMs,
                remainingAttempts: 0
            };
        }
        if (entry.lockedUntil !== 0) {
            // Lockout expired — start a fresh window.
            entry.lockedUntil = 0;
            entry.attempts = [];
        }
        entry.attempts = entry.attempts.filter((at) => nowMs - at < this.config.windowMs);
        if (entry.attempts.length >= this.config.maxAttempts) {
            entry.lockedUntil = nowMs + this.config.lockoutMs;
            this.entries.set(key, entry);
            return {
                allowed: false,
                retryAfterMs: this.config.lockoutMs,
                remainingAttempts: 0
            };
        }
        entry.attempts.push(nowMs);
        this.entries.set(key, entry);
        return {
            allowed: true,
            retryAfterMs: 0,
            remainingAttempts: this.config.maxAttempts - entry.attempts.length
        };
    }
    /** Clear failure history for `key` (call after a successful verification). */
    reset(key) {
        this.entries.delete(key);
    }
}
exports.PinRateLimiter = PinRateLimiter;
