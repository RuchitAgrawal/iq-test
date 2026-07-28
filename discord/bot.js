/**
 * discord/bot.js
 *
 * Full Discord bot using discord.js v14.
 * Delivers the TLQ IQ Assessment via slash command interactions inside Discord.
 *
 * UX flow:
 *  /iqtest start       — Start an ephemeral quiz session
 *  /iqtest leaderboard — Server cognitive leaderboard embed
 *  /iqtest rank        — Personal dossier embed
 *
 * After completion the result card is posted publicly to the channel
 * and the discord_scores leaderboard is updated.
 *
 * Architecture:
 *  - quiz-engine.js handles scoring, DB persistence, and card generation
 *  - session.js tracks active sessions per userId
 *  - Questions are presented as embeds with button A/B/C/D collectors
 *  - Messages are edited in-place to avoid chat spam
 */

'use strict';

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
} = require('discord.js');

const engine   = require('../quiz-engine');
const sessions = require('../session');
const db       = require('../database');

// ---------------------------------------------------------------------------
// Client initialisation
// ---------------------------------------------------------------------------

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN is not set');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];
const ACCENT_COLOR  = 0xe8943a;   // Amber — matches web theme

/**
 * Build the question embed and button row for a given question.
 */
function buildQuestionComponents(q, idx, total, timeStr) {
    const categoryLabel = (q.category || 'GENERAL').toUpperCase();
    const progressBar   = buildProgressBar(idx, total);

    const embed = new EmbedBuilder()
        .setColor(ACCENT_COLOR)
        .setTitle(`QUESTION ${idx + 1} / ${total}`)
        .setDescription(q.prompt)
        .addFields(
            { name: 'CATEGORY',  value: categoryLabel, inline: true },
            { name: 'ELAPSED',   value: `\`${timeStr}\``, inline: true },
            { name: 'PROGRESS',  value: progressBar, inline: false },
        )
        .setFooter({ text: 'THE LAST QUESTION // COGNITIVE ASSESSMENT' });

    const row = new ActionRowBuilder();
    q.options.slice(0, 5).forEach((opt, i) => {
        const label = OPTION_LABELS[i];
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`ans:${q.id}:${i}`)
                .setLabel(`${label}. ${opt.length > 60 ? opt.slice(0, 57) + '…' : opt}`)
                .setStyle(ButtonStyle.Secondary)
        );
    });

    return { embed, row };
}

/**
 * Simple text progress bar: ████░░░░ 5/20
 */
function buildProgressBar(current, total) {
    const filled = Math.round((current / total) * 10);
    const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
    return `${bar}  ${current}/${total}`;
}

/**
 * Upsert a user score into discord_scores.
 */
function upsertDiscordScore(guildId, userId, username, score, archetype) {
    const sql = `
        INSERT INTO discord_scores (guild_id, user_id, username, best_score, archetype)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id)
        DO UPDATE SET
            best_score = CASE WHEN excluded.best_score > best_score THEN excluded.best_score ELSE best_score END,
            archetype  = CASE WHEN excluded.best_score > best_score THEN excluded.archetype  ELSE archetype  END,
            username   = excluded.username,
            last_played_at = CURRENT_TIMESTAMP
    `;
    const stmt = db.prepare(sql);
    stmt.run(guildId, userId, username, score, archetype);
    stmt.finalize();
}

// ---------------------------------------------------------------------------
// Client ready
// ---------------------------------------------------------------------------

client.once('ready', () => {
    console.log(`[discord] Logged in as ${client.user.tag}`);
});

// ---------------------------------------------------------------------------
// Slash command router
// ---------------------------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
    // ── Slash commands ──────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'iqtest') {
        const action = interaction.options.getString('action') || 'start';

        if (action === 'start')       return handleStart(interaction);
        if (action === 'leaderboard') return handleLeaderboard(interaction);
        if (action === 'rank')        return handleRank(interaction);
        return;
    }

    // ── Button interactions ─────────────────────────────────────────────────
    if (!interaction.isButton()) return;

    const id = interaction.customId;

    if (id === 'begin')   return handleBegin(interaction);
    if (id === 'restart') return handleRestart(interaction);
    if (id === 'resume')  return handleResume(interaction);

    if (id.startsWith('ans:')) return handleAnswer(interaction);
});

// ---------------------------------------------------------------------------
// /iqtest start — welcome embed
// ---------------------------------------------------------------------------

async function handleStart(interaction) {
    const platform = 'discord';
    const userId   = interaction.user.id;

    // Offer resume if session already exists
    if (sessions.hasActiveSession(platform, userId)) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('resume').setLabel('Resume Session').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('restart').setLabel('Start Over').setStyle(ButtonStyle.Danger),
        );

        const embed = new EmbedBuilder()
            .setColor(ACCENT_COLOR)
            .setTitle('ACTIVE SESSION DETECTED')
            .setDescription('You have an ongoing cognitive assessment. Resume or start a new session?');

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        return;
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('begin').setLabel('BEGIN ASSESSMENT').setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
        .setColor(ACCENT_COLOR)
        .setTitle('THE LAST QUESTION')
        .setDescription(
            '**COGNITIVE ASSESSMENT PROTOCOL**\n\n' +
            'A multi-domain diagnostic measuring analytical agility across Logic, Pattern Recognition, Spatial Reasoning, and Sequential Deduction.\n\n' +
            '— 20 Questions, difficulty-scaled\n' +
            '— Timed session with velocity scoring\n' +
            '— Archetype classification on completion\n' +
            '— Dossier card posted publicly on finish'
        )
        .setFooter({ text: 'THE LAST QUESTION // COGNITIVE ASSESSMENT' });

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// ---------------------------------------------------------------------------
// Begin quiz
// ---------------------------------------------------------------------------

async function handleBegin(interaction) {
    const platform = 'discord';
    const userId   = interaction.user.id;
    const chatId   = interaction.channelId;
    const guildId  = interaction.guildId;
    const username = interaction.user.username;

    await interaction.deferUpdate();

    const questions = await engine.getQuestions();
    sessions.createSession(platform, userId, chatId, { guildId, username, questions });

    await renderQuestion(interaction, platform, userId);
}

async function handleResume(interaction) {
    await interaction.deferUpdate();
    await renderQuestion(interaction, 'discord', interaction.user.id);
}

async function handleRestart(interaction) {
    sessions.deleteSession('discord', interaction.user.id);
    await handleBegin(interaction);
}

// ---------------------------------------------------------------------------
// Render current question into the ephemeral interaction message
// ---------------------------------------------------------------------------

async function renderQuestion(interaction, platform, userId) {
    const session = sessions.getSession(platform, userId);
    if (!session || session.finished) return;

    const q       = session.questions[session.currentIndex];
    const total   = session.questions.length;
    const timeStr = sessions.formatElapsed(session);

    sessions.updateSession(platform, userId, { questionStart: Date.now() });

    const { embed, row } = buildQuestionComponents(q, session.currentIndex, total, timeStr);

    // If this question has a pre-rendered image, attach it
    if (q.imagePath) {
        const attachment = new AttachmentBuilder(q.imagePath, { name: 'question.png' });
        embed.setImage('attachment://question.png');
        await interaction.editReply({ embeds: [embed], components: [row], files: [attachment] });
    } else {
        await interaction.editReply({ embeds: [embed], components: [row], files: [] });
    }
}

// ---------------------------------------------------------------------------
// Handle answer button
// ---------------------------------------------------------------------------

async function handleAnswer(interaction) {
    const platform = 'discord';
    const userId   = interaction.user.id;
    const session  = sessions.getSession(platform, userId);

    if (!session || session.finished) {
        await interaction.reply({ content: 'No active session. Use `/iqtest start` to begin.', ephemeral: true });
        return;
    }

    // Parse callback: "ans:{questionId}:{optionIndex}"
    const parts       = interaction.customId.split(':');
    const questionId  = parts[1];
    const optionIndex = parseInt(parts[2], 10);

    const q = session.questions[session.currentIndex];

    if (q.id !== questionId) {
        await interaction.reply({ content: 'Already answered — next question loading.', ephemeral: true });
        return;
    }

    await interaction.deferUpdate();

    const selectedOption = q.options[optionIndex];
    const isCorrect      = selectedOption === q.answer;
    const timeSpent      = (Date.now() - session.questionStart) / 1000;

    let { score, categoryScores } = session;
    if (isCorrect) {
        const pts = q.difficulty || 2;
        score += pts;
        const cat = q.category || 'logic';
        categoryScores = { ...categoryScores, [cat]: (categoryScores[cat] || 0) + pts };
    }

    const nextIndex = session.currentIndex + 1;
    sessions.updateSession(platform, userId, { score, categoryScores, currentIndex: nextIndex });

    if (nextIndex >= session.questions.length) {
        await finishQuiz(interaction, platform, userId);
    } else {
        await renderQuestion(interaction, platform, userId);
    }
}

// ---------------------------------------------------------------------------
// Finish quiz — score, card, public post
// ---------------------------------------------------------------------------

async function finishQuiz(interaction, platform, userId) {
    const session = sessions.getSession(platform, userId);
    if (!session) return;

    sessions.updateSession(platform, userId, { finished: true });

    const timeTaken = sessions.elapsedSeconds(session);
    const result    = engine.calculateScore(session.score, session.categoryScores, timeTaken);
    const sessionId = `dc-${userId}-${Date.now()}`;

    // Update ephemeral message to "computing" state
    const computingEmbed = new EmbedBuilder()
        .setColor(ACCENT_COLOR)
        .setTitle('DOSSIER COMPILING…')
        .setDescription('Computing your cognitive profile. Stand by.');
    await interaction.editReply({ embeds: [computingEmbed], components: [], files: [] });

    let resultId;
    try {
        resultId = await engine.saveResult(sessionId, result, timeTaken);
    } catch (err) {
        console.error('[discord] Failed to save result:', err);
        await interaction.editReply({ content: 'Assessment complete, but dossier generation failed. Please try again.', embeds: [], components: [] });
        sessions.deleteSession(platform, userId);
        return;
    }

    // Tell user dossier will be posted to channel
    const doneEmbed = new EmbedBuilder()
        .setColor(0x27ae60)
        .setTitle('ASSESSMENT COMPLETE')
        .setDescription(`Your cognitive dossier has been compiled.\n\nArchetype: **${result.typeLabel}**\nC-IQ Index: **${result.score}** | Rank: **Top ${100 - result.percentile}%**\n\nYour result card will be posted to the channel now.`);
    await interaction.editReply({ embeds: [doneEmbed], components: [], files: [] });

    // Generate result card and post publicly
    const appUrl  = process.env.APP_URL || 'https://thelastquestion.io';
    const testUrl = `${appUrl}/?utm_source=iq-test&utm_medium=sidegame&utm_campaign=iq-test`;

    const publicEmbed = new EmbedBuilder()
        .setColor(parseInt((result.accentColor || '#e8943a').replace('#', ''), 16))
        .setTitle('TLQ COGNITIVE DOSSIER')
        .setDescription(
            `**${interaction.user.displayName || interaction.user.username}** has completed the cognitive assessment.\n\n` +
            `Archetype: **${result.typeLabel}**\n` +
            `C-IQ Index: **${result.score}** | Rank: **Top ${100 - result.percentile}%**\n` +
            `Time: **${Math.floor(timeTaken / 60)}m ${timeTaken % 60}s**\n\n` +
            `Logic: \`${result.categories.logic}\`  |  Pattern: \`${result.categories.pattern}\`  |  Spatial: \`${result.categories.spatial}\`  |  Sequence: \`${result.categories.sequence}\`\n\n` +
            `[Access The Enigma Arena](${testUrl}) · [Join Discord](https://discord.gg/V3RGHePW7)`
        )
        .setFooter({ text: 'THE LAST QUESTION // COGNITIVE ASSESSMENT — thelastquestion.io' });

    try {
        const pngBuf     = await engine.generateCardBuffer(resultId);
        const attachment = new AttachmentBuilder(Buffer.from(pngBuf), { name: 'tlq-dossier.png' });
        publicEmbed.setImage('attachment://tlq-dossier.png');

        // Upsert score to leaderboard
        if (session.guildId) {
            upsertDiscordScore(session.guildId, userId, session.username, result.score, result.typeLabel);
        }

        await interaction.channel.send({ embeds: [publicEmbed], files: [attachment] });
    } catch (err) {
        console.error('[discord] Public card post failed:', err);
        // Fallback without image
        try {
            await interaction.channel.send({ embeds: [publicEmbed] });
        } catch (_) {}
    }

    sessions.deleteSession(platform, userId);
}

// ---------------------------------------------------------------------------
// /iqtest leaderboard
// ---------------------------------------------------------------------------

async function handleLeaderboard(interaction) {
    const guildId = interaction.guildId;

    if (!guildId) {
        await interaction.reply({ content: 'Leaderboard is only available in server channels.', ephemeral: true });
        return;
    }

    db.all(
        'SELECT * FROM discord_scores WHERE guild_id = ? ORDER BY best_score DESC LIMIT 10',
        [guildId],
        async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                await interaction.reply({ content: 'No assessment scores on this server yet.\n\nUse `/iqtest start` to be the first.', ephemeral: true });
                return;
            }

            const lines = rows.map((row, i) => {
                const name  = row.username ? `@${row.username}` : `User ${row.user_id.slice(0, 8)}`;
                const title = row.archetype || 'Initiated Thinker';
                return `\`${String(i + 1).padStart(2, ' ')}.\` ${name}  |  ${title}  |  C-IQ: **${row.best_score}**`;
            });

            const embed = new EmbedBuilder()
                .setColor(ACCENT_COLOR)
                .setTitle('TLQ SERVER COGNITIVE LEADERBOARD')
                .setDescription(lines.join('\n'))
                .setFooter({ text: 'Use /iqtest start to challenge the leaderboard' });

            await interaction.reply({ embeds: [embed], ephemeral: false });
        }
    );
}

// ---------------------------------------------------------------------------
// /iqtest rank — personal best
// ---------------------------------------------------------------------------

async function handleRank(interaction) {
    const guildId = interaction.guildId;
    const userId  = interaction.user.id;

    if (!guildId) {
        await interaction.reply({ content: 'Rank is only available in server channels.', ephemeral: true });
        return;
    }

    db.get(
        'SELECT * FROM discord_scores WHERE guild_id = ? AND user_id = ?',
        [guildId, userId],
        async (err, row) => {
            if (err || !row) {
                await interaction.reply({ content: 'You have not completed an assessment on this server yet.\n\nUse `/iqtest start` to begin.', ephemeral: true });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(ACCENT_COLOR)
                .setTitle('YOUR COGNITIVE DOSSIER')
                .addFields(
                    { name: 'Archetype',    value: row.archetype || 'Initiated Thinker', inline: true },
                    { name: 'Best C-IQ',   value: String(row.best_score), inline: true },
                )
                .setFooter({ text: 'Use /iqtest start to retake the assessment' });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    );
}

// ---------------------------------------------------------------------------
// Error handler & login
// ---------------------------------------------------------------------------

client.on('error', (err) => console.error('[discord] Client error:', err));

client.login(TOKEN).catch((err) => {
    console.error('[discord] Login failed:', err);
});

module.exports = { client };
