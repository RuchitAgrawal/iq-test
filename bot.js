const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');
const db = require('./database');
require('dotenv').config();

// Token should be in .env. We use a dummy for MVP if missing so it doesn't crash.
const token = process.env.TELEGRAM_BOT_TOKEN || 'DUMMY_TOKEN';
const bot = new TelegramBot(token, { polling: false }); // Use webhook in production

// In production, set webhooks
// bot.setWebHook(`https://your-domain.com/bot${token}`);

// Handle /iqtest
bot.onText(/\/iqtest/, (msg) => {
    const chatId = msg.chat.id;
    
    // Save group to DB if not exists
    db.run("INSERT OR IGNORE INTO telegram_groups (group_id) VALUES (?)", [chatId]);
    
    // Generate a game link with the group id and user id attached so we know where to post back
    const userId = msg.from.id;
    const gameLink = `${process.env.APP_URL || 'http://localhost:3000'}?group_id=${chatId}&user_id=${userId}`;
    
    bot.sendMessage(chatId, `🧠 Ready to test your cognitive score?\n\nPlay here: ${gameLink}`);
});

// Handle /leaderboard
bot.onText(/\/leaderboard/, (msg) => {
    const chatId = msg.chat.id;
    
    db.all("SELECT * FROM telegram_scores WHERE group_id = ? ORDER BY best_score DESC LIMIT 10", [chatId], (err, rows) => {
        if (err || rows.length === 0) {
            return bot.sendMessage(chatId, "No scores recorded in this group yet! Play /iqtest to calibrate your rank.");
        }
        
        let lbText = "🏆 **TLQ Group Cognitive Leaderboard** 🏆\n\n";
        rows.forEach((row, index) => {
            const title = row.archetype || "Initiated Thinker";
            lbText += `${index + 1}. User ${String(row.user_id).substring(0,6)} [${title}]\n    ⚡ Score: **${row.best_score}**\n\n`;
        });
        lbText += `Ready to climb the ranks? Type /iqtest to challenge!`;
        
        bot.sendMessage(chatId, lbText, { parse_mode: 'Markdown' });
    });
});

// Handle /rank
bot.onText(/\/rank/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get("SELECT * FROM telegram_scores WHERE group_id = ? AND user_id = ?", [chatId, userId], (err, row) => {
        if (err || !row) {
            return bot.sendMessage(chatId, "You haven't completed a diagnostic session in this group yet! Play /iqtest to calibrate your rank.");
        }
        const title = row.archetype || "Initiated Thinker";
        bot.sendMessage(chatId, `🧠 **Your Cognitive Profile in this Group:**\n\n🏅 **Title:** ${title}\n⚡ **Best Score:** ${row.best_score}\n\nPlay /iqtest again to surpass your record!`, { parse_mode: 'Markdown' });
    });
});

// Function to post result image back to group
const postResultToGroup = (groupId, userId, score, imageUrl, typeLabel) => {
    if (token === 'DUMMY_TOKEN') return;
    
    const stmt = db.prepare(`
        INSERT INTO telegram_scores (group_id, user_id, best_score, archetype) 
        VALUES (?, ?, ?, ?) 
        ON CONFLICT(group_id, user_id) 
        DO UPDATE SET 
            best_score = CASE WHEN excluded.best_score > best_score THEN excluded.best_score ELSE best_score END,
            archetype = CASE WHEN excluded.best_score > best_score THEN excluded.archetype ELSE archetype END
    `);
    stmt.run(groupId, userId, score, typeLabel);
    stmt.finalize();
    
    const caption = `👑 **User ${userId} achieved Top Rank as a ${typeLabel}!**\n\n` +
                    `⚡ **Cognitive Score:** ${score}\n\n` +
                    `Think you have higher mental agility or faster processing speed?\n` +
                    `Type /iqtest to launch the diagnostic and challenge their record in TLQ!`;

    bot.sendPhoto(groupId, imageUrl, {
        caption: caption,
        parse_mode: 'Markdown'
    }).catch(console.error);
};

module.exports = { bot, postResultToGroup };
