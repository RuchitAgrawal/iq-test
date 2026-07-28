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

// ---------------------------------------------------------------------------
// Quiz flow — begin, resume, restart
// ---------------------------------------------------------------------------

/**
 * Start a fresh quiz session for this user.
 */
async function beginQuiz(ctx) {
    const platform = 'telegram';
    const userId   = String(ctx.from?.id);
    const chatId   = String(ctx.chat?.id);
    const username = ctx.from?.username || null;

    await ctx.answerCallbackQuery();

    const questions = await engine.getQuestions();
    sessions.createSession(platform, userId, chatId, { username, questions });
    await sendQuestion(ctx, platform, userId);
}

/**
 * Send the current question for this session.
 */
async function sendQuestion(ctx, platform, userId) {
    const session = sessions.getSession(platform, userId);
    if (!session || session.finished) return;

    const q       = session.questions[session.currentIndex];
    const total   = session.questions.length;
    const timeStr = sessions.formatElapsed(session);

    const { text, keyboard } = buildQuestionPayload(q, session.currentIndex, total, timeStr);

    sessions.updateSession(platform, userId, { questionStart: Date.now() });

    // If we have a pre-rendered image, send it before the question text
    if (q.imagePath) {
        try {
            const { InputFile } = require('grammy');
            await ctx.replyWithPhoto(new InputFile(q.imagePath));
        } catch (_) {
            // Non-fatal — fall through to text question
        }
    }

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

bot.callbackQuery('begin', beginQuiz);

bot.callbackQuery('resume', async (ctx) => {
    await ctx.answerCallbackQuery();
    const platform = 'telegram';
    const userId   = String(ctx.from?.id);
    await sendQuestion(ctx, platform, userId);
});

bot.callbackQuery('restart', async (ctx) => {
    const platform = 'telegram';
    const userId   = String(ctx.from?.id);
    sessions.deleteSession(platform, userId);
    await beginQuiz(ctx);
});

// ---------------------------------------------------------------------------
// Answer handling  (callback data format: "ans:{questionId}:{optionIndex}")
// ---------------------------------------------------------------------------

bot.callbackQuery(/^ans:(.+):(\d+)$/, async (ctx) => {
    const platform = 'telegram';
    const userId   = String(ctx.from?.id);
    const session  = sessions.getSession(platform, userId);

    if (!session || session.finished) {
        await ctx.answerCallbackQuery({ text: 'No active session. Type /iqtest to start.' });
        return;
    }

    const [, questionId, optionIndexStr] = ctx.match;
    const q = session.questions[session.currentIndex];

    // Guard: callback must match the current question
    if (q.id !== questionId) {
        await ctx.answerCallbackQuery({ text: 'Already answered — please wait for the next question.' });
        return;
    }

    const optionIndex    = parseInt(optionIndexStr, 10);
    const selectedOption = q.options[optionIndex];
    const isCorrect      = selectedOption === q.answer;
    const timeSpent      = (Date.now() - session.questionStart) / 1000;

    // Update score
    let { score, categoryScores } = session;
    if (isCorrect) {
        const pts = q.difficulty || 2;
        score += pts;
        const cat = q.category || 'logic';
        categoryScores = { ...categoryScores, [cat]: (categoryScores[cat] || 0) + pts };
    }

    const nextIndex = session.currentIndex + 1;
    sessions.updateSession(platform, userId, {
        score,
        categoryScores,
        currentIndex: nextIndex,
    });

    // Speed feedback toast
    const feedbackText = isCorrect
        ? (timeSpent <= 5 ? 'Rapid Response Logged' : 'Correct')
        : 'Incorrect';
    await ctx.answerCallbackQuery({ text: feedbackText });

    // Next question or finish
    if (nextIndex >= session.questions.length) {
        await finishQuiz(ctx, platform, userId);
    } else {
        await sendQuestion(ctx, platform, userId);
    }
});
});

// ---------------------------------------------------------------------------
// Finish quiz — calculate result, send card, post to group
// ---------------------------------------------------------------------------

async function finishQuiz(ctx, platform, userId) {
    const session = sessions.getSession(platform, userId);
    if (!session) return;

    sessions.updateSession(platform, userId, { finished: true });

    const timeTaken  = sessions.elapsedSeconds(session);
    const result     = engine.calculateScore(session.score, session.categoryScores, timeTaken);
    const sessionId  = `tg-${userId}-${Date.now()}`;

    await ctx.reply(
        '<i>Computing your cognitive dossier…</i>',
        { parse_mode: 'HTML' }
    );

    let resultId;
    try {
        resultId = await engine.saveResult(sessionId, result, timeTaken);
    } catch (err) {
        console.error('[telegram] Failed to save result:', err);
        await ctx.reply('Assessment complete, but dossier generation encountered an error. Please try again.');
        sessions.deleteSession(platform, userId);
        return;
    }

    // Build caption text
    const appUrl   = process.env.APP_URL || 'https://thelastquestion.io';
    const testUrl  = `${appUrl}/?utm_source=iq-test&utm_medium=sidegame&utm_campaign=iq-test`;
    const caption  = [
        '<b>COGNITIVE DOSSIER CONFIRMED</b>',
        '',
        `Archetype: <b>${result.typeLabel}</b>`,
        `C-IQ Index: <b>${result.score}</b>  |  Rank: <b>Top ${100 - result.percentile}%</b>`,
        `Time: <b>${Math.floor(timeTaken / 60)}m ${timeTaken % 60}s</b>`,
        '',
        `Logic: ${result.categories.logic}  |  Pattern: ${result.categories.pattern}  |  Spatial: ${result.categories.spatial}  |  Sequence: ${result.categories.sequence}`,
        '',
        `<a href="${testUrl}">Access The Last Question — Enigma Arena</a>`,
        `<a href="https://discord.gg/V3RGHePW7">Claim Your Rank on Discord</a>`,
    ].join('\n');

    // Generate and send the PNG result card
    try {
        const { InputFile } = require('grammy');
        const pngBuf = await engine.generateCardBuffer(resultId);
        await ctx.replyWithPhoto(new InputFile(pngBuf, 'tlq-dossier.png'), {
            caption,
            parse_mode: 'HTML',
        });
    } catch (err) {
        console.error('[telegram] Card generation failed:', err);
        // Fallback: send text only
        await ctx.reply(caption, { parse_mode: 'HTML' });
    }

    // If in a group, also post the result publicly in that chat
    const chatId = session.chatId;
    if (chatId && chatId !== String(session.userId)) {
        try {
            upsertTelegramScore(chatId, userId, session.username, result.score, result.typeLabel);

            const username   = session.username ? `@${session.username}` : `User ${userId.slice(0, 8)}`;
            const groupCapt  = [
                `<b>${username} completed the TLQ Cognitive Assessment</b>`,
                '',
                `Archetype: <b>${result.typeLabel}</b>  |  C-IQ: <b>${result.score}</b>`,
                `Rank: Top ${100 - result.percentile}%  |  Time: ${Math.floor(timeTaken / 60)}m ${timeTaken % 60}s`,
                '',
                'Think you can surpass this result? /iqtest',
            ].join('\n');

            const pngBuf = await engine.generateCardBuffer(resultId);
            const { InputFile } = require('grammy');
            await bot.api.sendPhoto(chatId, new InputFile(pngBuf, 'tlq-dossier.png'), {
                caption: groupCapt,
                parse_mode: 'HTML',
            });
        } catch (err) {
            console.error('[telegram] Group post failed:', err.message);
        }
    }

    sessions.deleteSession(platform, userId);
}

// ---------------------------------------------------------------------------
// Error handling & long-polling start
// ---------------------------------------------------------------------------

bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[telegram] Error while handling update ${ctx.update.update_id}:`, err.error);
});

// Start long-polling (will block until process exit)
bot.start({
    onStart: (info) => console.log(`[telegram] Bot @${info.username} started in long-polling mode`),
}).catch((err) => console.error('[telegram] Bot crashed:', err));

module.exports = { bot };
