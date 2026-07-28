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
            options: JSON.parse(r.options),
            options_svg: r.options_svg ? JSON.parse(r.options_svg) : null
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
    let accentColor = "#e8943a";
    let description = "Holistic mental agility blending intuitive analytical leaps with structured calculation";
    
    const maxCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0] || ['logic', 0];
    const totalCatScore = Object.values(categories).reduce((a, b) => a + b, 0);
    
    if (time_taken <= 75 && score >= 100) {
        typeLabel = "Neural Speedster";
        accentColor = "#c9a84c";
        description = "Rapid analytical instinct and high-velocity pattern deduction under intense time pressure";
    } else if (maxCat[0] === 'logic' && maxCat[1] > (totalCatScore * 0.3)) {
        typeLabel = "Logic Weaver";
        accentColor = "#d4af37";
        description = "Mastery of rigorous deductive reasoning and structured evidential verification";
    } else if ((maxCat[0] === 'pattern' || maxCat[0] === 'sequence') && maxCat[1] > (totalCatScore * 0.3)) {
        typeLabel = "Pattern Seer";
        accentColor = "#e6a817";
        description = "Heightened recognition of symbolic geometries and complex numerical ciphers";
    } else if (maxCat[0] === 'spatial' && maxCat[1] > (totalCatScore * 0.3)) {
        typeLabel = "Spatial Architect";
        accentColor = "#f0b146";
        description = "Exceptional three-dimensional visual reasoning and structural transformation capacity";
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
            
            let meta = { archetype: 'Lateral Alchemist', accentColor: '#e8943a', description: 'Holistic mental agility blending intuitive analytical leaps with structured calculation', categories: { logic: 0, pattern: 0, spatial: 0, sequence: 0 } };
            try {
                meta = { ...meta, ...JSON.parse(row.category_breakdown) };
            } catch (e) {
                console.error('Failed parsing breakdown for image', e);
            }
            
            const accent = meta.accentColor || '#e8943a';
            
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
                            backgroundColor: '#000000',
                            padding: 32,
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
                                        backgroundColor: '#080808',
                                        border: '2px solid #222222',
                                        borderLeft: `14px solid ${accent}`,
                                        borderRadius: 12,
                                        padding: 48
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
                                                            style: { fontSize: 20, color: '#888888', fontWeight: 700, letterSpacing: 4 },
                                                            children: 'THE LAST QUESTION // COGNITIVE DOSSIER'
                                                        }
                                                    },
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { display: 'flex', backgroundColor: '#111111', color: accent, border: '1px solid #333333', padding: '8px 20px', borderRadius: 6, fontSize: 20, fontWeight: 700, letterSpacing: 2 },
                                                            children: `TOP ${100 - row.percentile}% PERCENTILE`
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
                                                                        style: { fontSize: 118, fontWeight: 700, color: '#ffffff', lineHeight: 1 },
                                                                        children: row.score.toString()
                                                                    }
                                                                },
                                                                {
                                                                    type: 'div',
                                                                    props: {
                                                                        style: { fontSize: 20, color: accent, marginTop: 14, fontWeight: 700, letterSpacing: 3 },
                                                                        children: 'COGNITIVE IQ INDEX'
                                                                    }
                                                                }
                                                            ]
                                                        }
                                                    },
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { display: 'flex', flexDirection: 'column', maxWidth: 560, alignItems: 'flex-end' },
                                                            children: [
                                                                {
                                                                    type: 'div',
                                                                    props: {
                                                                        style: { fontSize: 44, fontWeight: 700, color: '#ffffff', textAlign: 'right', letterSpacing: 1 },
                                                                        children: meta.archetype.toUpperCase()
                                                                    }
                                                                },
                                                                {
                                                                    type: 'div',
                                                                    props: {
                                                                        style: { fontSize: 22, color: '#999999', textAlign: 'right', marginTop: 16, lineHeight: 1.5 },
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
                                                    borderTop: '1px solid #222222',
                                                    paddingTop: 26
                                                },
                                                children: [
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { fontSize: 18, color: '#777777', fontWeight: 700, letterSpacing: 1 },
                                                            children: `Logic (${meta.categories?.logic || 100}) | Pattern (${meta.categories?.pattern || 100}) | Spatial (${meta.categories?.spatial || 100})`
                                                        }
                                                    },
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { fontSize: 22, fontWeight: 700, color: accent, letterSpacing: 3 },
                                                            children: 'THELASTQUESTION.IO'
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
