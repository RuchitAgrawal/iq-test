#!/usr/bin/env node
/**
 * scripts/prerender-svg.js
 *
 * One-time (and on-demand) script that reads every question with a visual_svg
 * field from the database and writes it as a PNG file into
 * public/question-assets/q-{id}.png
 *
 * Run with:  node scripts/prerender-svg.js
 *
 * The generated files are committed to .gitignore and regenerated during
 * deployment / when new visual questions are added.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const db   = require('../database');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'question-assets');

async function main() {
    // Ensure output directory exists
    if (!fs.existsSync(ASSETS_DIR)) {
        fs.mkdirSync(ASSETS_DIR, { recursive: true });
        console.log(`[prerender] Created output directory: ${ASSETS_DIR}`);
    }

    // Lazy-load resvg (ESM-compatible import not needed here — it's CJS)
    const { Resvg } = require('@resvg/resvg-js');

    // Fetch all questions that have a visual_svg value
    const questions = await new Promise((resolve, reject) => {
        db.all(
            `SELECT id, visual_svg, options_svg FROM questions
             WHERE visual_svg IS NOT NULL AND visual_svg != ''`,
            [],
            (err, rows) => (err ? reject(err) : resolve(rows))
        );
    });

    if (questions.length === 0) {
        console.log('[prerender] No visual questions found in database.');
        process.exit(0);
    }

    console.log(`[prerender] Processing ${questions.length} visual question(s)…\n`);

    let rendered = 0;
    let skipped  = 0;

    for (const q of questions) {
        // ── Main question SVG ────────────────────────────────────────────────
        const outPath = path.join(ASSETS_DIR, `q-${q.id}.png`);

        try {
            // Wrap inline SVG in a full SVG document if it isn't already
            const svgSource = ensureFullSvg(q.visual_svg, 360, 160);
            const resvg     = new Resvg(svgSource, {
                fitTo:      { mode: 'width', value: 720 },  // 2x for sharpness
                background: '#111111',
            });
            const pngData   = resvg.render().asPng();
            fs.writeFileSync(outPath, pngData);
            console.log(`  [OK] ${outPath}`);
            rendered++;
        } catch (err) {
            console.error(`  [FAIL] q-${q.id}.png — ${err.message}`);
            skipped++;
        }

        // ── Options SVG (if present) ─────────────────────────────────────────
        if (q.options_svg) {
            let optionsSvgArr;
            try { optionsSvgArr = JSON.parse(q.options_svg); } catch (_) { continue; }

            for (let i = 0; i < optionsSvgArr.length; i++) {
                const optPath = path.join(ASSETS_DIR, `q-${q.id}-opt-${i}.png`);
                try {
                    const svgSource = ensureFullSvg(optionsSvgArr[i], 60, 60);
                    const resvg     = new Resvg(svgSource, {
                        fitTo:      { mode: 'width', value: 120 },
                        background: '#111111',
                    });
                    const pngData   = resvg.render().asPng();
                    fs.writeFileSync(optPath, pngData);
                    console.log(`  [OK] ${optPath}`);
                    rendered++;
                } catch (err) {
                    console.error(`  [FAIL] q-${q.id}-opt-${i}.png — ${err.message}`);
                    skipped++;
                }
            }
        }
    }

    console.log(`\n[prerender] Done. Rendered: ${rendered}  Skipped: ${skipped}`);
    db.close();
}

/**
 * Ensure the SVG string is a fully valid SVG document with xmlns.
 * Handles: bare fragments, <svg> tags without xmlns, and complete SVG docs.
 * @param {string} svgStr   Raw SVG markup
 * @param {number} w        Fallback width
 * @param {number} h        Fallback height
 * @returns {string}
 */
function ensureFullSvg(svgStr, w, h) {
    const trimmed = (svgStr || '').trim();

    // Already a well-formed SVG document with xmlns
    if (trimmed.startsWith('<svg') && trimmed.includes('xmlns')) return trimmed;

    // Has <svg> root but is missing xmlns — inject it
    if (trimmed.startsWith('<svg')) {
        return trimmed.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg"`);
    }

    // Bare fragment — wrap in a complete SVG root
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${trimmed}</svg>`;
}

main().catch((err) => {
    console.error('[prerender] Fatal error:', err);
    process.exit(1);
});
