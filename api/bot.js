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

        await ctx.reply("📡 Checking specific application paths via redirection tracking...");

        const results = await Promise.all(
            Object.entries(sites).map(async ([name, urlString]) => {
                try {
                    let cleanUrl = urlString.trim();
                    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
                        cleanUrl = 'https://' + cleanUrl;
                    }

                    // Direct request from Vercel's Singapore engine
                    const res = await fetch(cleanUrl, {
                        method: 'GET',
                        redirect: 'manual', // CRITICAL: Tells the engine NOT to follow the loop
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                        }
                    });

                    // Log the status code (Vercel returns status 0 or 301/302/307 for manual redirects)
                    // If the status is between 300 and 399, or if Node fetch abstracts it as type: 'opaqueredirect' (status 0)
                    const isRedirect = (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect' || res.status === 401;

                    if (res.status === 200) {
                        return `✅ Application *${name}* is fully active and accessible! (Status: 200)`;
                    } 
                    
                    if (isRedirect) {
                        // Get the forwarding destination if visible
                        const targetLocation = res.headers.get('location') || 'Identity Provider Gateway';
                        return `✅ Application *${name}* is **UP and running**! (Verified via secure redirect to: \`${targetLocation}\`)`;
                    }

                    // If it drops past the redirect layer into a server fault
                    return `❌ Application *${name}* failed with Status: \`${res.status}\``;

                } catch (err) {
                    return `❌ Connection to *${name}* failed: \`${err.message}\``;
                }
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