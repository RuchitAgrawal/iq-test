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
            options: JSON.parse(r.options)
        }));
        
        res.json(formattedRows);
    });
});

// API: Submit score
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { bot, postResultToGroup } = require('./bot');

app.post('/bot' + (process.env.TELEGRAM_BOT_TOKEN || 'DUMMY_TOKEN'), (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.post('/api/score', (req, res) => {
    const { score = 0, category_breakdown = {}, time_taken = 120, group_id, user_id } = req.body;
    const sessionId = req.body.session_id || uuidv4();
    const resultId = uuidv4();
    
    let percentile = 50;
    if (score >= 45) percentile = 98;
    else if (score >= 35) percentile = 92;
    else if (score >= 25) percentile = 84;
    else if (score >= 15) percentile = 68;
    
    const categories = {
        sequence: category_breakdown.sequence || 0,
        logic: category_breakdown.logic || 0,
        pattern: category_breakdown.pattern || 0,
        spatial: category_breakdown.spatial || 0
    };
    
    let typeLabel = "Lateral Alchemist";
    let accentColor = "#f59e0b";
    let description = "Holistic mental agility blending creative leaps with structured calculation";
    
    const maxCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0] || ['logic', 0];
    const totalCatScore = Object.values(categories).reduce((a, b) => a + b, 0);
    
    if (time_taken <= 75 && score >= 20) {
        typeLabel = "Neural Speedster";
        accentColor = "#ec4899";
        description = "Rapid instinct and high-velocity pattern processing under time pressure";
    } else if (maxCat[0] === 'logic' && maxCat[1] > (totalCatScore * 0.3)) {
        typeLabel = "Logic Weaver";
        accentColor = "#3b82f6";
        description = "Mastery of rigorous deductive reasoning and structural analytical depth";
    } else if ((maxCat[0] === 'pattern' || maxCat[0] === 'sequence') && maxCat[1] > (totalCatScore * 0.3)) {
        typeLabel = "Pattern Seer";
        accentColor = "#a855f7";
        description = "Unusually heightened awareness of abstract geometries and mathematical ciphers";
    } else if (maxCat[0] === 'spatial' && maxCat[1] > (totalCatScore * 0.3)) {
        typeLabel = "Spatial Architect";
        accentColor = "#10b981";
        description = "Exceptional three-dimensional mental rotation and spatial geometry insight";
    }
    
    const detailedData = {
        categories,
        archetype: typeLabel,
        accentColor,
        description,
        timeTaken: time_taken
    };
    
    const stmt = db.prepare("INSERT INTO results (id, session_id, score, percentile, category_breakdown) VALUES (?, ?, ?, ?, ?)");
    stmt.run(resultId, sessionId, score, percentile, JSON.stringify(detailedData), (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to save score' });
        }
        
        const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
        const imageUrl = `${appUrl}/api/image/${resultId}`;
        
        if (group_id && user_id) {
            postResultToGroup(group_id, user_id, score, imageUrl, typeLabel);
        }
        
        res.json({ resultId, score, percentile, typeLabel, accentColor, description, imageUrl, categories });
    });
    stmt.finalize();
});

// API: Generate shareable image using Satori + resvg
app.get('/api/image/:id', async (req, res) => {
    try {
        const { default: satori } = await import('satori');
        const { Resvg } = require('@resvg/resvg-js');
        
        const fontData = fs.readFileSync(path.join(__dirname, 'arial.ttf'));
        
        // Fetch result from DB
        db.get("SELECT * FROM results WHERE id = ?", [req.params.id], async (err, row) => {
            if (err || !row) return res.status(404).send('Not found');
            
            const svg = await satori(
                {
                    type: 'div',
                    props: {
                        style: {
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                            width: '100%',
                            height: '100%',
                            backgroundColor: '#0f172a',
                            color: '#f8fafc',
                            fontFamily: 'Arial',
                        },
                        children: [
                            {
                                type: 'div',
                                props: {
                                    style: { fontSize: 48, fontWeight: 800, marginBottom: 20 },
                                    children: 'Cognitive Score'
                                }
                            },
                            {
                                type: 'div',
                                props: {
                                    style: { fontSize: 120, fontWeight: 800, color: '#3b82f6', marginBottom: 20 },
                                    children: row.score.toString()
                                }
                            },
                            {
                                type: 'div',
                                props: {
                                    style: { fontSize: 32, color: '#10b981' },
                                    children: `Top ${100 - row.percentile}%`
                                }
                            }
                        ]
                    }
                },
                {
                    width: 1200,
                    height: 630,
                    fonts: [
                        {
                            name: 'Arial',
                            data: fontData,
                            weight: 400,
                            style: 'normal',
                        },
                    ],
                }
            );
            
            const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
            const pngData = resvg.render().asPng();
            
            res.setHeader('Content-Type', 'image/png');
            res.send(pngData);
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error generating image');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
