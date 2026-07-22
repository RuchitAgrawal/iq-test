const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'iqtest.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        // Setup initial tables
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS questions (
                id TEXT PRIMARY KEY,
                category TEXT,
                difficulty INTEGER,
                prompt TEXT,
                options TEXT,
                answer TEXT
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS results (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                score REAL,
                percentile INTEGER,
                category_breakdown TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS telegram_groups (
                group_id TEXT PRIMARY KEY,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS telegram_scores (
                group_id TEXT,
                user_id TEXT,
                best_score REAL,
                last_played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (group_id, user_id)
            )`);
        });
    }
});

module.exports = db;
