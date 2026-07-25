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
    const rawScore = Number(req.body.score || 0);
    const time_taken = Number(req.body.time_taken || 120);
    const { category_breakdown = {}, group_id, user_id } = req.body;
    const sessionId = req.body.session_id || uuidv4();
    const resultId = uuidv4();
    
    const toIQ = (val, avgVal) => {
        const num = Number(val || 0);
        if (num >= 75) return Math.min(152, Math.max(78, Math.round(num)));
        return Math.min(152, Math.max(78, Math.round(78 + (num / avgVal) * 22)));
    };
    const score = toIQ(rawScore, 28);
    
    let percentile = 50;
    if (score >= 135) percentile = 99;
    else if (score >= 130) percentile = 98;
    else if (score >= 120) percentile = 92;
    else if (score >= 115) percentile = 84;
    else if (score >= 105) percentile = 65;
    else if (score >= 100) percentile = 50;
    else if (score >= 90) percentile = 35;
    else percentile = 20;
    
    const categories = {
        sequence: toIQ(category_breakdown.sequence, 7),
        logic: toIQ(category_breakdown.logic, 7),
        pattern: toIQ(category_breakdown.pattern, 7),
        spatial: toIQ(category_breakdown.spatial, 7)
    };
    
    let typeLabel = "Lateral Alchemist";
    let accentColor = "#f59e0b";
    let description = "Holistic mental agility blending creative leaps with structured calculation";
    
    const maxCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0] || ['logic', 0];
    const totalCatScore = Object.values(categories).reduce((a, b) => a + b, 0);
    
    if (time_taken <= 75 && score >= 100) {
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
        
        // Fetch result from DB and generate rich collectible card
        db.get("SELECT * FROM results WHERE id = ?", [req.params.id], async (err, row) => {
            if (err || !row) return res.status(404).send('Not found');
            
            let meta = { archetype: 'Lateral Alchemist', accentColor: '#3b82f6', description: 'Holistic mental agility blending creativity with structured calculation', categories: { logic: 0, pattern: 0, spatial: 0, sequence: 0 } };
            try {
                meta = { ...meta, ...JSON.parse(row.category_breakdown) };
            } catch (e) {
                console.error('Failed parsing breakdown for image', e);
            }
            
            const svg = await satori(
                {
                    type: 'div',
                    props: {
                        style: {
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                            width: 1200,
                            height: 630,
                            backgroundColor: '#090d16',
                            padding: 30,
                            fontFamily: 'Arial'
                        },
                        children: [
                            {
                                type: 'div',
                                props: {
                                    style: {
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'space-between',
                                        width: '100%',
                                        height: '100%',
                                        backgroundColor: '#111827',
                                        border: `4px solid ${meta.accentColor}`,
                                        borderRadius: 24,
                                        padding: 45
                                    },
                                    children: [
                                        // Header
                                        {
                                            type: 'div',
                                            props: {
                                                style: {
                                                    display: 'flex',
                                                    flexDirection: 'row',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    width: '100%'
                                                },
                                                children: [
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { fontSize: 24, color: '#64748b', fontWeight: 800, letterSpacing: 2 },
                                                            children: 'TLQ COGNITIVE DIAGNOSTIC'
                                                        }
                                                    },
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { display: 'flex', backgroundColor: '#1e293b', color: '#10b981', padding: '10px 24px', borderRadius: 30, fontSize: 26, fontWeight: 800 },
                                                            children: `TOP ${100 - row.percentile}% RANK`
                                                        }
                                                    }
                                                ]
                                            }
                                        },
                                        // Center Section
                                        {
                                            type: 'div',
                                            props: {
                                                style: {
                                                    display: 'flex',
                                                    flexDirection: 'row',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    width: '100%',
                                                    marginTop: 10
                                                },
                                                children: [
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { display: 'flex', flexDirection: 'column' },
                                                            children: [
                                                                {
                                                                    type: 'div',
                                                                    props: {
                                                                        style: { fontSize: 110, fontWeight: 800, color: '#f8fafc', lineHeight: 1 },
                                                                        children: row.score.toString()
                                                                    }
                                                                },
                                                                {
                                                                    type: 'div',
                                                                    props: {
                                                                        style: { fontSize: 22, color: '#94a3b8', marginTop: 12, fontWeight: 600 },
                                                                        children: 'COGNITIVE IQ INDEX'
                                                                    }
                                                                }
                                                            ]
                                                        }
                                                    },
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { display: 'flex', flexDirection: 'column', maxWidth: 580, alignItems: 'flex-end' },
                                                            children: [
                                                                {
                                                                    type: 'div',
                                                                    props: {
                                                                        style: { fontSize: 44, fontWeight: 800, color: meta.accentColor, textAlign: 'right' },
                                                                        children: meta.archetype.toUpperCase()
                                                                    }
                                                                },
                                                                {
                                                                    type: 'div',
                                                                    props: {
                                                                        style: { fontSize: 22, color: '#cbd5e1', textAlign: 'right', marginTop: 16, lineHeight: 1.4 },
                                                                        children: meta.description
                                                                    }
                                                                }
                                                            ]
                                                        }
                                                    }
                                                ]
                                            }
                                        },
                                        // Footer Section
                                        {
                                            type: 'div',
                                            props: {
                                                style: {
                                                    display: 'flex',
                                                    flexDirection: 'row',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    width: '100%',
                                                    borderTop: '2px solid #334155',
                                                    paddingTop: 24
                                                },
                                                children: [
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { fontSize: 19, color: '#94a3b8', fontWeight: 600 },
                                                            children: `Logic (${meta.categories?.logic || 85}) | Pattern (${meta.categories?.pattern || 85}) | Spatial (${meta.categories?.spatial || 85}) | Sequence (${meta.categories?.sequence || 85})`
                                                        }
                                                    },
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { fontSize: 24, fontWeight: 800, color: '#3b82f6' },
                                                            children: 'Can you beat this score in TLQ?'
                                                        }
                                                    }
                                                ]
                                            }
                                        }
                                    ]
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
