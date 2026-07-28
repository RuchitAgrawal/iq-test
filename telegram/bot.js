/**
 * telegram/bot.js
 *
 * Full Telegram bot powered by grammy.
 * Delivers the TLQ IQ Assessment entirely inside Telegram chat using
 * inline keyboards — no browser required.
 *
 * Commands:
 *   /start | /iqtest  — begin or resume a cognitive assessment session
 *   /leaderboard       — top 10 scores for the current group/chat
 *   /rank              — personal best for the calling user
 *   /help              — command reference
 *
 * Architecture:
 *   - quiz-engine.js handles all scoring and DB persistence
 *   - session.js maintains per-user state across messages
 *   - Visual questions that have pre-rendered PNGs are sent as photos
 *   - Text questions are sent as formatted messages with inline keyboards
 */

'use strict';

const { Bot, InlineKeyboard } = require('grammy');
const engine  = require('../quiz-engine');
const sessions = require('../session');
const db      = require('../database');

// ---------------------------------------------------------------------------
// Bot initialisation
// ---------------------------------------------------------------------------

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');

const bot = new Bot(TOKEN);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Format a question message body (text portion, not the image).
 * @param {object}  q            Question object from quiz-engine
 * @param {number}  idx          Zero-based question index
 * @param {number}  total        Total question count
 * @param {string}  timeStr      Formatted elapsed time e.g. "04:37"
 * @returns {{ text: string, keyboard: InlineKeyboard }}
 */
function buildQuestionPayload(q, idx, total, timeStr) {
    const categoryLabel = (q.category || 'general').toUpperCase();

    const text = [
        `<b>QUESTION ${idx + 1} / ${total}</b>  ·  <code>${timeStr}</code>`,
        `<i>${categoryLabel}</i>`,
        '',
        q.prompt,
    ].join('\n');

    const keyboard = new InlineKeyboard();
    q.options.forEach((opt, i) => {
        const label = OPTION_LABELS[i] || String(i + 1);
        keyboard.text(`${label}. ${opt}`, `ans:${q.id}:${i}`);
        // Two buttons per row
        if (i % 2 === 1) keyboard.row();
    });
    // Ensure last row is flushed
    if (q.options.length % 2 !== 0) keyboard.row();

    return { text, keyboard };
}

/**
 * Upsert a score into the telegram_scores table.
 * Only updates if the new score beats the existing best.
 */
function upsertTelegramScore(groupId, userId, username, score, archetype) {
    const sql = `
        INSERT INTO telegram_scores (group_id, user_id, username, best_score, archetype)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(group_id, user_id)
        DO UPDATE SET
            best_score = CASE WHEN excluded.best_score > best_score THEN excluded.best_score ELSE best_score END,
            archetype  = CASE WHEN excluded.best_score > best_score THEN excluded.archetype  ELSE archetype  END,
            username   = excluded.username,
            last_played_at = CURRENT_TIMESTAMP
    `;
    const stmt = db.prepare(sql);
    stmt.run(groupId, userId, username, score, archetype);
    stmt.finalize();
}

// ---------------------------------------------------------------------------
// /start and /iqtest — entry point
// ---------------------------------------------------------------------------

async function handleStart(ctx) {
    const platform = 'telegram';
    const userId   = String(ctx.from?.id);
    const chatId   = String(ctx.chat?.id);

    // If already in an active session, offer resume / restart
    if (sessions.hasActiveSession(platform, userId)) {
        const kb = new InlineKeyboard()
            .text('Resume Session',  'resume')
            .text('Start Over', 'restart');

        await ctx.reply(
            '<b>You have an active session in progress.</b>\n\nChoose an option to continue:',
            { parse_mode: 'HTML', reply_markup: kb }
        );
        return;
    }

    // Register group if this is a group chat
    if (ctx.chat?.type !== 'private') {
        db.run('INSERT OR IGNORE INTO telegram_groups (group_id) VALUES (?)', [chatId]);
    }

    const kb = new InlineKeyboard().text('BEGIN ASSESSMENT', 'begin');

    await ctx.reply(
        [
            '<b>THE LAST QUESTION</b>',
            '<b>COGNITIVE ASSESSMENT PROTOCOL</b>',
            '',
            'A multi-domain diagnostic measuring analytical agility across Logic, Pattern Recognition, Spatial Reasoning, and Sequential Deduction.',
            '',
            '— 20 Questions, difficulty-scaled',
            '— Timed session with velocity scoring',
            '— Archetype classification on completion',
            '— Dossier card generated for sharing',
        ].join('\n'),
        { parse_mode: 'HTML', reply_markup: kb }
    );
}

bot.command('start',    handleStart);
bot.command('iqtest',   handleStart);

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

bot.command('help', async (ctx) => {
    await ctx.reply(
        [
            '<b>TLQ COGNITIVE ASSESSMENT — COMMANDS</b>',
            '',
            '/start or /iqtest — Begin a new cognitive assessment',
            '/leaderboard      — View top scores for this group',
            '/rank             — View your personal best score',
            '/help             — This reference',
        ].join('\n'),
        { parse_mode: 'HTML' }
    );
});

// ---------------------------------------------------------------------------
// /leaderboard
// ---------------------------------------------------------------------------

bot.command('leaderboard', async (ctx) => {
    const chatId = String(ctx.chat?.id);

    db.all(
        'SELECT * FROM telegram_scores WHERE group_id = ? ORDER BY best_score DESC LIMIT 10',
        [chatId],
        async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                await ctx.reply('No assessment scores recorded in this group yet.\n\nType /iqtest to be the first.');
                return;
            }

            const lines = rows.map((row, i) => {
                const name  = row.username ? `@${row.username}` : `User ${String(row.user_id).slice(0, 8)}`;
                const title = row.archetype || 'Initiated Thinker';
                return `${i + 1}. ${name}  |  ${title}  |  C-IQ: <b>${row.best_score}</b>`;
            });

            await ctx.reply(
                ['<b>TLQ GROUP COGNITIVE LEADERBOARD</b>', '', ...lines, '', '/iqtest — Challenge the top rank'].join('\n'),
                { parse_mode: 'HTML' }
            );
        }
    );
});

// ---------------------------------------------------------------------------
// /rank — personal best
// ---------------------------------------------------------------------------

bot.command('rank', async (ctx) => {
    const chatId = String(ctx.chat?.id);
    const userId = String(ctx.from?.id);

    db.get(
        'SELECT * FROM telegram_scores WHERE group_id = ? AND user_id = ?',
        [chatId, userId],
        async (err, row) => {
            if (err || !row) {
                await ctx.reply('You have not completed an assessment in this group yet.\n\nType /iqtest to begin.');
                return;
            }
            const title = row.archetype || 'Initiated Thinker';
            await ctx.reply(
                [
                    '<b>YOUR COGNITIVE DOSSIER</b>',
                    '',
                    `Archetype: <b>${title}</b>`,
                    `Best C-IQ Index: <b>${row.best_score}</b>`,
                ].join('\n'),
                { parse_mode: 'HTML' }
            );
        }
    );
});

module.exports = { bot };
