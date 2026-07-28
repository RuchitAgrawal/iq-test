/**
 * session.js
 * In-memory session store for active quiz sessions across Telegram and Discord bots.
 * Sessions are keyed by a platform-namespaced userId string.
 * Idle sessions are automatically purged after TTL_MS milliseconds.
 */

'use strict';

const TTL_MS       = 30 * 60 * 1000; // 30 minutes
const CLEANUP_MS   = 5  * 60 * 1000; // check every 5 minutes

/**
 * @typedef {Object} QuizSession
 * @property {'telegram'|'discord'} platform
 * @property {string}   userId           Platform user ID
 * @property {string}   chatId           Chat / channel / DM ID
 * @property {string}   [guildId]        Discord guild ID (Discord only)
 * @property {string}   [username]       Display name for leaderboard
 * @property {Array}    questions        Full question array from quiz-engine
 * @property {number}   currentIndex     Zero-based index of the current question
 * @property {number}   score            Raw accumulated score
 * @property {Object}   categoryScores   { logic, pattern, spatial, sequence }
 * @property {number}   startTime        Date.now() at session start
 * @property {number}   questionStart    Date.now() at current question display
 * @property {number}   lastActivity     Date.now() at last interaction
 * @property {string}   [messageId]      Discord: ID of the embed message being edited
 * @property {string}   [channelId]      Discord: channel to post public result
 * @property {boolean}  finished         True once finishQuiz has been called
 */

/** @type {Map<string, QuizSession>} */
const store = new Map();

/**
 * Build a namespaced key so Telegram and Discord user IDs never collide.
 * @param {string} platform
 * @param {string} userId
 * @returns {string}
 */
function key(platform, userId) {
    return `${platform}:${userId}`;
}

/**
 * Create a new session, overwriting any existing one for this user.
 * @param {string} platform   'telegram' | 'discord'
 * @param {string} userId
 * @param {string} chatId
 * @param {object} [extras]   Optional extra fields (guildId, username, channelId …)
 * @returns {QuizSession}
 */
function createSession(platform, userId, chatId, extras = {}) {
    const session = {
        platform,
        userId,
        chatId,
        questions:       [],
        currentIndex:    0,
        score:           0,
        categoryScores:  { logic: 0, pattern: 0, spatial: 0, sequence: 0 },
        startTime:       Date.now(),
        questionStart:   Date.now(),
        lastActivity:    Date.now(),
        finished:        false,
        ...extras,
    };
    store.set(key(platform, userId), session);
    return session;
}

/**
 * Retrieve an active session or null if not found / already finished.
 * @param {string} platform
 * @param {string} userId
 * @returns {QuizSession|null}
 */
function getSession(platform, userId) {
    return store.get(key(platform, userId)) || null;
}

/**
 * Apply a partial update to an existing session.
 * Also bumps lastActivity timestamp automatically.
 * @param {string} platform
 * @param {string} userId
 * @param {Partial<QuizSession>} patch
 * @returns {QuizSession|null} Updated session or null if not found
 */
function updateSession(platform, userId, patch) {
    const session = store.get(key(platform, userId));
    if (!session) return null;
    const updated = { ...session, ...patch, lastActivity: Date.now() };
    store.set(key(platform, userId), updated);
    return updated;
}

/**
 * Remove a session from the store.
 * @param {string} platform
 * @param {string} userId
 */
function deleteSession(platform, userId) {
    store.delete(key(platform, userId));
}

/**
 * Check whether a user currently has an unfinished active session.
 * @param {string} platform
 * @param {string} userId
 * @returns {boolean}
 */
function hasActiveSession(platform, userId) {
    const s = store.get(key(platform, userId));
    return !!s && !s.finished;
}

/**
 * Return total elapsed seconds for the session.
 * @param {QuizSession} session
 * @returns {number}
 */
function elapsedSeconds(session) {
    return Math.floor((Date.now() - session.startTime) / 1000);
}

/**
 * Format elapsed time as MM:SS string.
 * @param {QuizSession} session
 * @returns {string} e.g. "04:37"
 */
function formatElapsed(session) {
    const total = elapsedSeconds(session);
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Automatic TTL cleanup
// ---------------------------------------------------------------------------

const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, session] of store.entries()) {
        if (session.lastActivity < cutoff) {
            console.log(`[session] TTL expired — removing session ${k}`);
            store.delete(k);
        }
    }
}, CLEANUP_MS);

// Prevent the interval from keeping the process alive if bots are shut down
if (cleanupInterval.unref) cleanupInterval.unref();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    createSession,
    getSession,
    updateSession,
    deleteSession,
    hasActiveSession,
    elapsedSeconds,
    formatElapsed,
};
