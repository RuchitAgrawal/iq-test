# TLQ Cognitive Assessment Engine

A fully self-contained IQ-style cognitive assessment experience playable as:

- **A web application** — complete with result cards and shareable dossiers
- **A Telegram bot** — full in-chat quiz flow, inline keyboards, group leaderboards
- **A Discord bot** — native slash command `/iqtest`, ephemeral questions, public result embeds

---

## What's inside

```
iq-test/
├── server.js               Express API + static file server
├── quiz-engine.js          Shared scoring, archetype, and PNG card generation
├── session.js              In-memory session store (Telegram + Discord)
├── database.js             SQLite schema management
├── seed.js                 Populates database from questions.json
├── questions.json          All quiz questions (text + SVG visual ones)
├── arial.ttf               Font used for result card generation
│
├── telegram/
│   └── bot.js              Telegram bot (grammy — long-polling)
│
├── discord/
│   ├── bot.js              Discord bot (discord.js v14 — gateway)
│   └── register-commands.js  One-time slash command registration script
│
├── scripts/
│   └── prerender-svg.js    Converts SVG visual questions → PNG for bots
│
├── public/
│   ├── index.html          Web app entry point
│   ├── css/style.css       Premium dark noir stylesheet
│   └── question-assets/    Pre-rendered question PNGs (git-ignored, generated locally)
│
└── .env.example            Environment variable template
```

---

## Prerequisites

- **Node.js** v18+ (required for ESM `satori` interop and top-level await)
- **npm** v9+
- A bot token from Telegram **@BotFather** (for Telegram) and/or a Discord application (for Discord)

---

## Setup — Step by Step

### 1. Clone the repository

```bash
git clone https://github.com/RuchitAgrawal/iq-test.git
cd iq-test
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the values you need:

```env
# Required for share links and result card URLs
APP_URL=http://localhost:3000

# Port for the Express server
PORT=3000

# --- TELEGRAM (optional) ---
# Get from @BotFather on Telegram
TELEGRAM_BOT_TOKEN=

# --- DISCORD (optional) ---
# From https://discord.com/developers/applications → Your App → Bot → Token
DISCORD_BOT_TOKEN=

# From General Information → Application ID
DISCORD_CLIENT_ID=

# Guild (server) ID for fast development registration (optional)
DISCORD_GUILD_ID=
```

> You do **not** need both bot tokens. Only configure the platforms you want to use. The server starts cleanly even if both are absent.

### 4. Seed the database

This populates the SQLite database with all quiz questions from `questions.json`. Run this **once** when setting up for the first time:

```bash
node seed.js
```

You should see: `Seeded 50 questions into the database.`

### 5. Pre-render visual question images (for bots)

Visual geometry and pattern questions are stored as SVG in the database. This command converts them to PNG files that bots can send as image attachments:

```bash
npm run prerender
```

You should see output like:
```
[prerender] Processing 5 visual question(s)...
  [OK] public/question-assets/q-pattern-003.png
  ...
[prerender] Done. Rendered: 17  Skipped: 0
```

> This only needs to be re-run if you add new visual questions to `questions.json` and re-seed.

### 6. (Discord only) Register slash commands

This is a **one-time step per Discord server**. It registers the `/iqtest` command with Discord's API:

```bash
node discord/register-commands.js
```

- With `DISCORD_GUILD_ID` set → instant registration on that server only (great for testing)
- Without `DISCORD_GUILD_ID` → global registration, takes **up to 1 hour** to propagate

You only need to run this again if you add or rename commands.

### 7. Start the server

```bash
npm start
```

Expected console output (with both tokens configured):
```
[quiz-engine] Loaded 5 pre-rendered visual question asset(s)
Server is running on port 3000
[bot] Telegram bot active (long-polling)
[bot] Discord bot active
Connected to the SQLite database.
[telegram] Bot @YourBotName started in long-polling mode
[discord] Logged in as YourBot#1234
```

The web app is now at **http://localhost:3000**

---

## Telegram Bot — Usage

Once your `TELEGRAM_BOT_TOKEN` is set and the server is running:

| Command | What it does |
|---|---|
| `/start` or `/iqtest` | Begin a cognitive assessment (or resume an active one) |
| `/leaderboard` | View the top 10 scores for the current group/chat |
| `/rank` | View your personal best score |
| `/help` | Command reference |

**Group behaviour:** When a user completes an assessment in a group chat, their result card is automatically posted publicly to the group with a leaderboard update prompt.

---

## Discord Bot — Usage

Invite your bot to a server via the OAuth2 URL from the Discord Developer Portal. Make sure you grant it:
- `applications.commands` scope
- `bot` scope with **Send Messages** and **Attach Files** permissions

| Command | What it does |
|---|---|
| `/iqtest start` | Start a private (ephemeral) cognitive assessment |
| `/iqtest leaderboard` | Server-wide leaderboard embed |
| `/iqtest rank` | Your personal best on this server |

**Channel behaviour:** Assessment questions run in a private/ephemeral flow. On completion, the result card and score are posted **publicly** to the channel where the command was issued.

---

## Adding Your Own Questions

Edit `questions.json`. Each question looks like this:

```json
{
  "id": "logic-001",
  "category": "logic",
  "difficulty": 2,
  "prompt": "Your question text here?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "answer": "Option B",
  "visual_svg": null,
  "options_svg": null
}
```

For visual/pattern questions, set `visual_svg` to an SVG string and `options_svg` to an array of SVG strings (one per option).

After editing:
```bash
node seed.js        # re-seed the database
npm run prerender   # regenerate visual PNGs if you added SVG questions
```

---

## Architecture Notes (for integrating into a larger project)

The codebase is deliberately modular:

- **`quiz-engine.js`** is the core. Import it anywhere — it's not coupled to HTTP, Telegram, or Discord. It exports:
  - `getQuestions()` → Promise resolving to an array of 20 randomised questions
  - `calculateScore(rawScore, categoryBreakdown, timeTaken)` → result object with IQ index, percentile, archetype, categories
  - `saveResult(sessionId, result, timeTaken)` → Promise resolving to a `resultId` string (saved to SQLite)
  - `generateCardBuffer(resultId)` → Promise resolving to a `Buffer` containing the 1200×630px PNG result card

- **`session.js`** is platform-agnostic. The key namespace format is `platform:userId` so Telegram and Discord user IDs never collide. You can add a third platform without touching the existing bot code.

- **`database.js`** auto-creates all tables on first run (web results, Telegram scores, Discord scores). No manual migration scripts needed for a fresh setup.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | Recommended | Public URL of your server. Used in share links. Default: `http://localhost:3000` |
| `PORT` | Optional | Server port. Default: `3000` |
| `TELEGRAM_BOT_TOKEN` | For Telegram | From @BotFather |
| `DISCORD_BOT_TOKEN` | For Discord | From Discord Developer Portal |
| `DISCORD_CLIENT_ID` | For Discord | Application ID from Developer Portal |
| `DISCORD_GUILD_ID` | Dev only | For instant slash command registration on one server |

---

## Common Issues

**`Cannot find module './bot'` on start**
→ You're running an older version. The root `bot.js` has been removed. Pull the latest commit.

**Telegram bot starts but doesn't respond**
→ Make sure your token has no spaces. Test with `curl https://api.telegram.org/bot<TOKEN>/getMe`.

**Discord slash command not showing up**
→ Run `node discord/register-commands.js`. If `DISCORD_GUILD_ID` is not set, wait up to 1 hour for global propagation.

**`question-assets` directory missing, visual questions not sending images**
→ Run `npm run prerender` after seeding. The directory is git-ignored so it must be generated locally.

**`iqtest.db` not found / empty**
→ Run `node seed.js` first.
