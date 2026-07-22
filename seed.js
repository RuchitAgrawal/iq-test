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
            const stmt = db.prepare("INSERT OR IGNORE INTO questions (id, category, difficulty, prompt, options, answer) VALUES (?, ?, ?, ?, ?, ?)");
            
            questions.forEach(q => {
                stmt.run(q.id, q.category, q.difficulty, q.prompt, JSON.stringify(q.options), q.answer);
            });
            
            stmt.finalize();
            console.log(`Seeded ${questions.length} questions into the database.`);
        });
    } catch (parseErr) {
        console.error('Error parsing JSON:', parseErr);
    }
});
