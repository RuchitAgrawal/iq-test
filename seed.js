const db = require('./database');
const fs = require('fs');
const path = require('path');

const questionsFile = path.resolve(__dirname, 'questions.json');

fs.readFile(questionsFile, 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading questions.json:', err);
        return;
    }

    try {
        const questions = JSON.parse(data);
        
        db.serialize(() => {
            db.run("DROP TABLE IF EXISTS questions");
            db.run(`CREATE TABLE questions (
                id TEXT PRIMARY KEY,
                category TEXT,
                difficulty INTEGER,
                prompt TEXT,
                options TEXT,
                answer TEXT,
                visual_svg TEXT
            )`);
            const stmt = db.prepare("INSERT INTO questions (id, category, difficulty, prompt, options, answer, visual_svg) VALUES (?, ?, ?, ?, ?, ?, ?)");
            
            questions.forEach(q => {
                stmt.run(q.id, q.category, q.difficulty, q.prompt, JSON.stringify(q.options), q.answer, q.visual_svg || null);
            });
            
            stmt.finalize();
            console.log(`Seeded ${questions.length} questions into the database.`);
        });
    } catch (parseErr) {
        console.error('Error parsing JSON:', parseErr);
    }
});
