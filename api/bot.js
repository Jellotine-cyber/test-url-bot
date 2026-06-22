import { Telegraf } from 'telegraf';
import Redis from 'ioredis';

// 1. Initialize Redis directly using your single connection string
// ioredis natively understands the redis:// format completely!
const kv = new Redis(process.env.REDIS_URL);

// Handle background connection errors to prevent server crash
kv.on('error', (err) => console.error('Redis Connection Error:', err));

// 2. Initialize the Telegraf bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- TELEGRAM BOT COMMAND HANDLERS ---

bot.start((ctx) => ctx.reply('🚀 Website Checker Bot is active! Use /save [nickname] [url] to begin.'));

bot.command('save', async (ctx) => {
    const args = ctx.message.text.split(/\s+/);
    const nickname = args[1];
    let url = args[2];

    if (!nickname || !url) {
        return ctx.reply("⚠️ Format: /save [nickname] [url]");
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }

    try {
        // Save using native hash-set layout
        await kv.hset(`user:${ctx.chat.id}:sites`, nickname.toLowerCase(), url);
        await ctx.reply(`💾 Saved shortcut *${nickname.toLowerCase()}*!`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ Database Error: ${err.message}`);
    }
});

bot.command('savedurl', async (ctx) => {
    try {
        const sites = await kv.hgetall(`user:${ctx.chat.id}:sites`);

        if (!sites || Object.keys(sites).length === 0) {
            return ctx.reply("No saved URLs yet. Use /save [nickname] [url]");
        }

        const lines = Object.entries(sites).map(
            ([name, url]) => `*${name}* -> ${url}`
        );

        await ctx.reply(`Saved URLs:\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ Database Error: ${err.message}`);
    }
});
import https from 'https'; // Add this import at the very top of your api/bot.js file

import net from 'net'; // Add this import at the very top of your api/bot.js file

bot.command('check', async (ctx) => {
    try {
        const sites = await kv.hgetall(`user:${ctx.chat.id}:sites`);

        if (!sites || Object.keys(sites).length === 0) {
            return ctx.reply("No saved URLs to check. Use /save first.");
        }

        await ctx.reply("📡 Running raw TCP port connectivity test...");

        const results = await Promise.all(
            Object.entries(sites).map(async ([name, urlString]) => {
                return new Promise((resolve) => {
                    try {
                        // 1. Clean and parse the URL to extract the hostname
                        let cleanUrl = urlString.trim();
                        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
                            cleanUrl = 'https://' + cleanUrl;
                        }
                        
                        const parsedUrl = new URL(cleanUrl);
                        const host = parsedUrl.hostname;
                        // Default to port 443 for https, or 80 for http
                        const port = parsedUrl.port ? parseInt(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);

                        // 2. Open a raw TCP socket connection (Just like Test-NetConnection)
                        const socket = new net.Socket();
                        
                        // Set a strict 7-second timeout so the serverless function doesn't hang
                        socket.setTimeout(7000);

                        socket.connect(port, host, () => {
                            // If this triggers, the port is open and reachable!
                            socket.destroy(); 
                            resolve(`✅ *${name}* (${host}:${port}) is online! TCP connection succeeded.`);
                        });

                        socket.on('error', (err) => {
                            socket.destroy();
                            resolve(`❌ *${name}* (${host}:${port}) failed. Reason: \`${err.message}\``);
                        });

                        socket.on('timeout', () => {
                            socket.destroy();
                            resolve(`❌ *${name}* (${host}:${port}) failed. Reason: \`Connection Timeout (Blocked)\``);
                        });

                    } catch (err) {
                        resolve(`❌ *${name}* invalid URL format: \`${err.message}\``);
                    }
                });
            })
        );

        await ctx.reply(results.join('\n\n'), { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (err) {
        await ctx.reply(`❌ Execution Error: ${err.message}`);
    }
});

// This listener maps directly to the /remove menu option you set up in BotFather
bot.command('remove', async (ctx) => {
    // parse command arguments: /remove nickname
    const args = ctx.message.text.split(/\s+/);
    const nickname = args[1];

    if (!nickname) {
        return ctx.reply("⚠️ Format: /remove [nickname]");
    }

    try {
        const key = `user:${ctx.chat.id}:sites`;
        const targetNickname = nickname.toLowerCase();

        // hdel returns the number of fields removed (1 if found, 0 if it didn't exist)
        const deletedCount = await kv.hdel(key, targetNickname);

        if (deletedCount === 0) {
            return ctx.reply(`❓ Shortcut *${targetNickname}* was not found in your list.`, { parse_mode: 'Markdown' });
        }

        await ctx.reply(`🗑️ Successfully deleted shortcut *${targetNickname}*!`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ Database Error: ${err.message}`);
    }
});
// --- VERCEL SERVERLESS WEBHOOK HANDLER ---

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('Bot engine active.');
    }

    try {
        await bot.handleUpdate(req.body, res);
        if (!res.writableEnded) {
            res.status(200).json({ ok: true });
        }
    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).json({ error: 'Failed to process webhook update' });
    }
}