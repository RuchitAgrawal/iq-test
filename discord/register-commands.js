/**
 * discord/register-commands.js
 *
 * One-time script to register the /iqtest slash command with Discord's API.
 * Must be run once after creating the Discord Application and setting the
 * DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN in .env
 *
 * Run with:  node discord/register-commands.js
 *
 * To register for a specific guild during development (faster propagation):
 *   DISCORD_GUILD_ID=your_guild_id node discord/register-commands.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { REST, Routes }              = require('@discordjs/rest');
const { ApplicationCommandOptionType } = require('discord-api-types/v10');

const TOKEN     = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID  = process.env.DISCORD_GUILD_ID; // Optional: guild-scoped for testing

if (!TOKEN || !CLIENT_ID) {
    console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set in .env');
    process.exit(1);
}

const commands = [
    {
        name:        'iqtest',
        description: 'TLQ Cognitive Assessment — test your analytical intelligence',
        options: [
            {
                name:        'action',
                description: 'Action to perform',
                type:        ApplicationCommandOptionType.String,
                required:    false,
                choices: [
                    { name: 'Start Assessment',  value: 'start' },
                    { name: 'Leaderboard',        value: 'leaderboard' },
                    { name: 'My Rank',            value: 'rank' },
                ],
            },
        ],
    },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Registering application commands…');

        let route;
        if (GUILD_ID) {
            route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
            console.log(`Target: Guild ${GUILD_ID} (instant propagation)`);
        } else {
            route = Routes.applicationCommands(CLIENT_ID);
            console.log('Target: Global (up to 1 hour propagation)');
        }

        const data = await rest.put(route, { body: commands });
        console.log(`Successfully registered ${data.length} command(s).`);
    } catch (err) {
        console.error('Command registration failed:', err);
        process.exit(1);
    }
})();
