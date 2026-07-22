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
    // In a real scenario, this would pull a balanced mix.
    // For MVP, we pull 15 random questions sorted by difficulty ascending.
    db.all("SELECT * FROM questions ORDER BY RANDOM() LIMIT 15", [], (err, rows) => {
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

app.post('/api/score', (req, res) => {
    const { score, category_breakdown } = req.body;
    const sessionId = req.body.session_id || uuidv4();
    const resultId = uuidv4();
    
    // MVP Percentile calculation: fake it based on score 
    // Assuming max score is ~40. >30 is top 5%, >20 is top 15%, etc.
    let percentile = 50;
    if (score > 30) percentile = 95;
    else if (score > 20) percentile = 85;
    else if (score > 10) percentile = 60;
    
    // Fake "Type" calculation based on highest category (simplified for MVP)
    const typeLabel = "Pattern Thinker"; 
    
    const stmt = db.prepare("INSERT INTO results (id, session_id, score, percentile, category_breakdown) VALUES (?, ?, ?, ?, ?)");
    stmt.run(resultId, sessionId, score, percentile, JSON.stringify(category_breakdown || {}), (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to save score' });
        }
        res.json({ resultId, score, percentile, typeLabel });
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
