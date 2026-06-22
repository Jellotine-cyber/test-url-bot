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

bot.command('check', async (ctx) => {
    try {
        const sites = await kv.hgetall(`user:${ctx.chat.id}:sites`);

        if (!sites || Object.keys(sites).length === 0) {
            return ctx.reply("No saved URLs to check. Use /save first.");
        }

        await ctx.reply("🔄 Checking connection status...");

        const results = await Promise.all(
            Object.entries(sites).map(async ([name, url]) => {
                try {
                    // We set redirect to 'follow' so it completely processes the Outlook login hop
                    const res = await fetch(url, { 
                        method: 'GET', 
                        redirect: 'follow',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });

                    // Match your criteria: If it's explicitly 404, it's missing/dead.
                    if (res.status === 404) {
                        return `❌ Connection to *${name}* (${url}) failed: 404 Page Not Found`;
                    }

                    // Treat every other response (200, 302, etc.) as a functional server sign of life
                    return `✅ Connection to *${name}* is successful! (Status: ${res.status})`;

                } catch (err) {
                    // Network level crashes (DNS failures, connection timeouts, refused connections)
                    return `❌ Connection to *${name}* (${url}) failed: ${err.message}`;
                }
            })
        );

        await ctx.reply(results.join('\n\n'), { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (err) {
        await ctx.reply(`❌ Execution Error: ${err.message}`);
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