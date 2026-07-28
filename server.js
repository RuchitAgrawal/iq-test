const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Basic route for testing
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Import database
const db = require('./database');

// Import shared quiz engine (also used by bots)
const engine = require('./quiz-engine');

// API: Get randomized balanced question set
app.get('/api/questions', (req, res) => {
    // Select 20 random questions sorted by difficulty ascending after fetching
    db.all("SELECT * FROM questions ORDER BY RANDOM() LIMIT 20", [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Sort by difficulty ascending after fetching random
        rows.sort((a, b) => a.difficulty - b.difficulty);
        
        // Parse the options JSON string back to an array
        const formattedRows = rows.map(r => ({
            ...r,
            options: JSON.parse(r.options),
            options_svg: r.options_svg ? JSON.parse(r.options_svg) : null
        }));
        
        res.json(formattedRows);
    });
});

// API: Submit score
app.post('/api/score', async (req, res) => {
    const rawScore = Number(req.body.score || 0);
    const time_taken = Number(req.body.time_taken || 120);
    const { category_breakdown = {} } = req.body;
    const sessionId = req.body.session_id || `web-${Date.now()}`;

    try {
        const result = engine.calculateScore(rawScore, category_breakdown, time_taken);
        const resultId = await engine.saveResult(sessionId, result, time_taken);
        
        const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
        const imageUrl = `${appUrl}/api/image/${resultId}`;
        
        res.json({
            resultId,
            score: result.score,
            percentile: result.percentile,
            typeLabel: result.typeLabel,
            accentColor: result.accentColor,
            description: result.description,
            imageUrl,
            categories: result.categories
        });
    } catch (err) {
        console.error('Failed to process and save score:', err);
        res.status(500).json({ error: 'Failed to save score' });
    }
});

// API: Generate shareable image using Satori + resvg via shared engine
app.get('/api/image/:id', async (req, res) => {
    try {
        const buffer = await engine.generateCardBuffer(req.params.id);
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        if (error.message && error.message.includes('Result not found')) {
            return res.status(404).send('Not found');
        }
        console.error(error);
        res.status(500).send('Error generating image');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

    // Mount Telegram bot (grammy) if token is configured
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'DUMMY_TOKEN') {
        try {
            require('./telegram/bot');
            console.log('[bot] Telegram bot active (long-polling)');
        } catch (e) {
            console.error('[bot] Telegram bot failed to start:', e.message);
        }
    } else {
        console.log('[bot] Telegram bot skipped — TELEGRAM_BOT_TOKEN not set');
    }

    // Mount Discord bot if token is configured
    if (process.env.DISCORD_BOT_TOKEN) {
        try {
            require('./discord/bot');
            console.log('[bot] Discord bot active');
        } catch (e) {
            console.error('[bot] Discord bot failed to start:', e.message);
        }
    } else {
        console.log('[bot] Discord bot skipped — DISCORD_BOT_TOKEN not set');
    }
});
