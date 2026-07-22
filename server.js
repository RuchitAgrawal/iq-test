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

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
