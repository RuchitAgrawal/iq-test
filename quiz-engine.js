/**
 * quiz-engine.js
 * Shared quiz logic module used by both Telegram and Discord bots.
 * Extracts scoring, archetype determination, result persistence,
 * and Satori card PNG buffer generation from server.js.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');
const db   = require('./database');

// ---------------------------------------------------------------------------
// Visual Asset Map — pre-rendered PNG paths for visual questions
// ---------------------------------------------------------------------------

const ASSETS_DIR = path.join(__dirname, 'public', 'question-assets');

/**
 * Map of questionId -> absolute PNG file path for visual questions.
 * Populated lazily on first getQuestions() call.
 * @type {Map<string, string>}
 */
const visualAssetMap = new Map();

/** Load pre-rendered question PNGs from the assets directory into the map. */
function loadVisualAssets() {
    if (!fs.existsSync(ASSETS_DIR)) return;
    const files = fs.readdirSync(ASSETS_DIR);
    for (const file of files) {
        // Match main question images: q-{id}.png (not option images)
        const match = file.match(/^q-(.+)\.png$/);
        if (match && !file.includes('-opt-')) {
            const questionId = match[1];
            visualAssetMap.set(questionId, path.join(ASSETS_DIR, file));
        }
    }
    if (visualAssetMap.size > 0) {
        console.log(`[quiz-engine] Loaded ${visualAssetMap.size} pre-rendered visual question asset(s)`);
    }
}

// Run once at module load
loadVisualAssets();

// ---------------------------------------------------------------------------
// Question Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch a randomised, difficulty-sorted question set from the database.
 * Visual questions are annotated with an `imagePath` field pointing to
 * the pre-rendered PNG (if available) for use by bot delivery layers.
 * @returns {Promise<Array>} Resolved question array
 */
function getQuestions() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM questions ORDER BY RANDOM() LIMIT 20', [], (err, rows) => {
            if (err) return reject(err);

            // Sort by difficulty after random fetch (mirrors /api/questions behaviour)
            rows.sort((a, b) => a.difficulty - b.difficulty);

            const formatted = rows.map(r => ({
                ...r,
                options:     JSON.parse(r.options),
                options_svg: r.options_svg ? JSON.parse(r.options_svg) : null,
                // Bot delivery: path to pre-rendered PNG (null if not available)
                imagePath:   visualAssetMap.get(r.id) || null,
            }));

            resolve(formatted);
        });
    });
}

// ---------------------------------------------------------------------------
// IQ Score Calculation & Archetype
// ---------------------------------------------------------------------------

/**
 * Convert a raw accumulated question score to an IQ-scale integer.
 * @param {number} val     Raw score value
 * @param {number} avgVal  Expected average raw score for this category
 * @returns {number} IQ-scaled integer (78 - 152)
 */
function toIQ(val, avgVal) {
    const num = Number(val || 0);
    if (num >= 75) return Math.min(152, Math.max(78, Math.round(num)));
    return Math.min(152, Math.max(78, Math.round(78 + (num / avgVal) * 22)));
}

/**
 * Derive percentile bracket from IQ score.
 * @param {number} score IQ-scaled score
 * @returns {number} Percentile (0-100)
 */
function scoreToPercentile(score) {
    if (score >= 135) return 99;
    if (score >= 130) return 98;
    if (score >= 120) return 92;
    if (score >= 115) return 84;
    if (score >= 105) return 65;
    if (score >= 100) return 50;
    if (score >=  90) return 35;
    return 20;
}

/**
 * Determine cognitive archetype based on category dominance and time.
 * @param {object} categories  IQ-scaled per-category scores { logic, pattern, spatial, sequence }
 * @param {number} timeTaken   Total seconds elapsed
 * @param {number} score       Overall IQ score
 * @returns {{ typeLabel: string, accentColor: string, description: string }}
 */
function deriveArchetype(categories, timeTaken, score) {
    const maxCat        = Object.entries(categories).sort((a, b) => b[1] - a[1])[0] || ['logic', 0];
    const totalCatScore = Object.values(categories).reduce((a, b) => a + b, 0);

    if (timeTaken <= 75 && score >= 100) {
        return {
            typeLabel:   'Neural Speedster',
            accentColor: '#c9a84c',
            description: 'Rapid analytical instinct and high-velocity pattern deduction under intense time pressure',
        };
    }
    if (maxCat[0] === 'logic' && maxCat[1] > totalCatScore * 0.3) {
        return {
            typeLabel:   'Logic Weaver',
            accentColor: '#d4af37',
            description: 'Mastery of rigorous deductive reasoning and structured evidential verification',
        };
    }
    if ((maxCat[0] === 'pattern' || maxCat[0] === 'sequence') && maxCat[1] > totalCatScore * 0.3) {
        return {
            typeLabel:   'Pattern Seer',
            accentColor: '#e6a817',
            description: 'Heightened recognition of symbolic geometries and complex numerical ciphers',
        };
    }
    if (maxCat[0] === 'spatial' && maxCat[1] > totalCatScore * 0.3) {
        return {
            typeLabel:   'Spatial Architect',
            accentColor: '#f0b146',
            description: 'Exceptional three-dimensional visual reasoning and structural transformation capacity',
        };
    }
    return {
        typeLabel:   'Lateral Alchemist',
        accentColor: '#e8943a',
        description: 'Holistic mental agility blending intuitive analytical leaps with structured calculation',
    };
}

/**
 * Full score calculation pipeline.
 * @param {number} rawScore           Accumulated raw answer score
 * @param {object} categoryBreakdown  Raw per-category scores { logic, pattern, spatial, sequence }
 * @param {number} timeTaken          Total seconds elapsed
 * @returns {{ score, percentile, typeLabel, accentColor, description, categories }}
 */
function calculateScore(rawScore, categoryBreakdown = {}, timeTaken = 120) {
    const score      = toIQ(rawScore, 28);
    const percentile = scoreToPercentile(score);

    const categories = {
        sequence: toIQ(categoryBreakdown.sequence, 7),
        logic:    toIQ(categoryBreakdown.logic,    7),
        pattern:  toIQ(categoryBreakdown.pattern,  7),
        spatial:  toIQ(categoryBreakdown.spatial,  7),
    };

    const { typeLabel, accentColor, description } = deriveArchetype(categories, timeTaken, score);

    return { score, percentile, typeLabel, accentColor, description, categories };
}

// ---------------------------------------------------------------------------
// Result Persistence
// ---------------------------------------------------------------------------

/**
 * Save a completed session result to the database.
 * @param {string} sessionId  Client session identifier
 * @param {object} result     Output of calculateScore()
 * @param {number} timeTaken  Seconds elapsed
 * @returns {Promise<string>} resultId (UUID)
 */
function saveResult(sessionId, result, timeTaken) {
    return new Promise((resolve, reject) => {
        const resultId = uuidv4();
        const { score, percentile, typeLabel, accentColor, description, categories } = result;

        const detailedData = JSON.stringify({
            categories,
            archetype: typeLabel,
            accentColor,
            description,
            timeTaken,
        });

        const stmt = db.prepare(
            'INSERT INTO results (id, session_id, score, percentile, category_breakdown) VALUES (?, ?, ?, ?, ?)'
        );
        stmt.run(resultId, sessionId, score, percentile, detailedData, (err) => {
            if (err) return reject(err);
            resolve(resultId);
        });
        stmt.finalize();
    });
}

// ---------------------------------------------------------------------------
// Satori PNG Card Buffer Generation
// ---------------------------------------------------------------------------

/**
 * Generate a PNG Buffer for the result card identified by resultId.
 * Returns a raw Buffer suitable for sending directly via bot APIs.
 * @param {string} resultId
 * @returns {Promise<Buffer>}
 */
async function generateCardBuffer(resultId) {
    const { default: satori } = await import('satori');
    const { Resvg }           = require('@resvg/resvg-js');
    const fontData            = fs.readFileSync(path.join(__dirname, 'arial.ttf'));

    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM results WHERE id = ?', [resultId], async (err, row) => {
            if (err || !row) return reject(new Error('Result not found: ' + resultId));

            let meta = {
                archetype:   'Lateral Alchemist',
                accentColor: '#e8943a',
                description: 'Holistic mental agility blending intuitive analytical leaps with structured calculation',
                categories:  { logic: 100, pattern: 100, spatial: 100, sequence: 100 },
            };
            try { meta = { ...meta, ...JSON.parse(row.category_breakdown) }; } catch (_) {}

            const accent = meta.accentColor || '#e8943a';

            const svgString = await satori(
                {
                    type: 'div',
                    props: {
                        style: {
                            display:         'flex',
                            flexDirection:   'column',
                            justifyContent:  'center',
                            alignItems:      'center',
                            width:           1200,
                            height:          630,
                            backgroundColor: '#000000',
                            padding:         32,
                            fontFamily:      'Arial',
                        },
                        children: [{
                            type: 'div',
                            props: {
                                style: {
                                    display:         'flex',
                                    flexDirection:   'column',
                                    justifyContent:  'space-between',
                                    width:           '100%',
                                    height:          '100%',
                                    backgroundColor: '#080808',
                                    border:          '2px solid #222222',
                                    borderLeft:      `14px solid ${accent}`,
                                    borderRadius:    12,
                                    padding:         48,
                                },
                                children: [
                                    // Header
                                    {
                                        type: 'div',
                                        props: {
                                            style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
                                            children: [
                                                { type: 'div', props: { style: { fontSize: 20, color: '#888888', fontWeight: 700, letterSpacing: 4 }, children: 'THE LAST QUESTION // COGNITIVE DOSSIER' } },
                                                { type: 'div', props: { style: { display: 'flex', backgroundColor: '#111111', color: accent, border: '1px solid #333333', padding: '8px 20px', borderRadius: 6, fontSize: 20, fontWeight: 700, letterSpacing: 2 }, children: `TOP ${100 - row.percentile}% PERCENTILE` } },
                                            ],
                                        },
                                    },
                                    // Center
                                    {
                                        type: 'div',
                                        props: {
                                            style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: 10 },
                                            children: [
                                                {
                                                    type: 'div',
                                                    props: {
                                                        style: { display: 'flex', flexDirection: 'column' },
                                                        children: [
                                                            { type: 'div', props: { style: { fontSize: 118, fontWeight: 700, color: '#ffffff', lineHeight: 1 }, children: row.score.toString() } },
                                                            { type: 'div', props: { style: { fontSize: 20, color: accent, marginTop: 14, fontWeight: 700, letterSpacing: 3 }, children: 'COGNITIVE IQ INDEX' } },
                                                        ],
                                                    },
                                                },
                                                {
                                                    type: 'div',
                                                    props: {
                                                        style: { display: 'flex', flexDirection: 'column', maxWidth: 560, alignItems: 'flex-end' },
                                                        children: [
                                                            { type: 'div', props: { style: { fontSize: 44, fontWeight: 700, color: '#ffffff', textAlign: 'right', letterSpacing: 1 }, children: meta.archetype.toUpperCase() } },
                                                            { type: 'div', props: { style: { fontSize: 22, color: '#999999', textAlign: 'right', marginTop: 16, lineHeight: 1.5 }, children: meta.description } },
                                                        ],
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                    // Footer
                                    {
                                        type: 'div',
                                        props: {
                                            style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderTop: '1px solid #222222', paddingTop: 26 },
                                            children: [
                                                { type: 'div', props: { style: { fontSize: 18, color: '#777777', fontWeight: 700, letterSpacing: 1 }, children: `Logic (${meta.categories?.logic || 100}) | Pattern (${meta.categories?.pattern || 100}) | Spatial (${meta.categories?.spatial || 100})` } },
                                                { type: 'div', props: { style: { fontSize: 22, fontWeight: 700, color: accent, letterSpacing: 3 }, children: 'THELASTQUESTION.IO' } },
                                            ],
                                        },
                                    },
                                ],
                            },
                        }],
                    },
                },
                {
                    width:  1200,
                    height: 630,
                    fonts:  [{ name: 'Arial', data: fontData, weight: 400, style: 'normal' }],
                }
            );

            const resvg  = new Resvg(svgString, { fitTo: { mode: 'width', value: 1200 } });
            const pngBuf = resvg.render().asPng();
            resolve(pngBuf);
        });
    });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    getQuestions,
    calculateScore,
    saveResult,
    generateCardBuffer,
    toIQ,
    scoreToPercentile,
    deriveArchetype,
};
