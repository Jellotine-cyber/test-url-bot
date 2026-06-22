import { Telegraf } from 'telegraf';
import { Redis } from '@upstash/redis';

// 1. Initialize Redis using your single REDIS_URL environment variable
const redis = Redis.fromEnv({
    REDIS_URL: process.env.REDIS_URL,
    REDIS_TOKEN: process.env.REDIS_URL ? process.env.REDIS_URL.split('@')[1].split(':')[1] : '' 
});

// Explicit fallback: If fromEnv struggles, parse it cleanly manually
const token = process.env.REDIS_URL ? process.env.REDIS_URL.split('//')[1].split(':')[0] : '';
const url = process.env.REDIS_URL ? `https://${process.env.REDIS_URL.split('@')[1]}` : '';
const kv = new Redis({ url: url, token: token });

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
        // Using standard redis hash set
        await kv.hset(`user:${ctx.chat.id}:sites`, { [nickname.toLowerCase()]: url });
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
                    const res = await fetch(url, { method: 'GET', redirect: 'follow' });

                    if (res.status === 200) {
                        return `✅ Connection to *${name}* (${url}) is successful with status '200'`;
                    }
                    return `⚠️ Connection to *${name}* (${url}) failed with status '${res.status}'`;
                } catch (err) {
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