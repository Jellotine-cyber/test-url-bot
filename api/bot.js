import { Telegraf } from 'telegraf';
import { kv } from '@vercel/kv';

// Initialize the Telegraf bot using your environment token
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- 1. TELEGRAM BOT COMMAND HANDLERS ---

// /start command to test if the bot is listening
bot.start((ctx) => ctx.reply('🚀 Website Checker Bot is active! Use /save [nickname] [url] to begin.'));

// This listener maps directly to the /save menu option you set up in BotFather
bot.command('save', async (ctx) => {
    // parse command arguments: /save nickname url
    const args = ctx.message.text.split(/\s+/);
    const nickname = args[1];
    let url = args[2];

    if (!nickname || !url) {
        return ctx.reply("⚠️ Format: /save [nickname] [url]");
    }

    // normalize URL to https if protocol is missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }

    try {
        await kv.hset(`user:${ctx.chat.id}:sites`, { [nickname.toLowerCase()]: url });
        await ctx.reply(`💾 Saved shortcut *${nickname.toLowerCase()}*!`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`❌ Database Error: ${err.message}`);
    }
});

// This listener maps directly to the /savedurls menu option you set up in BotFather
bot.command('savedurl', async (ctx) => {
    try {
        // load saved URLs for this chat/user
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

// This listener maps directly to the /check menu option you set up in BotFather
bot.command('check', async (ctx) => {
    try {
        // retrieve saved URLs and validate each one
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
                    // network issue or invalid URL
                    return `❌ Connection to *${name}* (${url}) failed: ${err.message}`;
                }
            })
        );

        await ctx.reply(results.join('\n\n'), { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (err) {
        await ctx.reply(`❌ Execution Error: ${err.message}`);
    }
});


// --- 2. VERCEL SERVERLESS WEBHOOK HANDLER ---

export default async function handler(req, res) {
    // Drop non-POST requests quietly
    if (req.method !== 'POST') {
        return res.status(200).send('Bot engine active. Send Telegram POST webhooks here.');
    }

    try {
        // Feed Telegram's request body straight into Telegraf engine
        await bot.handleUpdate(req.body, res);
        
        // Ensure the serverless function finishes with a clean 200 OK response
        if (!res.writableEnded) {
            res.status(200).json({ ok: true });
        }
    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).json({ error: 'Failed to process webhook update' });
    }
}